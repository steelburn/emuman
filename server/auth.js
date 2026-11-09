import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { store } from './store.js';
import { SESSION_TTL_MS } from './env.js';
import { normalizeRole, permissionsFor, roleFor } from './permissions.js';

const scrypt = promisify(crypto.scrypt);
export const COOKIE_NAME = 'emuman_session';

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(String(password), salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  try {
    const [algo, N, r, p, saltB64, hashB64] = String(stored).split('$');
    if (algo !== 'scrypt') return false;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const actual = await scrypt(String(password), salt, expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
    });
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

const tokenHash = (token) => crypto.createHash('sha256').update(token).digest('hex');

export function setupRequired() {
  return store.db.users.length === 0;
}

export function publicUser(user) {
  if (!user) return null;
  const role = normalizeRole(user.role);
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName || null,
    role,
    roleLabel: roleFor(user).label,
    permissions: permissionsFor(role),
    mustChangePassword: Boolean(user.mustChangePassword),
    disabled: Boolean(user.disabledAt),
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt || null,
  };
}

export function createSession(user, req) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  store.db.sessions.push({
    id: tokenHash(token),
    userId: user.id,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
    ip: req?.ip || null,
    ua: String(req?.headers?.['user-agent'] || '').slice(0, 160),
  });
  store.save();
  return { token, expiresAt: now + SESSION_TTL_MS };
}

export function resolveSession(token) {
  if (!token) return null;
  const id = tokenHash(token);
  const session = store.db.sessions.find((s) => s.id === id);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    store.db.sessions = store.db.sessions.filter((s) => s.id !== id);
    store.save();
    return null;
  }
  const user = store.db.users.find((u) => u.id === session.userId);
  if (!user || user.disabledAt) return null;
  return { session, user };
}

export function destroySession(token) {
  if (!token) return;
  const id = tokenHash(token);
  store.db.sessions = store.db.sessions.filter((s) => s.id !== id);
  store.save();
}

export function destroyUserSessions(userId, exceptToken) {
  const keep = exceptToken ? tokenHash(exceptToken) : null;
  store.db.sessions = store.db.sessions.filter(
    (s) => s.userId !== userId || (keep && s.id === keep),
  );
  store.save();
}

export function sessionCookie(token, expiresAt, secure) {
  const parts = [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${new Date(expiresAt).toUTCString()}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearCookie(secure) {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}

export function isSecureRequest(req) {
  return req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https';
}

const failures = new Map();

export function loginRateLimited(ip) {
  const entry = failures.get(ip);
  if (!entry) return false;
  if (Date.now() - entry.first > 5 * 60 * 1000) {
    failures.delete(ip);
    return false;
  }
  return entry.count >= 8;
}

export function recordLoginFailure(ip) {
  const entry = failures.get(ip);
  if (!entry || Date.now() - entry.first > 5 * 60 * 1000) {
    failures.set(ip, { count: 1, first: Date.now() });
  } else {
    entry.count += 1;
  }
}

export function clearLoginFailures(ip) {
  failures.delete(ip);
}
