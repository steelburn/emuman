import { vmManager, httpError, clampInt } from '../vm-manager.js';
import { store, encryptSecret } from '../store.js';
import { requirePermission } from '../permissions.js';
import { log } from '../log.js';

function present(vm) {
  const rt = vmManager.runtime(vm.id) || {};
  return {
    ...vm,
    status: rt.status || 'stopped',
    pid: rt.pid || null,
    startedAt: rt.startedAt || null,
    cpuPct: rt.cpuPct || 0,
    memBytes: rt.memBytes || 0,
    lastError: rt.lastError || null,
    hasSavedSshPassword: Boolean(vm.ssh?.savedPassword),
    ssh: vm.ssh ? { user: vm.ssh.user, enabled: vm.ssh.enabled } : null,
  };
}

export default async function vmRoutes(app) {
  app.get('/', { preHandler: requirePermission('vm.read') }, async () => ({
    vms: vmManager.list(),
    tasks: store.tasks(10),
  }));

  app.post('/', { preHandler: requirePermission('vm.manage') }, async (req, reply) => {
    const vm = await vmManager.create(req.body || {}, { user: req.user.username });
    reply.code(201);
    return present(vm);
  });

  app.get('/:id', { preHandler: requirePermission('vm.read') }, async (req, reply) => {
    const vm = vmManager.getVm(req.params.id);
    if (!vm) return reply.code(404).send({ error: 'Virtual machine not found' });
    const rt = vmManager.runtime(vm.id);
    const disks = await vmManager.diskUsage(vm);
    let ports = { vnc: false, ssh: false };
    ports = {
      vnc: await vmManager.isPortFree(vm.vncPort),
      ssh: vm.net.sshPort ? await vmManager.isPortFree(vm.net.sshPort) : true,
    };
    return {
      vm: present(vm),
      disks,
      runtime: {
        status: rt?.status || 'stopped',
        pid: rt?.pid || null,
        startedAt: rt?.startedAt || null,
        cpuPct: rt?.cpuPct || 0,
        memBytes: rt?.memBytes || 0,
        history: rt?.history || [],
        lastError: rt?.lastError || null,
      },
      serial: await vmManager.serialAvailable(vm.id),
      portsInUse: { vnc: !ports.vnc, ssh: !ports.ssh },
    };
  });

  app.patch('/:id', { preHandler: requirePermission('vm.manage') }, async (req, reply) => {
    const vm = await vmManager.update(req.params.id, req.body || {}, { user: req.user.username });
    return present(vm);
  });

  app.delete('/:id', { preHandler: requirePermission('vm.manage') }, async (req, reply) => {
    await vmManager.remove(req.params.id, { user: req.user.username });
    return { ok: true };
  });

  app.post('/:id/action', { preHandler: requirePermission('vm.operate') }, async (req, reply) => {
    const { action } = req.body || {};
    const id = req.params.id;
    const user = req.user.username;
    switch (action) {
      case 'start':
        return vmManager.start(id, { user });
      case 'stop':
        return vmManager.stop(id, { force: true, user });
      case 'shutdown':
        return vmManager.stop(id, { force: false, user });
      case 'reboot':
        return vmManager.reset(id, user);
      case 'pause':
        return vmManager.pause(id, user);
      case 'resume':
        return vmManager.resume(id, user);
      default:
        return reply.code(400).send({ error: `Unknown action "${action}"` });
    }
  });

  app.get('/:id/stats', { preHandler: requirePermission('vm.read') }, async (req, reply) => {
    const vm = vmManager.getVm(req.params.id);
    if (!vm) return reply.code(404).send({ error: 'Virtual machine not found' });
    const rt = vmManager.runtime(vm.id);
    return {
      status: rt?.status,
      pid: rt?.pid,
      cpuPct: rt?.cpuPct || 0,
      memBytes: rt?.memBytes || 0,
      startedAt: rt?.startedAt,
      history: rt?.history || [],
      cpus: vm.cpus,
      memoryMB: vm.memoryMB,
    };
  });

  app.get('/:id/logs', { preHandler: requirePermission('vm.read') }, async (req, reply) => {
    const vm = vmManager.getVm(req.params.id);
    if (!vm) return reply.code(404).send({ error: 'Virtual machine not found' });
    const kind = req.query?.type === 'serial' ? 'serial' : 'qemu';
    const text =
      kind === 'serial'
        ? await vmManager.tailSerial(vm.id)
        : await vmManager.tailQemuLog(vm.id);
    return { type: kind, text };
  });

  app.get('/:id/console', { preHandler: requirePermission('vm.read') }, async (req, reply) => {
    const vm = vmManager.getVm(req.params.id);
    if (!vm) return reply.code(404).send({ error: 'Virtual machine not found' });
    const rt = vmManager.runtime(vm.id);
    return {
      running: ['running', 'paused'].includes(rt?.status || ''),
      vncPort: vm.vncPort,
      wsPath: `/ws/vnc/${vm.id}`,
      serialWsPath: `/ws/serial/${vm.id}`,
      ssh: {
        host: '127.0.0.1',
        port: vm.net.sshPort,
        username: vm.ssh?.user || 'root',
        hasSavedPassword: Boolean(vm.ssh?.savedPassword),
      },
    };
  });

  app.get('/:id/serial', { preHandler: requirePermission('vm.read') }, async (req, reply) => {
    const vm = vmManager.getVm(req.params.id);
    if (!vm) return reply.code(404).send({ error: 'Virtual machine not found' });
    return {
      enabled: vm.serialEnabled,
      available: await vmManager.serialAvailable(vm.id),
      log: await vmManager.tailSerial(vm.id, 128 * 1024),
    };
  });

  app.get('/:id/snapshots', { preHandler: requirePermission('vm.read') }, async (req, reply) => {
    const vm = vmManager.getVm(req.params.id);
    if (!vm) return reply.code(404).send({ error: 'Virtual machine not found' });
    return { snapshots: await vmManager.snapshots(vm.id) };
  });

  app.post('/:id/snapshots', { preHandler: requirePermission('vm.operate') }, async (req, reply) => {
    const { name } = req.body || {};
    await vmManager.createSnapshot(req.params.id, name, { user: req.user.username });
    reply.code(201);
    return { ok: true, snapshots: await vmManager.snapshots(req.params.id) };
  });

  app.post('/:id/snapshots/:name/restore', { preHandler: requirePermission('vm.operate') }, async (req) => {
    await vmManager.restoreSnapshot(req.params.id, req.params.name, {
      user: req.user.username,
    });
    return { ok: true };
  });

  app.delete('/:id/snapshots/:name', { preHandler: requirePermission('vm.operate') }, async (req) => {
    await vmManager.deleteSnapshot(req.params.id, req.params.name, {
      user: req.user.username,
    });
    return { ok: true };
  });

  app.post('/:id/disks', { preHandler: requirePermission('vm.manage') }, async (req, reply) => {
    const disk = await vmManager.addDisk(req.params.id, req.body || {}, {
      user: req.user.username,
    });
    reply.code(201);
    return { disk };
  });

  app.delete('/:id/disks/:diskId', { preHandler: requirePermission('vm.manage') }, async (req) => {
    return vmManager.removeDisk(req.params.id, req.params.diskId, {
      deleteFile: req.query?.deleteFile !== '0',
      user: req.user.username,
    });
  });

  app.post('/:id/disks/:diskId/resize', { preHandler: requirePermission('vm.manage') }, async (req) => {
    const sizeGB = clampInt(req.body?.sizeGB, 1, 65536, 1);
    const disk = await vmManager.resizeDisk(req.params.id, req.params.diskId, sizeGB, {
      user: req.user.username,
    });
    return { disk };
  });

  app.post('/:id/clone', { preHandler: requirePermission('vm.manage') }, async (req, reply) => {
    const vm = await vmManager.clone(req.params.id, {
      name: req.body?.name,
      user: req.user.username,
    });
    reply.code(201);
    return present(vm);
  });

  app.post('/:id/ssh-credentials', { preHandler: requirePermission('vm.ssh') }, async (req, reply) => {
    const vm = vmManager.getVm(req.params.id);
    if (!vm) return reply.code(404).send({ error: 'Virtual machine not found' });
    const { username, password, privateKey, clear } = req.body || {};
    if (clear) {
      vm.ssh.savedPassword = null;
      vm.ssh.savedKey = null;
    } else {
      if (username) vm.ssh.user = String(username).slice(0, 32);
      if (password) vm.ssh.savedPassword = encryptSecret(String(password));
      if (privateKey) vm.ssh.savedKey = encryptSecret(String(privateKey));
    }
    await vmManager.persist(vm);
    store.addEvent({
      action: 'vm.ssh-credentials',
      message: `${vm.name}: SSH credentials ${clear ? 'cleared' : 'updated'}`,
      vmId: vm.id,
      user: req.user.username,
    });
    return { ok: true, hasSavedPassword: Boolean(vm.ssh.savedPassword) };
  });

  app.get('/:id/ssh-credentials', { preHandler: requirePermission('vm.ssh') }, async (req, reply) => {
    const vm = vmManager.getVm(req.params.id);
    if (!vm) return reply.code(404).send({ error: 'Virtual machine not found' });
    return {
      user: vm.ssh?.user || 'root',
      hasSavedPassword: Boolean(vm.ssh?.savedPassword),
      hasSavedKey: Boolean(vm.ssh?.savedKey),
    };
  });

  app.get('/:id/screenshot', { preHandler: requirePermission('vm.read') }, async (req, reply) => {
    try {
      const png = await vmManager.screenshot(req.params.id);
      reply.type('image/png').header('Cache-Control', 'no-store');
      return reply.send(png);
    } catch (err) {
      log.warn('vm', `screenshot failed: ${err.message}`);
      return reply.code(409).send({ error: err.message });
    }
  });
}
