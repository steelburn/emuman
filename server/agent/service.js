import { vmManager, httpError, clampInt } from '../vm-manager.js';
import { store } from '../store.js';
import { applyInput, displaySize, pngSize, writeSerial } from './input.js';
import { guestExec } from './exec.js';
import { log } from '../log.js';

const ACTIONS = ['start', 'stop', 'shutdown', 'reboot', 'pause', 'resume'];
const EXPECTED_STATUS = {
  start: 'running',
  resume: 'running',
  pause: 'paused',
  stop: 'stopped',
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function vmStatus(id) {
  return vmManager.runtime(id)?.status || 'stopped';
}

export function listVms() {
  return vmManager.list().map((vm) => ({
    ...vm,
    hasSavedSshPassword: Boolean(vmManager.getVm(vm.id)?.ssh?.savedPassword),
  }));
}

export async function listIsos() {
  return (await vmManager.scanIsos()).map(({ dir, ...iso }) => iso);
}

export async function getVm(id) {
  const vm = vmManager.getVm(id);
  if (!vm) throw httpError(404, 'Virtual machine not found');
  const rt = vmManager.runtime(id) || {};
  const disks = await vmManager.diskUsage(vm);
  return {
    ...vmManager.summary(vm),
    id: vm.id,
    name: vm.name,
    description: vm.description,
    machine: vm.machine,
    video: vm.video,
    bootFrom: vm.bootFrom,
    serialEnabled: vm.serialEnabled,
    extraArgs: vm.extraArgs,
    net: vm.net,
    ssh: {
      user: vm.ssh?.user || 'root',
      enabled: vm.ssh?.enabled !== false,
      hasSavedPassword: Boolean(vm.ssh?.savedPassword),
      hasSavedKey: Boolean(vm.ssh?.savedKey),
    },
    diskCount: vm.disks.length,
    disks,
    display: rt.display ? { width: rt.display.width, height: rt.display.height } : null,
    runtime: {
      status: rt.status || 'stopped',
      pid: rt.pid || null,
      startedAt: rt.startedAt || null,
      uptimeMs: rt.startedAt ? Date.now() - rt.startedAt : 0,
      cpuPct: rt.cpuPct || 0,
      memBytes: rt.memBytes || 0,
      lastError: rt.lastError || null,
    },
  };
}

export async function waitForStatus(id, status, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rt = vmManager.runtime(id);
    if (rt && rt.status === status) return rt.status;
    if (rt && rt.status === 'error') return rt.status;
    await sleep(250);
  }
  return vmManager.runtime(id)?.status || 'unknown';
}

export async function vmAction(id, action, { actor, waitMs = 5000 } = {}) {
  if (!ACTIONS.includes(action)) {
    throw httpError(400, `action must be one of ${ACTIONS.join(', ')}`);
  }
  if (!vmManager.getVm(id)) throw httpError(404, 'Virtual machine not found');
  const user = `agent:${actor || 'agent'}`;
  let pending = false;
  switch (action) {
    case 'start':
      await vmManager.start(id, { user });
      break;
    case 'stop':
      pending = Boolean((await vmManager.stop(id, { force: true, user })).pending);
      break;
    case 'shutdown':
      pending = Boolean((await vmManager.stop(id, { force: false, user })).pending);
      break;
    case 'reboot':
      await vmManager.reset(id, user);
      break;
    case 'pause':
      await vmManager.pause(id, user);
      break;
    case 'resume':
      await vmManager.resume(id, user);
      break;
    default:
      break;
  }
  const status = EXPECTED_STATUS[action]
    ? await waitForStatus(id, EXPECTED_STATUS[action], Math.min(15000, Number(waitMs) || 0))
    : vmManager.runtime(id)?.status;
  // `pending` tells callers the request was accepted but the guest has not powered off yet
  // (for example an ACPI shutdown the guest ignored), so "still running" is not a failure.
  return { ok: true, action, status, ...(pending ? { pending: true } : {}) };
}

function pick(input, camel, snake) {
  return input[camel] !== undefined ? input[camel] : input[snake];
}

export async function createVm(input, { actor } = {}) {
  const diskGB = pick(input, 'diskGB', 'disk_gb');
  const vm = await vmManager.create(
    {
      name: input.name,
      description: input.description,
      cpus: pick(input, 'cpus', 'cpus'),
      memoryMB: pick(input, 'memoryMB', 'memory_mb'),
      diskGB,
      diskBus: pick(input, 'diskBus', 'disk_bus'),
      isoPath: pick(input, 'isoPath', 'iso_path'),
      firmware: pick(input, 'firmware', 'firmware'),
      video: pick(input, 'video', 'video'),
      bootFrom: pick(input, 'bootFrom', 'boot_from'),
      autostart: pick(input, 'autostart', 'autostart'),
      sshUser: pick(input, 'sshUser', 'ssh_user'),
      net: input.net,
    },
    { user: `agent:${actor || 'agent'}` },
  );
  let started = false;
  if (input.start) {
    try {
      await vmManager.start(vm.id, { user: `agent:${actor || 'agent'}` });
      started = true;
    } catch (err) {
      log.warn('agent', `created ${vm.name} but failed to start: ${err.message}`);
    }
  }
  return { ...(await getVm(vm.id)), started };
}

