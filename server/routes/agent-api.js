import { authenticateAgent, scopeGuard, applyAgentCors, preflight, AGENT_SCOPES } from '../agent/auth.js';
import * as service from '../agent/service.js';
import { store } from '../store.js';
import { VERSION } from '../env.js';

async function anyToken(req, reply) {
  const result = authenticateAgent(req);
  if (result.error) return reply.code(result.status).send({ error: result.error });
  req.agent = result.agent;
  return undefined;
}

export default async function agentApiRoutes(app) {
  app.addHook('onSend', async (req, reply, payload) => {
    applyAgentCors(reply);
    if (req.agent) reply.header('X-Agent-Name', req.agent.name);
    return payload;
  });

  app.options('/*', async (req, reply) => preflight(reply));

  app.get('/', { preHandler: anyToken }, async (req) => ({
    service: 'emuman',
    version: VERSION,
    agent: req.agent.name,
    scopes: req.agent.scopes,
    availableScopes: AGENT_SCOPES,
    vmCount: service.listVms().length,
    endpoints: {
      vms: '/api/agent/vms',
      create: 'POST /api/agent/vms',
      actions: 'POST /api/agent/vms/:id/action',
      screenshot: 'GET /api/agent/vms/:id/screenshot',
      screen: 'GET /api/agent/vms/:id/screen',
      input: 'POST /api/agent/vms/:id/input',
      serial: 'GET|POST /api/agent/vms/:id/serial',
      exec: 'POST /api/agent/vms/:id/exec',
      snapshots: 'GET|POST /api/agent/vms/:id/snapshots',
      mcp: '/mcp',
    },
  }));

  app.get('/vms', { preHandler: scopeGuard('read') }, async () => ({ vms: service.listVms() }));

  app.get('/isos', { preHandler: scopeGuard('read') }, async () => ({ isos: await service.listIsos() }));

  app.post('/vms', { preHandler: scopeGuard('control') }, async (req, reply) => {
    const vm = await service.createVm(req.body || {}, { actor: req.agent.name });
    reply.code(201);
    return vm;
  });

  app.get('/vms/:id', { preHandler: scopeGuard('read') }, async (req) => service.getVm(req.params.id));

  app.delete('/vms/:id', { preHandler: scopeGuard('control') }, async (req) =>
    service.deleteVm(req.params.id, { actor: req.agent.name }),
  );

  app.post('/vms/:id/action', { preHandler: scopeGuard('control') }, async (req) =>
    service.vmAction(req.params.id, String(req.body?.action || ''), {
      actor: req.agent.name,
      waitMs: req.body?.waitMs ?? req.body?.wait_ms,
    }),
  );

  app.post('/vms/:id/clone', { preHandler: scopeGuard('control') }, async (req, reply) => {
    reply.code(201);
    return service.cloneVm(req.params.id, { name: req.body?.name, actor: req.agent.name });
  });

  app.get('/vms/:id/screenshot', { preHandler: scopeGuard('console') }, async (req, reply) => {
    const shot = await service.screenshot(req.params.id);
    reply.header('Content-Type', 'image/png');
    reply.header('X-Display-Width', shot.width || 0);
    reply.header('X-Display-Height', shot.height || 0);
    reply.header('X-VM-Status', service.vmStatus(req.params.id));
    reply.header('Cache-Control', 'no-store');
    return reply.send(shot.buffer);
  });

  app.get('/vms/:id/screen', { preHandler: scopeGuard('console') }, async (req) =>
    service.screen(req.params.id),
  );

  app.get('/vms/:id/display', { preHandler: scopeGuard('console') }, async (req) =>
    service.display(req.params.id),
  );

  app.post('/vms/:id/input', { preHandler: scopeGuard('console') }, async (req) =>
    service.input(req.params.id, req.body || {}),
  );

  app.get('/vms/:id/serial', { preHandler: scopeGuard('console') }, async (req) =>
    service.serialRead(req.params.id, { limit: req.query?.limit }),
  );

  app.post('/vms/:id/serial', { preHandler: scopeGuard('console') }, async (req) =>
    service.serialWrite(req.params.id, req.body || {}),
  );

  app.post('/vms/:id/exec', { preHandler: scopeGuard('exec') }, async (req) =>
    service.execInGuest(req.params.id, req.body || {}, { actor: req.agent.name }),
  );

  app.get('/vms/:id/logs', { preHandler: scopeGuard('read') }, async (req) =>
    service.logs(req.params.id, { type: req.query?.type, limit: req.query?.limit }),
  );

  app.get('/vms/:id/snapshots', { preHandler: scopeGuard('read') }, async (req) => ({
    snapshots: await service.listSnapshots(req.params.id),
  }));

  app.post('/vms/:id/snapshots', { preHandler: scopeGuard('control') }, async (req, reply) => {
    reply.code(201);
    return service.createSnapshot(req.params.id, req.body?.name, { actor: req.agent.name });
  });

  app.post('/vms/:id/snapshots/:name/restore', { preHandler: scopeGuard('control') }, async (req) =>
    service.restoreSnapshot(req.params.id, req.params.name, { actor: req.agent.name }),
  );

  app.delete('/vms/:id/snapshots/:name', { preHandler: scopeGuard('control') }, async (req) =>
    service.deleteSnapshot(req.params.id, req.params.name, { actor: req.agent.name }),
  );

  app.get('/events', { preHandler: scopeGuard('read') }, async (req) => ({
    events: store.events(Math.min(200, Number(req.query?.limit) || 50)),
  }));

  app.get('/tasks', { preHandler: scopeGuard('read') }, async (req) => ({
    tasks: store.tasks(Math.min(50, Number(req.query?.limit) || 20)),
  }));
}
