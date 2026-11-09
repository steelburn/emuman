import crypto from 'node:crypto';
import { hashPassword, publicUser, destroyUserSessions } from '../auth.js';
import { store } from '../store.js';
import { log } from '../log.js';
import {
  ROLE_IDS,
  normalizeRole,
  permissionsFor,
  requirePermission,
  roleCatalog,
  roleFor,
} from '../permissions.js';

const USERNAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{2,31}$/;
const MIN_PASSWORD = 8;

function generatePassword() {
  return crypto.randomBytes(18).toString('base64url');
}

function activeAdminCount(excludeId = null) {
  return store.db.users.filter(
    (u) => !u.disabledAt && normalizeRole(u.role) === 'admin' && u.id !== excludeId,
  ).length;
}

function sessionCount(userId) {
  const now = Date.now();
  return store.db.sessions.filter((s) => s.userId === userId && s.expiresAt > now).length;
}

function present(user, viewer) {
  return {
    ...publicUser(user),
    displayName: user.displayName || null,
    disabled: Boolean(user.disabledAt),
    disabledAt: user.disabledAt || null,
    sessionCount: sessionCount(user.id),
    isSelf: viewer?.id === user.id,
  };
}

function findUser(id) {
  return store.db.users.find((u) => u.id === id) || null;
}

function sanitizeDisplayName(value) {
  if (value === undefined) return undefined;
  const name = String(value ?? '').trim().slice(0, 64);
  return name || null;
}

function passwordError(password) {
  if (String(password ?? '').length < MIN_PASSWORD) {
    return `Password must be at least ${MIN_PASSWORD} characters`;
  }
  return null;
}