export async function deleteVm(id, { actor } = {}) {
  await vmManager.remove(id, { user: `agent:${actor || 'agent'}` });
  return { ok: true, id };
}

export async function cloneVm(id, { name, actor } = {}) {
  const clone = await vmManager.clone(id, { name, user: `agent:${actor || 'agent'}` });
  return getVm(clone.id);
}

export async function screenshot(id) {
  const vm = vmManager.getVm(id);
  if (!vm) throw httpError(404, 'Virtual machine not found');
  const buffer = await vmManager.screenshot(id);
  const size = pngSize(buffer);
  const rt = vmManager.runtime(id);
  if (size && rt) rt.display = { ...size, at: Date.now() };
  return { buffer, width: size?.width || null, height: size?.height || null };
}

export async function screen(id) {
  const shot = await screenshot(id);
  return {
    vmId: id,
    mimeType: 'image/png',
    width: shot.width,
    height: shot.height,
    imageBase64: shot.buffer.toString('base64'),
  };
}

export async function input(id, payload = {}) {
  const vm = vmManager.getVm(id);
  if (!vm) throw httpError(404, 'Virtual machine not found');
  const normalized = {
    ...payload,
    intervalMs: payload.intervalMs ?? payload.interval_ms,
    fromX: payload.fromX ?? payload.from_x,
    fromY: payload.fromY ?? payload.from_y,
    toX: payload.toX ?? payload.to_x,
    toY: payload.toY ?? payload.to_y,
  };
  const result = await applyInput(vm, normalized);
  return { ok: true, vmId: id, ...result };
}

export async function serialRead(id, { limit = 65536 } = {}) {
  const vm = vmManager.getVm(id);
  if (!vm) throw httpError(404, 'Virtual machine not found');
  const bytes = clampInt(limit, 1024, 512 * 1024, 65536);
  return {
    vmId: id,
    available: await vmManager.serialAvailable(id),
    text: await vmManager.tailSerial(id, bytes),
  };
}

export async function serialWrite(id, payload = {}) {
  const vm = vmManager.getVm(id);
  if (!vm) throw httpError(404, 'Virtual machine not found');
  const appendNewline = payload.appendNewline ?? payload.append_newline ?? true;
  return {
    ok: true,
    ...(await writeSerial(vm, { text: payload.text, appendNewline })),
  };
}

export async function execInGuest(id, options = {}, { actor } = {}) {
  const vm = vmManager.getVm(id);
  if (!vm) throw httpError(404, 'Virtual machine not found');
  const result = await guestExec(vm, {
    ...options,
    privateKey: options.privateKey ?? options.private_key,
    timeoutMs: options.timeoutMs ?? options.timeout_ms,
  });
  store.addEvent({
    action: 'agent.exec',
    message: `agent:${actor || 'agent'} ran "${String(options.command).slice(0, 120)}" in ${vm.name} (exit ${result.code})`,
    vmId: id,
    user: `agent:${actor || 'agent'}`,
    level: result.code === 0 ? 'info' : 'warn',
  });
  return { vmId: id, ...result };
}

export async function logs(id, { type = 'qemu', limit = 131072 } = {}) {
  const vm = vmManager.getVm(id);
  if (!vm) throw httpError(404, 'Virtual machine not found');
  const bytes = clampInt(limit, 4096, 512 * 1024, 131072);
  return {
    vmId: id,
    type: type === 'serial' ? 'serial' : 'qemu',
    text:
      type === 'serial'
        ? await vmManager.tailSerial(id, bytes)
        : await vmManager.tailQemuLog(id, bytes),
  };
}

export async function listSnapshots(id) {
  if (!vmManager.getVm(id)) throw httpError(404, 'Virtual machine not found');
  return vmManager.snapshots(id);
}

export async function createSnapshot(id, name, { actor } = {}) {
  await vmManager.createSnapshot(id, name, { user: `agent:${actor || 'agent'}` });
  return { ok: true, snapshots: await vmManager.snapshots(id) };
}

export async function restoreSnapshot(id, name, { actor } = {}) {
  await vmManager.restoreSnapshot(id, name, { user: `agent:${actor || 'agent'}` });
  return { ok: true, status: vmManager.runtime(id)?.status };
}

export async function deleteSnapshot(id, name, { actor } = {}) {
  await vmManager.deleteSnapshot(id, name, { user: `agent:${actor || 'agent'}` });
  return { ok: true };
}

export async function display(id) {
  const vm = vmManager.getVm(id);
  if (!vm) throw httpError(404, 'Virtual machine not found');
  const size = await displaySize(vm);
  return { vmId: id, width: size.width, height: size.height };
}
