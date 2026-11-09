import fs from 'node:fs';
import fsp from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { connectQMP } from './qmp.js';
import { qgaRequestShutdown } from './agent/qga.js';
import { store } from './store.js';
import { log } from './log.js';
import {
  VMS_DIR,
  ISO_DIR,
  vmDir,
  vmRunDir,
  vmPath,
  qmpSocket,
  serialSocket,
  qgaSocket,
  pidFile,
  qemuLog,
  serialLog,
  paths,
} from './env.js';

const HZ = 100;
const isLinux = process.platform === 'linux';
const KVM_AVAILABLE = fs.existsSync('/dev/kvm');

function readFileIfExists(file, max = 1024 * 1024) {
  try {
    const stat = fs.statSync(file);
    const start = Math.max(0, stat.size - max);
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(stat.size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    return buf.toString('utf8');
  } catch {
    return '';
  }
}

function isPidAlive(pid, vmId = null) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  if (!vmId) return true;
  // A pid on its own proves nothing: pids are recycled, and acting on a recycled one would
  // report a dead guest as running or even signal an unrelated process. QEMU is always started
  // with `-name <vm>,process=emuman-<id>`, so require that marker when we know the machine.
  let cmdline;
  try {
    cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
  } catch {
    return true; // unreadable /proc entry: keep the previous behaviour rather than guess
  }
  return cmdline.includes(`process=emuman-${vmId}`);
}

function processStartMs(pid) {
  try {
    const raw = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const close = raw.lastIndexOf(')');
    const fields = raw.slice(close + 2).split(' ');
    const startTicks = Number(fields[19]) || 0;
    const uptime = Number(fs.readFileSync('/proc/uptime', 'utf8').split(' ')[0]) || 0;
    const bootMs = Date.now() - uptime * 1000;
    return Math.min(Date.now(), Math.round(bootMs + (startTicks / HZ) * 1000));
  } catch {
    return Date.now();
  }
}

function readProcStat(pid) {
  try {
    const raw = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const close = raw.lastIndexOf(')');
    const fields = raw.slice(close + 2).split(' ');
    return {
      utime: Number(fields[11]) || 0,
      stime: Number(fields[12]) || 0,
      rssPages: Number(fields[21]) || 0,
      state: fields[0],
    };
  } catch {
    return null;
  }
}

function randomMac() {
  const bytes = crypto.randomBytes(3);
  return `52:54:00:${bytes.toString('hex').match(/../g).join(':')}`;
}

const SNAP_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$/;

function detectFirmware() {
  const candidates = [
    { code: '/usr/share/OVMF/OVMF_CODE_4M.fd', vars: '/usr/share/OVMF/OVMF_VARS_4M.fd' },
    { code: '/usr/share/OVMF/OVMF_CODE.fd', vars: '/usr/share/OVMF/OVMF_VARS.fd' },
    { code: '/usr/share/edk2/ovmf/OVMF_CODE.fd', vars: '/usr/share/edk2/ovmf/OVMF_VARS.fd' },
    { code: '/usr/share/edk2/x64/OVMF_CODE.fd', vars: '/usr/share/edk2/x64/OVMF_VARS.fd' },
    {
      code: '/usr/share/qemu/edk2-x86_64-code.fd',
      vars: '/usr/share/qemu/edk2-i386-vars.fd',
    },
  ];
  return candidates.filter((c) => fs.existsSync(c.code) && fs.existsSync(c.vars));
}

