import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pipeline } from 'node:stream/promises';
import { vmManager, httpError } from '../vm-manager.js';
import { store } from '../store.js';
import { requirePermission } from '../permissions.js';
import { log } from '../log.js';
import { paths, VERSION } from '../env.js';

const UPLOAD_RE = /\.(iso|img)$/i;

function safeIsoName(name) {
  const base = path.basename(String(name || 'upload.iso')).replace(/[^a-zA-Z0-9._ ()-]/g, '_');
  return base.slice(-180) || `upload-${Date.now()}.iso`;
}

export default async function hostRoutes(app) {
  app.get('/info', { preHandler: requirePermission('host.read') }, async () => {
    await vmManager.refreshHostInfo();
    return {
      ...vmManager.hostSnapshot(),
      version: VERSION,
      nodeVersion: process.version,
      username: process.env.USER || os.userInfo().username,
      sshDefaultUser: process.env.USER || os.userInfo().username,
      settings: store.settings,
      limits: {
        maxIsoUpload: 32 * 1024 ** 3,
      },
      serverTime: Date.now(),
    };
  });

  app.get('/isos', { preHandler: requirePermission('host.read') }, async () => {
    const isos = await vmManager.scanIsos();
    vmManager._isoCount = isos.length;
    return { isos, dirs: [...new Set([paths.isos, store.settings.isoDir].filter(Boolean))] };
  });

  app.post('/isos', { preHandler: requirePermission('iso.manage') }, async (req, reply) => {
    let file;
    try {
      file = await req.file();
    } catch (err) {
      return reply.code(400).send({ error: `Upload failed: ${err.message}` });
    }
    if (!file) return reply.code(400).send({ error: 'No file provided' });
    const filename = safeIsoName(file.filename);
    if (!UPLOAD_RE.test(filename)) {
      return reply.code(400).send({ error: 'Only .iso and .img files are allowed' });
    }
    const dir = store.settings.isoDir || paths.isos;
    await fsp.mkdir(dir, { recursive: true });
    let dest = path.join(dir, filename);
    if (fs.existsSync(dest)) {
      const ext = path.extname(filename);
      const stem = filename.slice(0, -ext.length);
      dest = path.join(dir, `${stem}-${Date.now()}${ext}`);
    }
    try {
      await pipeline(file.file, fs.createWriteStream(dest, { mode: 0o644 }));
      if (file.file.truncated) {
        await fsp.rm(dest, { force: true });
        return reply.code(413).send({ error: 'ISO exceeds the upload size limit' });
      }
      const stat = await fsp.stat(dest);
      vmManager._isoCount = (await vmManager.scanIsos()).length;
      store.addEvent({
        action: 'iso.upload',
        message: `${req.user.username} uploaded ${path.basename(dest)} (${(stat.size / 1024 ** 3).toFixed(2)} GB)`,
        user: req.user.username,
      });
      reply.code(201);
      return { ok: true, iso: { name: path.basename(dest), path: dest, size: stat.size } };
    } catch (err) {
      await fsp.rm(dest, { force: true }).catch(() => {});
      log.error('iso', `upload failed: ${err.message}`);
      return reply.code(500).send({ error: `Could not store ISO: ${err.message}` });
    }
  });

  app.delete('/isos', { preHandler: requirePermission('iso.manage') }, async (req, reply) => {
    const requested = String(req.query?.path || '');
    if (!requested) return reply.code(400).send({ error: 'path is required' });
    const resolved = path.resolve(requested);
    const allowed = [...new Set([paths.isos, store.settings.isoDir])]
      .filter(Boolean)
      .map((p) => path.resolve(p));
    if (!allowed.some((dir) => resolved.startsWith(`${dir}${path.sep}`))) {
      return reply.code(400).send({ error: 'ISO is outside the ISO library' });
    }
    const inUse = [...vmManager.vms.values()].filter((vm) => vm.cdrom === resolved);
    if (inUse.length) {
      return reply.code(409).send({
        error: `ISO is attached to ${inUse.map((vm) => vm.name).join(', ')}`,
      });
    }
    await fsp.rm(resolved, { force: true });
    vmManager._isoCount = (await vmManager.scanIsos()).length;
    store.addEvent({
      action: 'iso.delete',
      message: `${req.user.username} deleted ${path.basename(resolved)}`,
      user: req.user.username,
    });
    return { ok: true };
  });

  app.get('/storage', { preHandler: requirePermission('host.read') }, async () => {
    const vms = [];
    let diskTotal = 0;
    let diskAllocated = 0;
    for (const vm of [...vmManager.vms.values()].sort((a, b) => a.name.localeCompare(b.name))) {
      const disks = await vmManager.diskUsage(vm);
      const totalActual = disks.reduce((s, d) => s + (d.actualSize || 0), 0);
      const totalVirtual = disks.reduce((s, d) => s + (d.virtualSize || 0), 0);
      diskTotal += totalVirtual;
      diskAllocated += totalActual;
      vms.push({
        id: vm.id,
        name: vm.name,
        status: vmManager.runtime(vm.id)?.status || 'stopped',
        disks: disks.map((d) => ({
          ...d,
          path: path.join(paths.vms, vm.id, d.file),
        })),
      });
    }
    const isos = await vmManager.scanIsos();
    vmManager._isoCount = isos.length;
    return {
      vms,
      isos,
      totals: {
        diskVirtual: diskTotal,
        diskActual: diskAllocated,
        isoSize: isos.reduce((s, i) => s + i.size, 0),
      },
      host: vmManager.hostSnapshot().storage,
    };
  });

  app.get('/events', { preHandler: requirePermission('audit.read') }, async (req) => ({
    events: store.events(Math.min(500, Number(req.query?.limit) || 100)),
  }));

  app.get('/tasks', { preHandler: requirePermission('host.read') }, async (req) => ({
    tasks: store.tasks(Math.min(50, Number(req.query?.limit) || 20)),
  }));

  app.get('/logs', { preHandler: requirePermission('host.logs') }, async (req) => ({
    logs: log.recent(Math.min(500, Number(req.query?.limit) || 200)),
  }));

  const firmwareNames = () => vmManager.firmware.map((f) => f.code);

  app.get('/settings', { preHandler: requirePermission('host.settings') }, async () => ({
    settings: store.settings,
    firmware: firmwareNames(),
    qemuVersion: vmManager.qemuVersion,
    kvm: vmManager.kvm,
  }));

  app.patch('/settings', { preHandler: requirePermission('host.settings') }, async (req, reply) => {
    const patch = req.body || {};
    if (patch.qemuPath && !fs.existsSync(patch.qemuPath)) {
      return reply.code(400).send({ error: 'QEMU binary not found at that path' });
    }
    if (patch.isoDir) {
      try {
        await fsp.mkdir(path.resolve(patch.isoDir), { recursive: true });
      } catch (err) {
        return reply.code(400).send({ error: `Cannot create ISO directory: ${err.message}` });
      }
    }
    if (patch.storageDir) {
      try {
        await fsp.mkdir(path.resolve(patch.storageDir), { recursive: true });
      } catch (err) {
        return reply.code(400).send({ error: `Cannot create storage directory: ${err.message}` });
      }
    }
    const settings = store.updateSettings(patch);
    if (patch.qemuPath) await vmManager.detectQemu();
    if (patch.metricsIntervalMs) vmManager.startSampling();
    store.addEvent({
      action: 'host.settings',
      message: `${req.user.username} updated host settings`,
      user: req.user.username,
    });
    return { settings, firmware: firmwareNames(), qemuVersion: vmManager.qemuVersion };
  });

  app.post('/qemu/detect', { preHandler: requirePermission('host.settings') }, async () => {
    await vmManager.detectQemu();
    return { qemuVersion: vmManager.qemuVersion, kvm: vmManager.kvm, path: store.settings.qemuPath };
  });

  app.get('/known-hosts', { preHandler: requirePermission('host.settings') }, async () => ({
    hosts: Object.entries(store.db.knownHosts).map(([host, info]) => ({ host, ...info })),
  }));

  app.delete('/known-hosts', { preHandler: requirePermission('host.settings') }, async (req, reply) => {
    const host = String(req.query?.host || '');
    if (!host) return reply.code(400).send({ error: 'host is required' });
    store.removeKnownHost(host);
    return { ok: true };
  });

  app.get('/bridges', { preHandler: requirePermission('host.read') }, async () => {
    const sys = path.join('/sys/class/net');
    const bridges = [];
    try {
      for (const name of await fsp.readdir(sys)) {
        try {
          if (fs.existsSync(path.join(sys, name, 'bridge'))) bridges.push(name);
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }
    return { bridges };
  });
}

export { httpError };