export default async function userRoutes(app) {
  // Every route in this plugin is administrator-only.
  app.addHook('preHandler', requirePermission('users.manage'));

  app.get('/', async (req) => ({
    users: [...store.db.users]
      .sort((a, b) => {
        const rank = roleFor(b).rank - roleFor(a).rank;
        if (rank !== 0) return rank;
        return String(a.username).localeCompare(String(b.username));
      })
      .map((u) => present(u, req.user)),
    roles: roleCatalog(),
    permissionCatalog: Object.fromEntries(
      roleCatalog().map((r) => [r.id, r.permissions]),
    ),
  }));

  app.get('/roles', async () => ({ roles: roleCatalog() }));

  app.post('/', async (req, reply) => {
    const body = req.body || {};
    const username = String(body.username || '').trim();
    if (!USERNAME_RE.test(username)) {
      return reply.code(400).send({
        error: 'Username must be 3-32 characters using letters, digits, dot, dash or underscore',
      });
    }
    const exists = store.db.users.some(
      (u) => u.username.toLowerCase() === username.toLowerCase(),
    );
    if (exists) return reply.code(409).send({ error: 'That username is already taken' });

    const role = normalizeRole(body.role);
    if (body.role !== undefined && !ROLE_IDS.includes(String(body.role))) {
      return reply.code(400).send({ error: 'Unknown role' });
    }

    const provided = body.password ? String(body.password) : null;
    if (provided) {
      const problem = passwordError(provided);
      if (problem) return reply.code(400).send({ error: problem });
    }
    const temporaryPassword = provided || generatePassword();
    const user = {
      id: crypto.randomUUID(),
      username,
      displayName: sanitizeDisplayName(body.displayName) ?? null,
      passwordHash: await hashPassword(temporaryPassword),
      role,
      mustChangePassword: body.mustChangePassword === false ? false : true,
      createdAt: Date.now(),
      lastLoginAt: null,
    };
    store.db.users.push(user);
    store.save();
    store.addEvent({
      action: 'user.create',
      message: `${req.user.username} created ${roleFor(user).label.toLowerCase()} account "${user.username}"`,
      user: req.user.username,
      ip: req.ip,
    });
    log.info('auth', `${req.user.username} created user "${user.username}" (${role})`);
    reply.code(201);
    return {
      user: present(user, req.user),
      ...(provided ? {} : { temporaryPassword }),
    };
  });

  app.patch('/:id', async (req, reply) => {
    const user = findUser(req.params.id);
    if (!user) return reply.code(404).send({ error: 'User not found' });
    const body = req.body || {};
    const changes = [];

    if (body.role !== undefined) {
      if (!ROLE_IDS.includes(String(body.role))) {
        return reply.code(400).send({ error: 'Unknown role' });
      }
      const nextRole = normalizeRole(body.role);
      const currentRole = normalizeRole(user.role);
      if (nextRole !== currentRole) {
        if (user.id === req.user.id) {
          return reply.code(400).send({ error: 'You cannot change your own role' });
        }
        if (
          currentRole === 'admin' &&
          nextRole !== 'admin' &&
          activeAdminCount(user.id) === 0
        ) {
          return reply.code(409).send({
            error: 'At least one active administrator is required',
          });
        }
        user.role = nextRole;
        changes.push(`role → ${roleFor(user).label}`);
        destroyUserSessions(user.id);
      }
    }

    if (body.disabled !== undefined) {
      const disabled = Boolean(body.disabled);
      if (disabled && user.id === req.user.id) {
        return reply.code(400).send({ error: 'You cannot disable your own account' });
      }
      if (disabled && !user.disabledAt) {
        if (normalizeRole(user.role) === 'admin' && activeAdminCount(user.id) === 0) {
          return reply.code(409).send({
            error: 'At least one active administrator is required',
          });
        }
        user.disabledAt = Date.now();
        destroyUserSessions(user.id);
        changes.push('disabled');
      } else if (!disabled && user.disabledAt) {
        delete user.disabledAt;
        changes.push('enabled');
      }
    }

    if (body.displayName !== undefined) {
      const next = sanitizeDisplayName(body.displayName);
      if ((user.displayName || null) !== next) {
        user.displayName = next;
        changes.push('display name');
      }
    }

    if (body.mustChangePassword !== undefined) {
      const next = Boolean(body.mustChangePassword);
      if (Boolean(user.mustChangePassword) !== next) {
        user.mustChangePassword = next;
        changes.push(next ? 'password change required' : 'password change cleared');
        if (next) destroyUserSessions(user.id);
      }
    }

    if (!changes.length) return { user: present(user, req.user) };

    store.save();
    store.addEvent({
      action: 'user.update',
      message: `${req.user.username} updated "${user.username}": ${changes.join(', ')}`,
      user: req.user.username,
      ip: req.ip,
      level: changes.includes('disabled') ? 'warn' : 'info',
    });
    log.info('auth', `${req.user.username} updated user "${user.username}": ${changes.join(', ')}`);
    return { user: present(user, req.user) };
  });

  app.post('/:id/password', async (req, reply) => {
    const user = findUser(req.params.id);
    if (!user) return reply.code(404).send({ error: 'User not found' });
    if (user.id === req.user.id) {
      return reply.code(400).send({
        error: 'Use Account & security to change your own password',
      });
    }
    const provided = req.body?.password ? String(req.body.password) : null;
    if (provided) {
      const problem = passwordError(provided);
      if (problem) return reply.code(400).send({ error: problem });
    }
    const temporaryPassword = provided || generatePassword();
    user.passwordHash = await hashPassword(temporaryPassword);
    user.mustChangePassword = req.body?.mustChangePassword === false ? false : true;
    destroyUserSessions(user.id);
    store.save();
    store.addEvent({
      action: 'user.password-reset',
      message: `${req.user.username} reset the password for "${user.username}"`,
      user: req.user.username,
      ip: req.ip,
      level: 'warn',
    });
    log.info('auth', `${req.user.username} reset password for "${user.username}"`);
    return {
      ok: true,
      user: present(user, req.user),
      ...(provided ? {} : { temporaryPassword }),
    };
  });

  app.post('/:id/logout', async (req, reply) => {
    const user = findUser(req.params.id);
    if (!user) return reply.code(404).send({ error: 'User not found' });
    const count = sessionCount(user.id);
    destroyUserSessions(user.id);
    store.save();
    store.addEvent({
      action: 'user.sessions-revoked',
      message: `${req.user.username} signed out ${count} session(s) for "${user.username}"`,
      user: req.user.username,
      ip: req.ip,
    });
    return { ok: true, revoked: count };
  });

  app.delete('/:id', async (req, reply) => {
    const user = findUser(req.params.id);
    if (!user) return reply.code(404).send({ error: 'User not found' });
    if (user.id === req.user.id) {
      return reply.code(400).send({ error: 'You cannot delete your own account' });
    }
    if (normalizeRole(user.role) === 'admin' && activeAdminCount(user.id) === 0) {
      return reply.code(409).send({ error: 'At least one active administrator is required' });
    }
    destroyUserSessions(user.id);
    store.db.users = store.db.users.filter((u) => u.id !== user.id);
    store.save();
    store.addEvent({
      action: 'user.delete',
      message: `${req.user.username} deleted account "${user.username}"`,
      user: req.user.username,
      ip: req.ip,
      level: 'warn',
    });
    log.info('auth', `${req.user.username} deleted user "${user.username}"`);
    return { ok: true };
  });

  // Expose the expanded permission list for the current role too, useful for
  // clients that cache roles without re-reading /api/auth/status.
  app.get('/permissions', async (req) => ({
    role: normalizeRole(req.user.role),
    permissions: permissionsFor(req.user.role),
    catalog: roleCatalog(),
  }));
}