export class VMManager extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(100);
    this.vms = new Map();
    this.runtimes = new Map();
    this.locks = new Map();
    this.diskCache = new Map();
    this.hostPrev = null;
    this.hostInfo = {
      cpuPct: 0,
      load: [0, 0, 0],
      memTotal: os.totalmem(),
      memFree: os.freemem(),
      memUsed: os.totalmem() - os.freemem(),
      uptime: os.uptime(),
      storage: { total: 0, free: 0, used: 0 },
      sampleAt: 0,
    };
    this.qemuVersion = null;
    this.firmware = detectFirmware();
    this.kvm = KVM_AVAILABLE;
    this._timer = null;
  }

  async init() {
    await this.load();
    await this.detectQemu();
    await this.refreshHostInfo();
    this.startSampling();
    await this.adoptRunning();
    await this.setIsoCount();
    log.info('vm', `loaded ${this.vms.size} virtual machine(s)`);
  }

  async detectQemu() {
    const bin = store.settings.qemuPath;
    await new Promise((resolve) => {
      const child = spawn(bin, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      child.stdout.on('data', (d) => (out += d));
      child.on('error', () => {
        this.qemuVersion = null;
        resolve();
      });
      child.on('close', () => {
        const match = out.match(/QEMU emulator version ([^\s]+)/);
        this.qemuVersion = match ? match[1] : out.trim().split('\n')[0] || null;
        resolve();
      });
    });
  }

  /* ------------------------------- persistence ------------------------------ */

  async load() {
    await fsp.mkdir(VMS_DIR, { recursive: true });
    const entries = await fsp.readdir(VMS_DIR, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const file = path.join(VMS_DIR, entry.name, 'vm.json');
      try {
        const vm = JSON.parse(await fsp.readFile(file, 'utf8'));
        if (!vm.id || !vm.name) continue;
        this.vms.set(vm.id, this.normalize(vm));
        this.runtimes.set(vm.id, this.emptyRuntime());
      } catch (err) {
        log.warn('vm', `skipping unreadable VM config ${entry.name}: ${err.message}`);
      }
    }
  }

  normalize(vm) {
    const clean = {
      id: vm.id,
      name: vm.name,
      description: vm.description || '',
      createdAt: vm.createdAt || Date.now(),
      updatedAt: vm.updatedAt || Date.now(),
      cpus: Number(vm.cpus) || 2,
      memoryMB: Number(vm.memoryMB) || 1024,
      machine: vm.machine || 'q35',
      firmware: vm.firmware === 'efi' ? 'efi' : 'bios',
      video: vm.video || 'std',
      disks: Array.isArray(vm.disks) ? vm.disks : [],
      cdrom: vm.cdrom || null,
      net: {
        mode: vm.net?.mode === 'bridge' ? 'bridge' : 'user',
        model: vm.net?.model || 'virtio',
        bridge: vm.net?.bridge || '',
        mac: vm.net?.mac || randomMac(),
        sshPort: Number(vm.net?.sshPort) || null,
        guestSshPort: Number(vm.net?.guestSshPort) || 22,
      },
      vncPort: Number(vm.vncPort) || 5900,
      bootFrom: vm.bootFrom === 'cdrom' ? 'cdrom' : 'disk',
      autostart: Boolean(vm.autostart),
      serialEnabled: vm.serialEnabled !== false,
      extraArgs: Array.isArray(vm.extraArgs) ? vm.extraArgs : [],
      ssh: {
        user: vm.ssh?.user || 'root',
        enabled: vm.ssh?.enabled !== false,
        savedPassword: vm.ssh?.savedPassword || null,
      },
      stats: vm.stats || null,
    };
    return clean;
  }

  async persist(vm) {
    vm.updatedAt = Date.now();
    const dir = vmDir(vm.id);
    await fsp.mkdir(dir, { recursive: true });
    const file = path.join(dir, 'vm.json');
    const tmp = `${file}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(vm, null, 2), { mode: 0o600 });
    await fsp.rename(tmp, file);
    this.vms.set(vm.id, vm);
    return vm;
  }

  emptyRuntime() {
    return {
      status: 'stopped',
      pid: null,
      qmp: null,
      proc: null,
      startedAt: null,
      lastError: null,
      cpuPct: 0,
      memBytes: 0,
      history: [],
      prevTicks: null,
      prevSampleAt: null,
      agent: null,
    };
  }

  runtime(id) {
    return this.runtimes.get(id) || null;
  }

  getVm(id) {
    return this.vms.get(id) || null;
  }

  list() {
    return [...this.vms.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((vm) => this.summary(vm));
  }

  summary(vm) {
    const rt = this.runtime(vm.id) || this.emptyRuntime();
    return {
      id: vm.id,
      name: vm.name,
      description: vm.description,
      status: rt.status,
      cpus: vm.cpus,
      memoryMB: vm.memoryMB,
      firmware: vm.firmware,
      disks: vm.disks.length,
      diskGB: vm.disks.reduce((sum, d) => sum + (Number(d.sizeGB) || 0), 0),
      cdrom: vm.cdrom,
      vncPort: vm.vncPort,
      sshPort: vm.net.sshPort,
      sshUser: vm.ssh?.user || 'root',
      hasSavedSshPassword: Boolean(vm.ssh?.savedPassword),
      netMode: vm.net.mode,
      mac: vm.net.mac,
      autostart: vm.autostart,
      createdAt: vm.createdAt,
      startedAt: rt.startedAt,
      cpuPct: rt.cpuPct,
      memBytes: rt.memBytes,
      lastError: rt.lastError,
    };
  }

  /* --------------------------------- utilities ------------------------------ */

  async withLock(id, fn) {
    const previous = this.locks.get(id) || Promise.resolve();
    let release;
    const gate = new Promise((resolve) => (release = resolve));
    const tail = previous.then(() => gate);
    this.locks.set(id, tail);
    await previous;
    try {
      return await fn();
    } finally {
      release();
      tail.finally(() => {
        if (this.locks.get(id) === tail) this.locks.delete(id);
      });
    }
  }

  broadcast(type, payload) {
    this.emit('change', { type, ...payload });
  }

  setStatus(id, status, extra = {}) {
    const rt = this.runtimes.get(id);
    if (!rt) return;
    const changed = rt.status !== status;
    rt.status = status;
    Object.assign(rt, extra);
    if (changed) {
      log.info('vm', `${this.getVm(id)?.name || id} -> ${status}`);
      this.broadcast('vm-status', { id, status, ...extra });
    }
    this.broadcast('vm-runtime', { id, status, ...extra });
  }

  async isPortFree(port, host = '127.0.0.1') {
    if (!port) return true;
    return new Promise((resolve) => {
      const server = net.createServer();
      server.unref();
      server.once('error', () => resolve(false));
      server.listen({ port, host, exclusive: true }, () => {
        server.close(() => resolve(true));
      });
    });
  }

  usedPorts(exceptId = null) {
    const used = new Set();
    for (const vm of this.vms.values()) {
      if (vm.id === exceptId) continue;
      used.add(vm.vncPort);
      if (vm.net.sshPort) used.add(vm.net.sshPort);
    }
    return used;
  }

  async allocatePort(kind, exceptId = null) {
    const used = this.usedPorts(exceptId);
    const start = kind === 'vnc' ? store.settings.vncPortStart : store.settings.sshPortStart;
    const end = kind === 'vnc' ? store.settings.vncPortEnd : store.settings.sshPortEnd;
    for (let port = start; port <= end; port += 1) {
      if (used.has(port)) continue;
      if (await this.isPortFree(port)) return port;
    }
    throw new Error(`No free ${kind} port in range ${start}-${end}`);
  }

  async scanIsos() {
    const dirs = new Set([ISO_DIR, store.settings.isoDir].filter(Boolean));
    const results = [];
    for (const dir of dirs) {
      let entries = [];
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (!/\.(iso|img)$/i.test(entry.name)) continue;
        const full = path.join(dir, entry.name);
        try {
          const stat = await fsp.stat(full);
          results.push({
            name: entry.name,
            path: full,
            size: stat.size,
            mtime: stat.mtimeMs,
            dir,
          });
        } catch {
          /* ignore */
        }
      }
    }
    return results.sort((a, b) => a.name.localeCompare(b.name));
  }

  async diskInfo(file) {
    const cached = this.diskCache.get(file);
    if (cached && Date.now() - cached.at < 15000) return cached.info;
    const info = await new Promise((resolve) => {
      const child = spawn('qemu-img', ['info', '-U', '--output=json', file], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '';
      child.stdout.on('data', (d) => (out += d));
      child.on('error', () => resolve(null));
      child.on('close', (code) => {
        if (code !== 0) return resolve(null);
        try {
          const parsed = JSON.parse(out);
          resolve({
            virtualSize: parsed['virtual-size'] || 0,
            actualSize: parsed['actual-size'] || 0,
            format: parsed.format,
            snapshots: parsed.snapshots?.length || 0,
          });
        } catch {
          resolve(null);
        }
      });
    });
    if (info) this.diskCache.set(file, { at: Date.now(), info });
    return info;
  }

  /* --------------------------------- lifecycle ------------------------------ */

  buildQemuArgs(vm, { loadvm = null } = {}) {
    const dir = vmDir(vm.id);
    const run = vmRunDir(vm.id);
    // q35's AHCI controller exposes ide.0–ide.5, one device per port.
    const AHCI_PORTS = 6;
    const args = [
      '-name',
      `${vm.name},process=emuman-${vm.id}`,
      '-machine',
      `${vm.machine},accel=${this.kvm ? 'kvm:tcg' : 'tcg'}`,
      '-cpu',
      this.kvm ? 'host' : 'max',
      '-smp',
      String(vm.cpus),
      '-m',
      String(vm.memoryMB),
      '-uuid',
      vm.id,
      '-rtc',
      'base=utc,driftfix=slew',
      '-monitor',
      'none',
      '-pidfile',
      pidFile(vm.id),
      '-qmp',
      `unix:${qmpSocket(vm.id)},server=on,wait=off`,
      '-vnc',
      `127.0.0.1:${vm.vncPort - 5900}`,
    ];

    if (vm.serialEnabled) {
      args.push(
        '-chardev',
        `socket,id=char-serial,path=${serialSocket(vm.id)},server=on,wait=off,logfile=${serialLog(
          vm.id,
        )},logappend=on`,
        '-serial',
        'chardev:char-serial',
      );
    }

    args.push(
      '-device',
      'virtio-rng-pci',
      '-device',
      'virtio-balloon-pci',
      '-usb',
      '-device',
      'usb-tablet',
    );

    if (vm.firmware === 'efi' && this.firmware.length > 0) {
      const fw = this.firmware[0];
      const varsPath = path.join(dir, 'efivars.fd');
      if (!fs.existsSync(varsPath)) {
        fs.copyFileSync(fw.vars, varsPath);
      }
      args.push(
        '-drive',
        `if=pflash,format=raw,readonly=on,file=${fw.code}`,
        '-drive',
        `if=pflash,format=raw,file=${varsPath}`,
      );
    } else if (vm.firmware === 'efi') {
      log.warn('vm', 'EFI requested but no OVMF firmware found, falling back to BIOS');
    }

    let bootIndex = 1;
    const diskBoot = vm.bootFrom === 'disk';
    const cdromBoot = vm.bootFrom === 'cdrom' && vm.cdrom;
    if (cdromBoot) bootIndex += 1;

    let sataPort = 0;
    vm.disks.forEach((disk, index) => {
      const file = path.join(dir, disk.file);
      if (!fs.existsSync(file)) return;
      const driveId = `drive${index}`;
      const idx = diskBoot ? bootIndex++ : 0;
      const boot = idx ? `,bootindex=${idx}` : '';
      if (disk.bus === 'sata') {
        // The controller exposes exactly six AHCI ports (ide.0–ide.5) and each port takes a
        // single device, so every SATA disk needs its own bus — otherwise QEMU aborts with
        // "Can't create IDE unit 1, bus supports only 1 units".
        if (sataPort >= AHCI_PORTS) {
          throw httpError(400, `Too many SATA disks: the AHCI controller supports ${AHCI_PORTS} devices`);
        }
        const port = sataPort++;
        args.push(
          '-drive',
          `file=${file},if=none,id=${driveId},format=${disk.format || 'qcow2'},cache=writeback,discard=unmap`,
          '-device',
          `ide-hd,bus=ide.${port},drive=${driveId},serial=${disk.id}${boot}`,
        );
      } else {
        args.push(
          '-drive',
          `file=${file},if=none,id=${driveId},format=${disk.format || 'qcow2'},cache=writeback,discard=unmap`,
          '-device',
          `virtio-blk-pci,drive=${driveId},serial=${disk.id}${boot}`,
        );
      }
    });

    if (vm.cdrom && fs.existsSync(vm.cdrom)) {
      // The CD-ROM also needs a port of its own so it can coexist with SATA disks.
      if (sataPort >= AHCI_PORTS) {
        throw httpError(400, 'No free AHCI port left for the CD-ROM; detach a SATA disk or use virtio disks');
      }
      const cdPort = sataPort;
      args.push(
        '-drive',
        `file=${vm.cdrom},media=cdrom,readonly=on,if=none,id=cdrom0`,
        '-device',
        `ide-cd,bus=ide.${cdPort},drive=cdrom0${cdromBoot ? ',bootindex=1' : ''}`,
      );
    }

    const netdev =
      vm.net.mode === 'bridge' && vm.net.bridge
        ? `bridge,id=net0,br=${vm.net.bridge}`
        : `user,id=net0${vm.net.sshPort ? `,hostfwd=tcp:127.0.0.1:${vm.net.sshPort}-:${vm.net.guestSshPort}` : ''}`;
    args.push(
      '-netdev',
      netdev,
      '-device',
      `virtio-net-pci,netdev=net0,mac=${vm.net.mac}`,
    );

    const videoModel = ['std', 'virtio', 'qxl', 'vmware'].includes(vm.video) ? vm.video : 'std';
    args.push('-vga', videoModel);

    args.push(
      '-chardev',
      `socket,id=qga0,path=${qgaSocket(vm.id)},server=on,wait=off`,
      '-device',
      'virtio-serial-pci',
      '-device',
      `virtserialport,chardev=qga0,name=org.qemu.guest_agent.0`,
    );

    if (loadvm) args.push('-loadvm', loadvm);
    if (Array.isArray(vm.extraArgs) && vm.extraArgs.length) args.push(...vm.extraArgs);
    return args;
  }

  async adoptRunning() {
    for (const vm of this.vms.values()) {
      const pid = Number(readFileIfExists(pidFile(vm.id)).trim());
      if (!pid || !isPidAlive(pid, vm.id)) {
        this.cleanupRunFiles(vm.id);
        continue;
      }
      try {
        const qmp = await connectQMP(qmpSocket(vm.id), { timeoutMs: 8000 });
        const rt = this.runtimes.get(vm.id) || this.emptyRuntime();
        rt.pid = pid;
        rt.qmp = qmp;
        rt.startedAt = processStartMs(pid);
        rt.status = 'running';
        this.runtimes.set(vm.id, rt);
        this.attachQmp(vm, qmp);
        const status = await qmp.execute('query-status').catch(() => null);
        if (status?.status === 'paused') rt.status = 'paused';
        if (status?.status === 'shutdown') rt.status = 'stopped';
        log.info('vm', `adopted running VM ${vm.name} (pid ${pid})`);
      } catch (err) {
        // The process is alive but we cannot talk to it. Keep its pidfile and sockets so an
        // operator can retry or force-stop it instead of silently orphaning the guest.
        const rt = this.runtimes.get(vm.id) || this.emptyRuntime();
        rt.pid = pid;
        rt.startedAt = processStartMs(pid);
        rt.status = 'error';
        rt.lastError = `QEMU (pid ${pid}) is running but QMP is unreachable: ${err.message}`;
        this.runtimes.set(vm.id, rt);
        this.setStatus(vm.id, 'error', { lastError: rt.lastError });
        log.error('vm', `${vm.name}: ${rt.lastError}`);
      }
    }
    this.broadcast('vms-reloaded', {});
  }

  cleanupRunFiles(id) {
    for (const file of [pidFile(id), qmpSocket(id), serialSocket(id), qgaSocket(id)]) {
      try {
        fs.unlinkSync(file);
      } catch {
        /* ignore */
      }
    }
  }

  attachQmp(vm, qmp) {
    qmp.on('error', (err) => log.warn('qmp', `${vm.name}: ${err.message}`));
    qmp.on('event', (msg) => {
      const rt = this.runtime(vm.id);
      if (!rt) return;
      switch (msg.event) {
        case 'STOP':
          this.setStatus(vm.id, 'paused');
          break;
        case 'RESUME':
          this.setStatus(vm.id, 'running');
          break;
        case 'SHUTDOWN': {
          const guest = msg.data?.guest;
          this.setStatus(vm.id, 'stopping', { lastError: guest ? null : rt.lastError });
          store.addEvent({
            action: 'vm.shutdown',
            message: `${vm.name} ${guest ? 'shut down by guest' : 'is shutting down'}`,
            vmId: vm.id,
            level: 'info',
          });
          break;
        }
        case 'POWERDOWN':
          this.setStatus(vm.id, 'stopping');
          break;
        case 'RESET':
          store.addEvent({ action: 'vm.reset', message: `${vm.name} was reset`, vmId: vm.id });
          break;
        case 'GUEST_PANICKED':
          this.setStatus(vm.id, 'running', { lastError: 'Guest kernel panic detected' });
          store.addEvent({
            action: 'vm.panic',
            message: `${vm.name}: guest kernel panic`,
            vmId: vm.id,
            level: 'error',
          });
          break;
        case 'BLOCK_IO_ERROR':
          store.addEvent({
            action: 'vm.io-error',
            message: `${vm.name}: block I/O error (${msg.data?.device || 'disk'})`,
            vmId: vm.id,
            level: 'error',
          });
          break;
        default:
          break;
      }
    });
    qmp.on('close', () => {
      const rt = this.runtime(vm.id);
      if (rt && rt.qmp === qmp) rt.qmp = null;
    });
  }

  async start(id, { loadvm = null, user = null } = {}) {
    return this.withLock(id, async () => {
      const vm = this.getVm(id);
      if (!vm) throw httpError(404, 'Virtual machine not found');
      const rt = this.runtime(id);
      if (['running', 'paused'].includes(rt.status) || (rt.pid && isPidAlive(rt.pid, vm.id))) {
        throw httpError(409, 'Virtual machine is already running');
      }
      if (!this.qemuVersion) throw httpError(500, `QEMU binary not found at ${store.settings.qemuPath}`);
      if (!KVM_AVAILABLE) log.warn('vm', 'KVM is not available, falling back to software emulation');

      fs.mkdirSync(vmRunDir(id), { recursive: true });
      this.cleanupRunFiles(id);
      if (vm.cdrom && !fs.existsSync(vm.cdrom)) {
        store.addEvent({
          action: 'vm.iso-missing',
          message: `${vm.name}: ISO not found (${vm.cdrom})`,
          vmId: id,
          level: 'warn',
        });
      }

      // Re-allocate VNC/SSH ports if another service took them while stopped.
      const used = this.usedPorts(id);
      if (used.has(vm.vncPort) || !(await this.isPortFree(vm.vncPort))) {
        vm.vncPort = await this.allocatePort('vnc', id);
      }
      if (vm.net.mode === 'user' && vm.net.sshPort) {
        if (used.has(vm.net.sshPort) || !(await this.isPortFree(vm.net.sshPort))) {
          vm.net.sshPort = await this.allocatePort('ssh', id);
        }
      }
      await this.persist(vm);

      const args = this.buildQemuArgs(vm, { loadvm });
      fs.appendFileSync(
        qemuLog(id),
        `\n=== ${new Date().toISOString()} starting: ${store.settings.qemuPath} ${args.join(' ')}\n`,
      );
      this.setStatus(id, 'starting', { lastError: null, startedAt: null, pid: null });

      let outFd;
      try {
        outFd = fs.openSync(qemuLog(id), 'a');
      } catch {
        outFd = 'ignore';
      }
      const child = spawn(store.settings.qemuPath, args, {
        cwd: vmDir(id),
        stdio: ['ignore', outFd, outFd],
        env: { ...process.env, QEMU_AUDIO_DRV: 'none' },
      });
      if (typeof outFd === 'number') {
        try {
          fs.closeSync(outFd);
        } catch {
          /* ignore */
        }
      }

      let spawnError = null;
      child.once('error', (err) => {
        spawnError = err;
        log.error('vm', `failed to spawn QEMU for ${vm.name}: ${err.message}`);
      });

      try {
        const qmp = await connectQMP(qmpSocket(id), { timeoutMs: 25000 });
        if (spawnError) throw spawnError;
        const status = await qmp.execute('query-status').catch(() => ({ status: 'running' }));
        rt.proc = child;
        rt.pid = child.pid;
        rt.qmp = qmp;
        rt.startedAt = Date.now();
        rt.lastError = null;
        rt.prevTicks = null;
        rt.prevSampleAt = null;
        this.attachQmp(vm, qmp);
        this.setStatus(id, status?.status === 'paused' ? 'paused' : 'running', {
          pid: child.pid,
          startedAt: rt.startedAt,
        });
        this.broadcast('vms-changed', {});

        child.once('exit', (code, signal) => {
          log.info('vm', `${vm.name} exited (code=${code}, signal=${signal})`);
          const current = this.runtime(id);
          if (current?.proc === child) {
            current.proc = null;
            current.pid = null;
            current.qmp?.close();
            current.qmp = null;
            current.startedAt = null;
            current.cpuPct = 0;
            current.memBytes = 0;
            this.cleanupRunFiles(id);
            if (code && code !== 0 && !current.lastError) {
              current.lastError = `QEMU exited with code ${code}`;
            }
            this.setStatus(id, 'stopped');
            this.broadcast('vms-changed', {});
          }
        });

        store.addEvent({
          action: loadvm ? 'vm.restore' : 'vm.start',
          message: loadvm
            ? `${vm.name} restored from snapshot "${loadvm}"`
            : `${vm.name} started`,
          vmId: id,
          user,
          level: 'info',
        });
        return { ok: true, pid: child.pid, status: this.runtime(id).status };
      } catch (err) {
        const logTail = readFileIfExists(qemuLog(id), 4000)
          .split('\n')
          .slice(-8)
          .join('\n');
        try {
          child.kill('SIGKILL');
        } catch {
          /* ignore */
        }
        this.cleanupRunFiles(id);
        rt.lastError = logTail.split('\n').filter(Boolean).pop() || err.message;
        this.setStatus(id, 'error', { lastError: err.message });
        log.error('vm', `start failed for ${vm.name}: ${err.message}\n${logTail}`);
        throw httpError(500, `Failed to start VM: ${err.message}`, { log: logTail });
      }
    });
  }

  async stop(id, { force = false, user = null } = {}) {
    return this.withLock(id, async () => {
      const vm = this.getVm(id);
      if (!vm) throw httpError(404, 'Virtual machine not found');
      const rt = this.runtime(id);
      const pidAlive = rt.pid && isPidAlive(rt.pid, vm.id);
      if (!['running', 'paused', 'stopping', 'starting', 'error'].includes(rt.status) && !pidAlive) {
        return { ok: true, status: rt.status };
      }
      const priorStatus = rt.status === 'paused' ? 'paused' : 'running';
      this.setStatus(id, 'stopping');
      // Prefer the guest agent: it is a real shutdown request the OS always honours, unlike the
      // ACPI power button (Windows with modern standby simply ignores that event).
      let viaAgent = false;
      if (!force) {
        try {
          const how = await qgaRequestShutdown(vm.id);
          if (how) {
            viaAgent = true;
            store.addEvent({
              action: 'vm.guest-shutdown',
              message: `${vm.name}: clean shutdown requested through the guest agent (${how})`,
              vmId: id,
              user,
            });
          }
        } catch (err) {
          log.info('vm', `${vm.name}: guest agent unavailable for shutdown (${err.message})`);
        }
      }
      if (rt.qmp && !viaAgent) {
        try {
          await (force ? rt.qmp.execute('quit') : rt.qmp.execute('system_powerdown'));
        } catch (err) {
          log.warn('vm', `QMP stop failed for ${vm.name}: ${err.message}`);
        }
      }
      if (force || !rt.qmp) {
        if (!rt.qmp && rt.pid && isPidAlive(rt.pid, vm.id)) {
          try {
            process.kill(rt.pid, 'SIGTERM');
          } catch {
            /* ignore */
          }
        }
        await this.waitForExit(id, force ? 5000 : 10000);
        const current = this.runtime(id);
        if (current.pid && isPidAlive(current.pid, vm.id)) {
          try {
            process.kill(current.pid, 'SIGKILL');
          } catch {
            /* ignore */
          }
          await this.waitForExit(id, 3000);
        }
      } else {
        // Guests do not always honour the ACPI power-button event (Windows with modern
        // standby, a shutdown blocked by servicing, …). Without a deadline the machine
        // would stay "stopping" forever with its console endpoints refusing requests, so
        // wait a bounded amount of time and report the outcome instead.
        const exited = await this.waitForExit(id, 30000);
        if (!exited) {
          this.setStatus(id, priorStatus);
          store.addEvent({
            action: 'vm.shutdown-timeout',
            message: `${vm.name} did not power off within 30s (still running or shutting down)`,
            vmId: id,
            user,
            level: 'warn',
          });
          return { ok: true, status: this.runtime(id).status, pending: true };
        }
      }
      store.addEvent({
        action: 'vm.stop',
        message: `${vm.name} ${force ? 'was force-stopped' : 'was asked to shut down'}`,
        vmId: id,
        user,
      });
      return { ok: true, status: this.runtime(id).status };
    });
  }

  detachQmpClients() {
    for (const rt of this.runtimes.values()) {
      if (rt.qmp) {
        try {
          rt.qmp.close();
        } catch {
          /* ignore */
        }
        rt.qmp = null;
      }
    }
  }

  async waitForExit(id, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const rt = this.runtime(id);
      if (!rt.pid || !isPidAlive(rt.pid, id)) {
        if (rt.status !== 'stopped') this.setStatus(id, 'stopped');
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return false;
  }

  async reset(id, user = null) {
    const vm = this.getVm(id);
    const rt = this.runtime(id);
    if (!vm) throw httpError(404, 'Virtual machine not found');
    if (!rt.qmp) throw httpError(409, 'Virtual machine is not running');
    await rt.qmp.execute('system_reset');
    store.addEvent({ action: 'vm.reset', message: `${vm.name} was hard reset`, vmId: id, user });
    return { ok: true };
  }

  async pause(id, user = null) {
    const vm = this.getVm(id);
    const rt = this.runtime(id);
    if (!vm) throw httpError(404, 'Virtual machine not found');
    if (!rt.qmp) throw httpError(409, 'Virtual machine is not running');
    await rt.qmp.execute('stop');
    this.setStatus(id, 'paused');
    store.addEvent({ action: 'vm.pause', message: `${vm.name} paused`, vmId: id, user });
    return { ok: true };
  }

  async resume(id, user = null) {
    const vm = this.getVm(id);
    const rt = this.runtime(id);
    if (!vm) throw httpError(404, 'Virtual machine not found');
    if (!rt.qmp) throw httpError(409, 'Virtual machine is not running');
    await rt.qmp.execute('cont');
    this.setStatus(id, 'running');
    store.addEvent({ action: 'vm.resume', message: `${vm.name} resumed`, vmId: id, user });
    return { ok: true };
  }

  async remove(id, { user = null } = {}) {
    const vm = this.getVm(id);
    if (!vm) throw httpError(404, 'Virtual machine not found');
    const rt = this.runtime(id);
    if (
      rt &&
      (['running', 'paused', 'starting', 'stopping', 'error'].includes(rt.status) ||
        (rt.pid && isPidAlive(rt.pid, vm.id)))
    ) {
      await this.stop(id, { force: true, user });
    }
    this.cleanupRunFiles(id);
    await fsp.rm(vmDir(id), { recursive: true, force: true });
    try {
      fs.unlinkSync(qemuLog(id));
      fs.unlinkSync(serialLog(id));
    } catch {
      /* ignore */
    }
    this.vms.delete(id);
    this.runtimes.delete(id);
    store.addEvent({ action: 'vm.delete', message: `${vm.name} deleted`, vmId: id, user, level: 'warn' });
    this.broadcast('vms-changed', {});
    return { ok: true };
  }

  /* ---------------------------------- config -------------------------------- */

  async create(input, { user = null } = {}) {
    const name = String(input.name || '').trim();
    if (!name) throw httpError(400, 'Name is required');
    if (name.length > 64) throw httpError(400, 'Name must be 64 characters or fewer');
    if ([...this.vms.values()].some((vm) => vm.name.toLowerCase() === name.toLowerCase())) {
      throw httpError(409, `A virtual machine named "${name}" already exists`);
    }
    const cpus = clampInt(input.cpus, 1, 64, 2);
    const memoryMB = clampInt(input.memoryMB, 128, 262144, 2048);
    const id = crypto.randomUUID();
    const vncPort = await this.allocatePort('vnc');
    const sshPort = await this.allocatePort('ssh');
    const now = Date.now();

    const vm = this.normalize({
      id,
      name,
      description: String(input.description || '').slice(0, 500),
      createdAt: now,
      updatedAt: now,
      cpus,
      memoryMB,
      machine: 'q35',
      firmware: input.firmware === 'efi' ? 'efi' : 'bios',
      video: ['std', 'virtio', 'qxl', 'vmware'].includes(input.video) ? input.video : 'std',
      net: {
        mode: input.net?.mode === 'bridge' ? 'bridge' : 'user',
        bridge: String(input.net?.bridge || store.settings.defaultBridge || ''),
        sshPort,
        guestSshPort: clampInt(input.net?.guestSshPort, 1, 65535, 22),
      },
      vncPort,
      bootFrom: input.bootFrom === 'cdrom' ? 'cdrom' : 'disk',
      autostart: Boolean(input.autostart),
      ssh: { user: String(input.sshUser || 'root').slice(0, 32) },
      disks: [],
      cdrom: null,
    });

    await this.persist(vm);
    this.runtimes.set(id, this.emptyRuntime());
    fs.mkdirSync(vmDir(id), { recursive: true });

    const task = store.createTask({ kind: 'vm-create', title: `Create VM ${name}`, vmId: id, user });
    try {
      if (input.diskGB > 0) {
        const disk = await this.createDisk(id, {
          sizeGB: clampInt(input.diskGB, 1, 16384, 20),
          bus: input.diskBus === 'sata' ? 'sata' : 'virtio',
        });
        store.taskLog(task, `Created disk ${disk.file} (${input.diskGB} GB, ${disk.bus})`);
      }
      if (input.isoPath) {
        const iso = await this.resolveIso(input.isoPath);
        if (iso) vm.cdrom = iso;
      }
      await this.persist(vm);
      store.finishTask(task, 'success', 'VM created');
      store.addEvent({
        action: 'vm.create',
        message: `${name} created (${cpus} vCPU, ${memoryMB} MB)`,
        vmId: id,
        user,
      });
      this.broadcast('task', { task });
      this.broadcast('vms-changed', {});
      return vm;
    } catch (err) {
      store.finishTask(task, 'error', err.message);
      this.broadcast('task', { task });
      await fsp.rm(vmDir(id), { recursive: true, force: true }).catch(() => {});
      this.vms.delete(id);
      this.runtimes.delete(id);
      throw err;
    }
  }

  async update(id, patch, { user = null } = {}) {
    const vm = this.getVm(id);
    if (!vm) throw httpError(404, 'Virtual machine not found');
    const rt = this.runtime(id);
    const running = ['running', 'paused', 'starting'].includes(rt.status);

    if (patch.name !== undefined) {
      const name = String(patch.name).trim();
      if (!name) throw httpError(400, 'Name is required');
      if (name.length > 64) throw httpError(400, 'Name must be 64 characters or fewer');
      const clash = [...this.vms.values()].some(
        (other) => other.id !== id && other.name.toLowerCase() === name.toLowerCase(),
      );
      if (clash) throw httpError(409, 'Another VM already uses that name');
      vm.name = name;
    }
    if (patch.description !== undefined) vm.description = String(patch.description).slice(0, 500);

    const hardwareChange =
      patch.cpus !== undefined || patch.memoryMB !== undefined || patch.firmware !== undefined;

    if (hardwareChange && running) {
      throw httpError(409, 'Stop the VM before changing CPU, memory or firmware');
    }
    if (patch.cpus !== undefined) vm.cpus = clampInt(patch.cpus, 1, 64, vm.cpus);
    if (patch.memoryMB !== undefined) vm.memoryMB = clampInt(patch.memoryMB, 128, 262144, vm.memoryMB);
    if (patch.firmware !== undefined) vm.firmware = patch.firmware === 'efi' ? 'efi' : 'bios';
    if (patch.video !== undefined && ['std', 'virtio', 'qxl', 'vmware'].includes(patch.video)) {
      vm.video = patch.video;
    }
    if (patch.autostart !== undefined) vm.autostart = Boolean(patch.autostart);
    if (patch.bootFrom !== undefined) vm.bootFrom = patch.bootFrom === 'cdrom' ? 'cdrom' : 'disk';
    if (patch.sshUser !== undefined) vm.ssh.user = String(patch.sshUser).slice(0, 32);
    if (patch.cdrom !== undefined) {
      vm.cdrom = patch.cdrom ? await this.resolveIso(patch.cdrom) : null;
      if (patch.cdrom && !vm.cdrom) throw httpError(400, 'ISO file not found');
    }
    if (patch.net !== undefined) {
      if (running) throw httpError(409, 'Stop the VM before changing networking');
      if (patch.net.mode !== undefined) vm.net.mode = patch.net.mode === 'bridge' ? 'bridge' : 'user';
      if (patch.net.bridge !== undefined) vm.net.bridge = String(patch.net.bridge).slice(0, 32);
      if (patch.net.mac !== undefined && /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(patch.net.mac)) {
        vm.net.mac = patch.net.mac.toLowerCase();
      }
      if (patch.net.guestSshPort !== undefined) {
        vm.net.guestSshPort = clampInt(patch.net.guestSshPort, 1, 65535, 22);
      }
    }
    if (patch.extraArgs !== undefined) {
      if (running) throw httpError(409, 'Stop the VM before editing advanced arguments');
      vm.extraArgs = Array.isArray(patch.extraArgs)
        ? patch.extraArgs.map(String).filter(Boolean).slice(0, 40)
        : [];
    }
    await this.persist(vm);
    store.addEvent({ action: 'vm.update', message: `${vm.name} configuration updated`, vmId: id, user });
    this.broadcast('vms-changed', {});
    return vm;
  }

  async resolveIso(inputPath) {
    const candidate = path.resolve(String(inputPath));
    const allowed = [ISO_DIR, store.settings.isoDir].filter(Boolean).map((p) => path.resolve(p));
    const inside = allowed.some((dir) => candidate === dir || candidate.startsWith(`${dir}${path.sep}`));
    if (!inside) throw httpError(400, 'ISO must live in the ISO library directory');
    try {
      const stat = await fsp.stat(candidate);
      if (!stat.isFile()) return null;
      return candidate;
    } catch {
      return null;
    }
  }

  /* ----------------------------------- disks -------------------------------- */

  async createDisk(id, { sizeGB = 20, bus = 'virtio', format = 'qcow2' } = {}) {
    const vm = this.getVm(id);
    if (!vm) throw httpError(404, 'Virtual machine not found');
    const diskId = crypto.randomBytes(4).toString('hex');
    const file = `disk-${diskId}.qcow2`;
    const full = vmPath(id, file);
    await fsp.mkdir(vmDir(id), { recursive: true });
    await runCommand('qemu-img', [
      'create',
      '-f',
      format,
      '-o',
      'preallocation=metadata',
      full,
      `${sizeGB}G`,
    ]);
    const disk = {
      id: diskId,
      file,
      format,
      bus: bus === 'sata' ? 'sata' : 'virtio',
      sizeGB: Number(sizeGB),
    };
    vm.disks.push(disk);
    await this.persist(vm);
    this.diskCache.delete(full);
    this.broadcast('vms-changed', {});
    return disk;
  }

  async addDisk(id, options, { user = null } = {}) {
    const vm = this.getVm(id);
    if (!vm) throw httpError(404, 'Virtual machine not found');
    const rt = this.runtime(id);
    const task = store.createTask({ kind: 'disk-create', title: `Add disk to ${vm.name}`, vmId: id, user });
    try {
      if (['running', 'paused'].includes(rt.status)) {
        // Hot-plug a qcow2 disk through QMP, then persist it.
        const sizeGB = clampInt(options.sizeGB, 1, 16384, 20);
        const diskId = crypto.randomBytes(4).toString('hex');
        const file = `disk-${diskId}.qcow2`;
        const full = vmPath(id, file);
        await runCommand('qemu-img', ['create', '-f', 'qcow2', '-o', 'preallocation=metadata', full, `${sizeGB}G`]);
        const node = `emuman-${diskId}`;
        await rt.qmp.execute('blockdev-add', {
          node,
          driver: 'qcow2',
          file: { driver: 'file', filename: full },
        });
        await rt.qmp.execute('device_add', {
          driver: 'virtio-blk-pci',
          id: `disk-${diskId}`,
          drive: node,
          serial: diskId,
        });
        const disk = { id: diskId, file, format: 'qcow2', bus: 'virtio', sizeGB };
        vm.disks.push(disk);
        await this.persist(vm);
        store.taskLog(task, `Hot-plugged ${file} (${sizeGB} GB)`);
        store.finishTask(task, 'success', 'Disk hot-plugged');
        this.broadcast('task', { task });
        this.broadcast('vms-changed', {});
        return disk;
      }
      const disk = await this.createDisk(id, options);
      store.taskLog(task, `Created ${disk.file} (${disk.sizeGB} GB)`);
      store.finishTask(task, 'success', 'Disk created');
      this.broadcast('task', { task });
      store.addEvent({ action: 'disk.create', message: `${vm.name}: added ${disk.sizeGB} GB disk`, vmId: id, user });
      return disk;
    } catch (err) {
      store.finishTask(task, 'error', err.message);
      this.broadcast('task', { task });
      throw err;
    }
  }

  async removeDisk(id, diskId, { deleteFile = false, user = null } = {}) {
    const vm = this.getVm(id);
    if (!vm) throw httpError(404, 'Virtual machine not found');
    const rt = this.runtime(id);
    if (['running', 'paused', 'starting', 'stopping'].includes(rt.status)) {
      throw httpError(409, 'Stop the VM before removing a disk');
    }
    const disk = vm.disks.find((d) => d.id === diskId);
    if (!disk) throw httpError(404, 'Disk not found');
    vm.disks = vm.disks.filter((d) => d.id !== diskId);
    await this.persist(vm);
    if (deleteFile) {
      await fsp.rm(vmPath(id, disk.file), { force: true }).catch(() => {});
    }
    store.addEvent({ action: 'disk.remove', message: `${vm.name}: removed disk ${disk.id}`, vmId: id, user });
    this.broadcast('vms-changed', {});
    return { ok: true };
  }

  async resizeDisk(id, diskId, sizeGB, { user = null } = {}) {
    const vm = this.getVm(id);
    if (!vm) throw httpError(404, 'Virtual machine not found');
    const rt = this.runtime(id);
    if (['running', 'paused', 'starting', 'stopping'].includes(rt.status)) {
      throw httpError(409, 'Stop the VM before resizing a disk');
    }
    const disk = vm.disks.find((d) => d.id === diskId);
    if (!disk) throw httpError(404, 'Disk not found');
    const size = clampInt(sizeGB, 1, 65536, disk.sizeGB);
    await runCommand('qemu-img', ['resize', vmPath(id, disk.file), `${size}G`]);
    disk.sizeGB = size;
    await this.persist(vm);
    this.diskCache.clear();
    store.addEvent({ action: 'disk.resize', message: `${vm.name}: disk resized to ${size} GB`, vmId: id, user });
    this.broadcast('vms-changed', {});
    return disk;
  }

  async diskUsage(vm) {
    const out = [];
    for (const disk of vm.disks) {
      const info = await this.diskInfo(vmPath(vm.id, disk.file));
      out.push({
        ...disk,
        path: vmPath(vm.id, disk.file),
        actualSize: info?.actualSize ?? null,
        virtualSize: info?.virtualSize ?? disk.sizeGB * 1024 ** 3,
        snapshots: info?.snapshots ?? 0,
      });
    }
    return out;
  }

  /* -------------------------------- snapshots ------------------------------- */

  async snapshots(id) {
    const vm = this.getVm(id);
    if (!vm) throw httpError(404, 'Virtual machine not found');
    const rt = this.runtime(id);
    if (rt.qmp) {
      const out = await rt.qmp.hmp('info snapshots');
      return parseHmpSnapshots(out);
    }
    const disk = vm.disks.find((d) => d.format === 'qcow2');
    if (!disk) return [];
    return this.qemuImgSnapshots(vmPath(id, disk.file));
  }

  async qemuImgSnapshots(file) {
    try {
      const out = await runCommand('qemu-img', ['snapshot', '-l', '--output=json', file]);
      const parsed = JSON.parse(out || '[]');
      return parsed.map((s) => ({
        id: s.id ?? null,
        name: s.name,
        vmSize: s['vm_size'] ?? null,
        date: s.date ?? null,
        vmClock: s['vm_clock'] ?? null,
      }));
    } catch {
      return [];
    }
  }

  async createSnapshot(id, name, { user = null } = {}) {
    const vm = this.getVm(id);
    if (!vm) throw httpError(404, 'Virtual machine not found');
    if (!SNAP_NAME_RE.test(String(name || ''))) {
      throw httpError(400, 'Snapshot name may contain letters, digits, dot, dash and underscore');
    }
    const qcow2Disks = vm.disks.filter((d) => (d.format || 'qcow2') === 'qcow2');
    if (!qcow2Disks.length) throw httpError(400, 'Snapshots require at least one qcow2 disk');
    const rt = this.runtime(id);
    const task = store.createTask({ kind: 'snapshot', title: `Snapshot ${vm.name} → ${name}`, vmId: id, user });
    try {
      if (rt.qmp) {
        await rt.qmp.hmp(`savevm ${name}`);
        store.taskLog(task, 'QEMU savevm completed (disk + VM state)');
      } else {
        for (const disk of qcow2Disks) {
          await runCommand('qemu-img', ['snapshot', '-c', name, vmPath(id, disk.file)]);
          store.taskLog(task, `Snapshot written to ${disk.file}`);
        }
      }
      store.finishTask(task, 'success', 'Snapshot created');
      store.addEvent({ action: 'snapshot.create', message: `${vm.name}: snapshot "${name}" created`, vmId: id, user });
      this.broadcast('task', { task });
      return { ok: true };
    } catch (err) {
      store.finishTask(task, 'error', err.message);
      this.broadcast('task', { task });
      throw httpError(500, `Snapshot failed: ${err.message}`);
    }
  }

  async restoreSnapshot(id, name, { user = null } = {}) {
    const vm = this.getVm(id);
    if (!vm) throw httpError(404, 'Virtual machine not found');
    if (!SNAP_NAME_RE.test(String(name || ''))) throw httpError(400, 'Invalid snapshot name');
    const list = await this.snapshots(id);
    if (!list.some((s) => s.name === name)) throw httpError(404, 'Snapshot not found');
    const rt = this.runtime(id);
    if (['running', 'paused', 'starting'].includes(rt.status)) {
      await this.stop(id, { force: true, user });
    }
    await this.start(id, { loadvm: name, user });
    store.addEvent({ action: 'snapshot.restore', message: `${vm.name}: restored snapshot "${name}"`, vmId: id, user });
    return { ok: true };
  }

  async deleteSnapshot(id, name, { user = null } = {}) {
    const vm = this.getVm(id);
    if (!vm) throw httpError(404, 'Virtual machine not found');
    if (!SNAP_NAME_RE.test(String(name || ''))) throw httpError(400, 'Invalid snapshot name');
    const rt = this.runtime(id);
    try {
      if (rt.qmp) {
        await rt.qmp.hmp(`delvm ${name}`);
      } else {
        const qcow2Disks = vm.disks.filter((d) => (d.format || 'qcow2') === 'qcow2');
        for (const disk of qcow2Disks) {
          await runCommand('qemu-img', ['snapshot', '-d', name, vmPath(id, disk.file)]);
        }
      }
    } catch (err) {
      throw httpError(500, `Could not delete snapshot: ${err.message}`);
    }
    store.addEvent({ action: 'snapshot.delete', message: `${vm.name}: snapshot "${name}" deleted`, vmId: id, user });
    return { ok: true };
  }

  async clone(id, { name, user = null } = {}) {
    const source = this.getVm(id);
    if (!source) throw httpError(404, 'Virtual machine not found');
    const rt = this.runtime(id);
    if (['running', 'paused', 'starting'].includes(rt.status)) {
      throw httpError(409, 'Stop the VM before cloning it');
    }
    const cloneName = String(name || `${source.name} clone`).trim().slice(0, 64);
    if ([...this.vms.values()].some((vm) => vm.name.toLowerCase() === cloneName.toLowerCase())) {
      throw httpError(409, `A virtual machine named "${cloneName}" already exists`);
    }
    const newId = crypto.randomUUID();
    const dir = vmDir(newId);
    await fsp.mkdir(dir, { recursive: true });
    const task = store.createTask({ kind: 'clone', title: `Clone ${source.name} → ${cloneName}`, vmId: id, user });
    try {
      const disks = [];
      for (const disk of source.disks) {
        const src = vmPath(id, disk.file);
        if (!fs.existsSync(src)) continue;
        const diskId = crypto.randomBytes(4).toString('hex');
        const file = `disk-${diskId}.qcow2`;
        await runCommand('qemu-img', ['convert', '-O', 'qcow2', src, path.join(dir, file)]);
        disks.push({ ...disk, id: diskId, file });
        store.taskLog(task, `Copied ${disk.file} → ${file}`);
      }
      if (source.firmware === 'efi') {
        const vars = vmPath(id, 'efivars.fd');
        if (fs.existsSync(vars)) await fsp.copyFile(vars, path.join(dir, 'efivars.fd'));
      }
      const vncPort = await this.allocatePort('vnc');
      const sshPort = await this.allocatePort('ssh');
      const now = Date.now();
      const clone = this.normalize({
        ...source,
        id: newId,
        name: cloneName,
        createdAt: now,
        updatedAt: now,
        disks,
        vncPort,
        net: { ...source.net, mac: randomMac(), sshPort },
        autostart: false,
      });
      delete clone.stats;
      await this.persist(clone);
      this.runtimes.set(newId, this.emptyRuntime());
      store.finishTask(task, 'success', 'Clone created');
      store.addEvent({ action: 'vm.clone', message: `${source.name} cloned to ${cloneName}`, vmId: id, user });
      this.broadcast('task', { task });
      this.broadcast('vms-changed', {});
      return clone;
    } catch (err) {
      store.finishTask(task, 'error', err.message);
      this.broadcast('task', { task });
      await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
      throw err;
    }
  }

  /* ---------------------------------- metrics ------------------------------- */

  /**
   * Self-heal runtime state for guests this process did not spawn. After an API restart the
   * machines are adopted through their pidfile/QMP socket, so no child `exit` event will ever
   * fire for them: without this check a guest powered off from inside (or a crashed), guest
   * would keep reporting `running`/`stopping` and its console would stay unusable.
   */
  reconcileRuntimes() {
    for (const [id, rt] of this.runtimes) {
      if (!rt.pid || rt.status === 'stopped') continue;
      if (isPidAlive(rt.pid, id)) continue;
      const name = this.getVm(id)?.name || id;
      try {
        rt.qmp?.close();
      } catch {
        /* ignore */
      }
      rt.pid = null;
      rt.qmp = null;
      rt.startedAt = null;
      rt.cpuPct = 0;
      rt.memBytes = 0;
      rt.lastError = null;
      this.cleanupRunFiles(id);
      this.setStatus(id, 'stopped');
      log.info('vm', `${name} is no longer running (process exited)`);
    }
  }

  startSampling() {
    if (this._timer) clearInterval(this._timer);
    const interval = Math.max(1000, Number(store.settings.metricsIntervalMs) || 2000);
    this._timer = setInterval(() => {
      this.sampleMetrics().catch((err) => log.warn('metrics', err.message));
    }, interval);
    this._timer.unref?.();
  }

  async sampleMetrics() {
    const now = Date.now();
    this.reconcileRuntimes();
    for (const vm of this.vms.values()) {
      const rt = this.runtime(vm.id);
      if (!rt || !rt.pid) continue;
      const stat = readProcStat(rt.pid);
      if (!stat) continue;
      let cpuPct = 0;
      if (rt.prevTicks && rt.prevSampleAt) {
        const dt = (now - rt.prevSampleAt) / 1000;
        if (dt > 0) {
          const ticks = stat.utime + stat.stime - rt.prevTicks;
          cpuPct = Math.max(0, Math.min(100 * vm.cpus, (ticks / HZ / dt) * 100));
        }
      }
      rt.prevTicks = stat.utime + stat.stime;
      rt.prevSampleAt = now;
      rt.cpuPct = Math.round(cpuPct * 10) / 10;
      rt.memBytes = stat.rssPages * 4096;
      const point = { t: now, cpu: rt.cpuPct, mem: rt.memBytes };
      rt.history.push(point);
      if (rt.history.length > 90) rt.history.shift();
      this.broadcast('vm-metrics', {
        id: vm.id,
        cpuPct: rt.cpuPct,
        memBytes: rt.memBytes,
        history: rt.history,
        status: rt.status,
        pid: rt.pid,
        startedAt: rt.startedAt,
      });
    }
    if (!this.hostPrev || now - (this.hostPrevSampleAt || 0) >= 2000) {
      await this.refreshHostInfo();
      this.broadcast('host-metrics', this.hostSnapshot());
    }
  }

  async refreshHostInfo() {
    const cpus = os.cpus();
    const totals = cpus.reduce(
      (acc, cpu) => {
        const t = cpu.times;
        acc.idle += t.idle;
        acc.total += t.user + t.nice + t.sys + t.idle + t.irq;
        return acc;
      },
      { idle: 0, total: 0 },
    );
    let cpuPct = 0;
    if (this.hostPrev) {
      const idleDelta = totals.idle - this.hostPrev.idle;
      const totalDelta = totals.total - this.hostPrev.total;
      if (totalDelta > 0) cpuPct = Math.max(0, Math.min(100, (1 - idleDelta / totalDelta) * 100));
    }
    this.hostPrev = totals;
    this.hostPrevSampleAt = Date.now();
    let storage = { total: 0, free: 0, used: 0 };
    try {
      const stat = await fsp.statfs(store.settings.storageDir || VMS_DIR);
      const total = stat.blocks * stat.bsize;
      const free = stat.bavail * stat.bsize;
      storage = { total, free, used: total - free };
    } catch {
      /* ignore */
    }
    this.hostInfo = {
      cpuPct: Math.round(cpuPct * 10) / 10,
      load: os.loadavg().map((n) => Math.round(n * 100) / 100),
      memTotal: os.totalmem(),
      memFree: os.freemem(),
      memUsed: os.totalmem() - os.freemem(),
      uptime: os.uptime(),
      storage,
      sampleAt: Date.now(),
    };
  }

  hostSnapshot() {
    const running = [...this.runtimes.values()].filter((r) =>
      ['running', 'paused', 'stopping', 'starting'].includes(r.status),
    );
    const allocatedMem = [...this.vms.values()]
      .filter((vm) => {
        const rt = this.runtime(vm.id);
        return rt && ['running', 'paused', 'starting'].includes(rt.status);
      })
      .reduce((sum, vm) => sum + vm.memoryMB * 1024 * 1024, 0);
    return {
      ...this.hostInfo,
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      release: os.release(),
      cpuModel: os.cpus()[0]?.model || 'Unknown CPU',
      cpuCount: os.cpus().length,
      qemuVersion: this.qemuVersion,
      kvm: this.kvm,
      vmCount: this.vms.size,
      runningCount: running.length,
      allocatedMem,
      firmware: this.firmware.map((f) => path.basename(f.code)),
      dataDir: paths.data,
      isoDir: store.settings.isoDir,
      qemuPath: store.settings.qemuPath,
      storageDir: store.settings.storageDir,
      isoCount: this._isoCount || 0,
    };
  }

  async setIsoCount() {
    this._isoCount = (await this.scanIsos()).length;
  }

  async screenshot(id) {
    const vm = this.getVm(id);
    if (!vm) throw httpError(404, 'Virtual machine not found');
    const rt = this.runtime(id);
    if (!rt?.qmp || !['running', 'paused'].includes(rt.status)) {
      throw httpError(409, 'Virtual machine is not running');
    }
    const file = path.join(paths.data, 'tmp', `screen-${id}.png`);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await rt.qmp.execute('screendump', { filename: file, format: 'png' });
    const buf = await fsp.readFile(file);
    await fsp.rm(file, { force: true });
    return buf;
  }

  async tailSerial(id, bytes = 256 * 1024) {
    return readFileIfExists(serialLog(id), bytes);
  }

  async tailQemuLog(id, bytes = 128 * 1024) {
    return readFileIfExists(qemuLog(id), bytes);
  }

  async serialAvailable(id) {
    const vm = this.getVm(id);
    const rt = this.runtime(id);
    if (!vm || !vm.serialEnabled) return false;
    if (!rt || !['running', 'paused'].includes(rt.status)) return false;
    return fs.existsSync(serialSocket(id));
  }
}

export function parseHmpSnapshots(output) {
  const result = [];
  const lines = String(output || '').split('\n');
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    if (/^List of snapshots/i.test(line)) continue;
    if (/^ID\s+TAG/i.test(line)) continue;
    const match = line.match(/^\s*(\d+|--)\s+(\S+)\s+(.*)$/);
    if (!match) continue;
    const [, idRaw, name, rest] = match;
    if (!name || name === 'TAG') continue;
    const dateMatch = rest.match(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/);
    const clockMatch = rest.match(/(\d{2}:\d{2}:\d{2}\.\d+)/);
    result.push({
      id: idRaw === '--' ? null : Number(idRaw),
      name,
      vmSize: dateMatch ? rest.slice(0, dateMatch.index).trim() || null : rest.trim() || null,
      date: dateMatch ? dateMatch[1] : null,
      vmClock: clockMatch ? clockMatch[1] : null,
    });
  }
  return result;
}

export function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function httpError(status, message, extra = null) {
  const err = new Error(message);
  err.statusCode = status;
  if (extra) err.extra = extra;
  return err;
}

function runCommand(command, args, { timeoutMs = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${command} timed out`));
    }, timeoutMs);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
    });
  });
}

export const vmManager = new VMManager();
