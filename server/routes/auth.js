import crypto from 'node:crypto';
import {
  hashPassword,
  verifyPassword,
  setupRequired,
  publicUser,
  createSession,
  destroySession,
  destroyUserSessions,
  sessionCookie,
  clearCookie,
  isSecureRequest,
  loginRateLimited,
  recordLoginFailure,
  clearLoginFailures,
  COOKIE_NAME,
} from '../auth.js';
import { store } from '../store.js';
import { log } from '../log.js';
import { VERSION } from '../env.js';

const USERNAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{2,31}$/;

function setSession(reply, req, user) {
  const { token, expiresAt } = createSession(user, req);
  reply.header('Set-Cookie', sessionCookie(token, expiresAt, isSecureRequest(req)));
}

async function requireUser(req, reply) {
  if (!req.user) return reply.code(401).send({ error: 'Authentication required' });
}

export default async function authRoutes(app) {
  app.get('/status', async (req) => {
    const token = req.cookies[COOKIE_NAME];
    let user = null;
    if (token) {
      const { resolveSession } = await import('../auth.js');
      const session = resolveSession(token);
      user = session ? publicUser(session.user) : null;
    }
    return {
      setupRequired: setupRequired(),
      user,
      version: VERSION,
      host: req.hostname,
    };
  });

  app.post('/setup', async (req, reply) => {
    if (!setupRequired()) {
      return reply.code(409).send({ error: 'Setup has already been completed' });
    }
    const { username, password } = req.body || {};
    if (!USERNAME_RE.test(String(username || ''))) {
      return reply.code(400).send({
        error: 'Username must be 3-32 characters using letters, digits, dot, dash or underscore',
      });
    }
    if (String(password || '').length < 8) {
      return reply.code(400).send({ error: 'Password must be at least 8 characters' });
    }
    const user = {
      id: crypto.randomUUID(),
      username: String(username),
      displayName: null,
      passwordHash: await hashPassword(password),
      role: 'admin',
      mustChangePassword: false,
      createdAt: Date.now(),
      lastLoginAt: Date.now(),
    };
    store.db.users.push(user);
    store.save();
    setSession(reply, req, user);
    store.addEvent({
      action: 'auth.setup',
      message: `Administrator account "${user.username}" created`,
      user: user.username,
      ip: req.ip,
    });
    log.info('auth', `administrator "${user.username}" created`);
    return { ok: true, user: publicUser(user) };
  });

  app.post('/login', async (req, reply) => {
    const ip = req.ip || 'unknown';
    if (loginRateLimited(ip)) {
      return reply.code(429).send({ error: 'Too many failed attempts. Try again in a few minutes.' });
    }
    const { username, password } = req.body || {};
    const user = store.db.users.find(
      (u) => u.username.toLowerCase() === String(username || '').trim().toLowerCase(),
    );
    const valid = user && (await verifyPassword(password || '', user.passwordHash));
    if (!valid) {
      recordLoginFailure(ip);
      store.addEvent({
        action: 'auth.login-failed',
        message: `Failed login for "${username || 'unknown'}"`,
        ip,
        level: 'warn',
      });
      return reply.code(401).send({ error: 'Invalid username or password' });
    }
    clearLoginFailures(ip);
    if (user.disabledAt) {
      store.addEvent({
        action: 'auth.login-disabled',
        message: `Disabled account "${user.username}" attempted to sign in`,
        ip,
        level: 'warn',
      });
      return reply.code(403).send({ error: 'This account has been disabled' });
    }
    user.lastLoginAt = Date.now();
    store.save();
    setSession(reply, req, user);
    store.addEvent({
      action: 'auth.login',
      message: `${user.username} signed in`,
      user: user.username,
      ip,
    });
    log.info('auth', `${user.username} signed in from ${ip}`);
    return { ok: true, user: publicUser(user) };
  });

  app.post('/logout', async (req, reply) => {
    const token = req.cookies[COOKIE_NAME];
    destroySession(token);
    reply.header('Set-Cookie', clearCookie(isSecureRequest(req)));
    return { ok: true };
  });

  app.get('/me', { preHandler: requireUser }, async (req) => ({ user: publicUser(req.user) }));

  app.post('/password', { preHandler: requireUser }, async (req, reply) => {
    const { currentPassword, newPassword } = req.body || {};
    if (!(await verifyPassword(currentPassword || '', req.user.passwordHash))) {
      return reply.code(400).send({ error: 'Current password is incorrect' });
    }
    if (String(newPassword || '').length < 8) {
      return reply.code(400).send({ error: 'New password must be at least 8 characters' });
    }
    req.user.passwordHash = await hashPassword(newPassword);
    req.user.mustChangePassword = false;
    store.save();
    destroyUserSessions(req.user.id, req.cookies[COOKIE_NAME]);
    store.addEvent({
      action: 'auth.password',
      message: `${req.user.username} changed their password`,
      user: req.user.username,
      ip: req.ip,
    });
    return { ok: true, user: publicUser(req.user) };
  });
}
