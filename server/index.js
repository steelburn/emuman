import fs from 'node:fs';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import { PORT, BIND, VERSION, paths } from './env.js';
import { log } from './log.js';
import { store } from './store.js';
import { resolveSession, COOKIE_NAME } from './auth.js';
import { vmManager } from './vm-manager.js';
import { attachWebSockets } from './ws/index.js';
import { serveFrontend } from './static.js';
import authRoutes from './routes/auth.js';
import vmRoutes from './routes/vms.js';
import hostRoutes from './routes/host.js';
import agentTokenRoutes from './routes/agents.js';
import userRoutes from './routes/users.js';
import agentApiRoutes from './routes/agent-api.js';
import mcpRoutes from './mcp.js';

const app = Fastify({
  logger: false,
  bodyLimit: 5 * 1024 * 1024,
  trustProxy: process.env.EMUMAN_TRUST_PROXY === '1',
});

await app.register(cookie);
await app.register(multipart, {
  limits: {
    fileSize: 32 * 1024 ** 3,
    fields: 10,
    files: 1,
  },
});

app.decorateRequest('user', null);

await vmManager.init();

app.addHook('onRequest', async (req, reply) => {
  const token = req.cookies?.[COOKIE_NAME];
  if (token) {
    const session = resolveSession(token);
    if (session) req.user = session.user;
  }
  const path = String(req.url || '').split('?')[0];
  if (req.user?.mustChangePassword) {
    const allowed =
      path === '/api/auth/status' ||
      path === '/api/auth/me' ||
      path === '/api/auth/password' ||
      path === '/api/auth/logout' ||
      path === '/api/health';
    if (path.startsWith('/api/') && !path.startsWith('/api/agent') && !allowed) {
      return reply.code(403).send({
        error: 'You must set a new password before continuing',
        code: 'PASSWORD_CHANGE_REQUIRED',
      });
    }
  }
  const method = req.method;
  const isMutation = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  if (isMutation && path.startsWith('/api/') && !path.startsWith('/api/agent')) {
    const contentType = String(req.headers['content-type'] || '');
    const ok =
      contentType.includes('application/json') ||
      contentType.includes('multipart/form-data') ||
      req.headers['x-emuman'] === '1';
    if (!ok) {
      return reply.code(415).send({ error: 'Unsupported content type for API request' });
    }
  }
});

async function requireAuth(req, reply) {
  if (!req.user) {
    return reply.code(401).send({ error: 'Authentication required' });
  }
}

app.setErrorHandler((err, req, reply) => {
  const status = err.statusCode || err.status || 500;
  if (status >= 500) log.error('api', `${req.method} ${req.url}: ${err.message}`);
  const payload = { error: err.message || 'Internal server error' };
  if (err.extra) payload.detail = err.extra;
  if (err.code === 'FST_REQ_FILE_TOO_LARGE') {
    return reply.code(413).send({ error: 'Upload is too large' });
  }
  return reply.code(status).send(payload);
});

app.get('/api/health', async () => ({
  ok: true,
  version: VERSION,
  setupRequired: store.db.users.length === 0,
  qemu: {
    version: vmManager.qemuVersion,
    kvm: vmManager.kvm,
    path: store.settings.qemuPath,
  },
  vms: vmManager.vms.size,
  running: [...vmManager.runtimes.values()].filter((r) => r.status === 'running').length,
  time: Date.now(),
}));

await app.register(authRoutes, { prefix: '/api/auth' });

await app.register(
  async (protectedApp) => {
    protectedApp.addHook('preHandler', requireAuth);
    await protectedApp.register(vmRoutes, { prefix: '/api/vms' });
    await protectedApp.register(hostRoutes, { prefix: '/api/host' });
    await protectedApp.register(agentTokenRoutes, { prefix: '/api/agents' });
    await protectedApp.register(userRoutes, { prefix: '/api/users' });
  },
  { prefix: '' },
);

await app.register(agentApiRoutes, { prefix: '/api/agent' });
await app.register(mcpRoutes);

// --- static frontend (production build) ---------------------------------------
const hasBuild = serveFrontend(app);

app.setNotFoundHandler((req, reply) => {
  if (req.url.startsWith('/api/') || req.url.startsWith('/ws/')) {
    return reply.code(404).send({ error: 'Not found' });
  }
  if (hasBuild) {
    return reply
      .header('Cache-Control', 'no-cache')
      .type('text/html; charset=utf-8')
      .send(fs.readFileSync(paths.public + '/index.html'));
  }
  return reply
    .code(503)
    .type('text/html')
    .send(
      '<!doctype html><html><body style="font-family:system-ui;background:#0b1120;color:#e2e8f0;padding:3rem">' +
        '<h1>emuman API is running</h1><p>The web UI has not been built yet. Run <code>npm run build</code> or use <code>npm run dev</code>.</p>' +
        '</body></html>',
    );
});

await app.listen({ port: PORT, host: BIND });
log.info('server', `emuman ${VERSION} listening on http://${BIND}:${PORT}`);
log.info(
  'server',
  `QEMU ${vmManager.qemuVersion || 'not found'} · KVM ${
    vmManager.kvm ? 'enabled' : 'unavailable'
  } · data ${paths.data}`,
);

attachWebSockets(app.server);

// Autostart VMs marked for boot, but never fight with an adopted runtime.
if (process.env.EMUMAN_NO_AUTOSTART !== '1') {
  setTimeout(async () => {
    for (const vm of [...vmManager.vms.values()]) {
      if (!vm.autostart) continue;
      const rt = vmManager.runtime(vm.id);
      if (rt && ['running', 'paused', 'starting'].includes(rt.status)) continue;
      try {
        await vmManager.start(vm.id, { user: 'autostart' });
      } catch (err) {
        log.error('vm', `autostart failed for ${vm.name}: ${err.message}`);
      }
    }
  }, 800).unref?.();
}

let closing = false;
const shutdown = async (signal) => {
  if (closing) return;
  closing = true;
  log.info('server', `${signal} received, shutting down API (VMs keep running)`);
  vmManager.detachQmpClients();
  store.flush();
  const timer = setTimeout(() => process.exit(0), 4000);
  timer.unref?.();
  try {
    await app.close();
  } catch {
    /* ignore */
  }
  process.exit(0);
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => log.error('server', `unhandled rejection: ${err?.message || err}`));
process.on('uncaughtException', (err) => log.error('server', `uncaught exception: ${err.message}`));
