import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { DB_FILE, DATA_DIR, SECRET } from './env.js';
import { log } from './log.js';

const defaultSettings = {
  qemuPath: process.env.EMUMAN_QEMU || '/usr/bin/qemu-system-x86_64',
  vncPortStart: 5900,
  vncPortEnd: 5999,
  sshPortStart: 2200,
  sshPortEnd: 2299,
  defaultBridge: '',
  storageDir: path.join(DATA_DIR, 'vms'),
  isoDir: path.join(DATA_DIR, 'isos'),
  autoStart: true,
  metricsIntervalMs: 2000,
};

const defaultDb = () => ({
  version: 1,
  createdAt: Date.now(),
  users: [],
  sessions: [],
  settings: { ...defaultSettings },
  events: [],
  tasks: [],
  knownHosts: {},
  agents: [],
});

function loadDb() {
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      ...defaultDb(),
      ...parsed,
      settings: { ...defaultSettings, ...(parsed.settings || {}) },
    };
  } catch (err) {
    if (err.code !== 'ENOENT') log.error('store', `could not read db: ${err.message}`);
    return defaultDb();
  }
}

class Store extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50);
    this.db = loadDb();
    this._timer = null;
    this._dirty = false;
    this._prune();
  }

  get settings() {
    return this.db.settings;
  }

  save() {
    this._dirty = true;
    if (this._timer) return;
    this._timer = setTimeout(() => {
      this._timer = null;
      this.flush();
    }, 80);
    this._timer.unref?.();
  }

  flush() {
    this._dirty = false;
    const tmp = `${DB_FILE}.${process.pid}.tmp`;
    try {
      fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(this.db, null, 2), { mode: 0o600 });
      fs.renameSync(tmp, DB_FILE);
    } catch (err) {
      log.error('store', `failed to persist db: ${err.message}`);
    }
  }

  updateSettings(patch) {
    const allowed = Object.keys(defaultSettings);
    for (const [key, value] of Object.entries(patch)) {
      if (!allowed.includes(key)) continue;
      if (typeof defaultSettings[key] === 'number') {
        const n = Number(value);
        if (Number.isFinite(n) && n > 0) this.db.settings[key] = n;
      } else if (typeof defaultSettings[key] === 'boolean') {
        this.db.settings[key] = Boolean(value);
      } else if (typeof value === 'string') {
        this.db.settings[key] = value;
      }
    }
    this.save();
    return this.db.settings;
  }

  _prune() {
    const now = Date.now();
    const before = this.db.sessions.length;
    this.db.sessions = this.db.sessions.filter((s) => s.expiresAt > now);
    if (this.db.sessions.length !== before) this.save();
    this.db.events = this.db.events.slice(-1500);
    this.db.tasks = this.db.tasks.slice(-80);
  }

  addEvent(evt) {
    const entry = {
      id: crypto.randomUUID(),
      ts: Date.now(),
      level: 'info',
      ...evt,
    };
    this.db.events.push(entry);
    if (this.db.events.length > 1500) this.db.events = this.db.events.slice(-1500);
    this.save();
    this.emit('event', entry);
    return entry;
  }

  events(limit = 100) {
    return this.db.events.slice(-limit).reverse();
  }

  createTask({ kind, title, vmId, user }) {
    const task = {
      id: crypto.randomUUID(),
      kind,
      title,
      vmId: vmId || null,
      user: user || null,
      status: 'running',
      progress: 0,
      logs: [],
      startedAt: Date.now(),
      endedAt: null,
    };
    this.db.tasks.push(task);
    if (this.db.tasks.length > 80) this.db.tasks = this.db.tasks.slice(-80);
    this.save();
    this.emit('task', task);
    return task;
  }

  task(id) {
    return this.db.tasks.find((t) => t.id === id) || null;
  }

  taskLog(task, line) {
    if (!task) return;
    task.logs.push({ ts: Date.now(), line: String(line) });
    if (task.logs.length > 200) task.logs.shift();
    this.save();
    this.emit('task', task);
  }

  finishTask(task, status, line) {
    if (!task) return;
    task.status = status;
    task.progress = status === 'success' ? 100 : task.progress;
    task.endedAt = Date.now();
    if (line) task.logs.push({ ts: Date.now(), line: String(line) });
    this.save();
    this.emit('task', task);
  }

  tasks(limit = 30) {
    return this.db.tasks.slice(-limit).reverse();
  }

  getKnownHost(host) {
    return this.db.knownHosts[host] || null;
  }

  setKnownHost(host, fingerprint) {
    this.db.knownHosts[host] = { fingerprint, addedAt: Date.now() };
    this.save();
  }

  removeKnownHost(host) {
    delete this.db.knownHosts[host];
    this.save();
  }

  /* ------------------------------- agent tokens ----------------------------- */

  publicAgent(agent) {
    return {
      id: agent.id,
      name: agent.name,
      scopes: agent.scopes,
      hint: agent.hint,
      createdAt: agent.createdAt,
      lastUsedAt: agent.lastUsedAt || null,
      lastUsedIp: agent.lastUsedIp || null,
    };
  }

  agents() {
    return this.db.agents
      .filter((a) => !a.revokedAt)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((a) => this.publicAgent(a));
  }

  createAgent({ name, scopes }) {
    const token = `emuman_${crypto.randomBytes(24).toString('base64url')}`;
    const agent = {
      id: crypto.randomUUID(),
      name: String(name).slice(0, 48),
      scopes: [...new Set(scopes)],
      tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
      hint: token.slice(-4),
      createdAt: Date.now(),
      lastUsedAt: null,
      lastUsedIp: null,
    };
    this.db.agents.push(agent);
    this.save();
    return { agent: this.publicAgent(agent), token };
  }

  resolveAgent(token) {
    if (!/^emuman_[A-Za-z0-9_-]{20,}$/.test(String(token || ''))) return null;
    const hash = crypto.createHash('sha256').update(String(token)).digest('hex');
    for (const agent of this.db.agents) {
      if (agent.revokedAt) continue;
      const known = Buffer.from(agent.tokenHash, 'hex');
      const given = Buffer.from(hash, 'hex');
      if (known.length === given.length && crypto.timingSafeEqual(known, given)) return agent;
    }
    return null;
  }

  touchAgent(agent, ip) {
    const now = Date.now();
    if (agent.lastUsedAt && now - agent.lastUsedAt < 30000) return;
    agent.lastUsedAt = now;
    agent.lastUsedIp = ip || null;
    this.save();
  }

  revokeAgent(id) {
    const agent = this.db.agents.find((a) => a.id === id);
    if (!agent) return null;
    agent.revokedAt = Date.now();
    this.save();
    return agent;
  }
}

export const store = new Store();

const KEY = crypto.createHash('sha256').update(`${SECRET}:emuman-secrets`).digest();

export function encryptSecret(plain) {
  if (!plain) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${enc.toString('base64')}`;
}

export function decryptSecret(payload) {
  if (!payload) return null;
  try {
    const [ver, ivb, tagb, datab] = String(payload).split(':');
    if (ver !== 'v1') return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(ivb, 'base64'));
    decipher.setAuthTag(Buffer.from(tagb, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(datab, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
