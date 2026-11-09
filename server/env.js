import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.resolve(process.env.EMUMAN_DATA_DIR || path.join(ROOT, 'data'));
export const VMS_DIR = path.join(DATA_DIR, 'vms');
export const ISO_DIR = path.join(DATA_DIR, 'isos');
export const RUN_DIR = path.join(DATA_DIR, 'run');
export const LOG_DIR = path.join(DATA_DIR, 'logs');
export const TMP_DIR = path.join(DATA_DIR, 'tmp');
export const DB_FILE = path.join(DATA_DIR, 'db.json');
export const PUBLIC_DIR = path.join(ROOT, 'dist');

for (const dir of [DATA_DIR, VMS_DIR, ISO_DIR, RUN_DIR, LOG_DIR, TMP_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

function readSecret() {
  const file = path.join(DATA_DIR, 'secret.key');
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    const secret = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(file, secret, { mode: 0o600 });
    return secret;
  }
}

export const SECRET = readSecret();
export const PORT = Number(process.env.EMUMAN_PORT || 8787);
export const BIND = process.env.EMUMAN_HOST || '0.0.0.0';
export const PROD = process.env.NODE_ENV === 'production';
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
export const VERSION = '1.1.0';
export const HOSTNAME = os.hostname();

export const paths = {
  data: DATA_DIR,
  vms: VMS_DIR,
  isos: ISO_DIR,
  run: RUN_DIR,
  logs: LOG_DIR,
  db: DB_FILE,
  secret: path.join(DATA_DIR, 'secret.key'),
  public: PUBLIC_DIR,
};

export function vmDir(id) {
  return path.join(VMS_DIR, id);
}

export function vmRunDir(id) {
  return path.join(RUN_DIR, id);
}

export function vmPath(id, ...parts) {
  return path.join(vmDir(id), ...parts);
}

export function qmpSocket(id) {
  return path.join(vmRunDir(id), 'qmp.sock');
}

export function serialSocket(id) {
  return path.join(vmRunDir(id), 'serial.sock');
}

export function qgaSocket(id) {
  return path.join(vmDir(id), 'qga.sock');
}

export function pidFile(id) {
  return path.join(vmRunDir(id), 'qemu.pid');
}

export function qemuLog(id) {
  return path.join(LOG_DIR, `${id}.qemu.log`);
}

export function serialLog(id) {
  return path.join(LOG_DIR, `${id}.serial.log`);
}
