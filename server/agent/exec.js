import crypto from 'node:crypto';
import { Client } from 'ssh2';
import { store, decryptSecret } from '../store.js';
import { httpError } from '../vm-manager.js';

const MAX_OUTPUT = 256 * 1024;

export function sha256Fingerprint(key) {
  return `SHA256:${crypto.createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`;
}

/**
 * Runs a single command inside a guest over SSH.
 * Credentials default to the ones saved for the VM (AES-256-GCM at rest).
 */
export function guestExec(vm, options = {}) {
  const host = String(options.host || '127.0.0.1');
  const port = Number(options.port || vm.net?.sshPort || 0);
  const username = String(options.username || vm.ssh?.user || 'root');
  const password = options.password
    ? String(options.password)
    : decryptSecret(vm.ssh?.savedPassword);
  const privateKey = options.privateKey
    ? String(options.privateKey)
    : decryptSecret(vm.ssh?.savedKey);
  const command = String(options.command || '').trim();
  const timeoutMs = Math.min(120000, Math.max(2000, Number(options.timeoutMs) || 30000));

  if (!vm.net?.sshPort && !options.port) {
    throw httpError(400, 'This VM has no SSH port forward. Supply host and port explicitly.');
  }
  if (!port) throw httpError(400, 'A target SSH port is required');
  if (!/^[a-zA-Z0-9.\-_:/[\]@]+$/.test(host)) throw httpError(400, 'Invalid host name');
  if (!command) throw httpError(400, 'command is required');
  if (command.length > 4000) throw httpError(400, 'command is limited to 4000 characters');
  if (!password && !privateKey) {
    throw httpError(
      400,
      'No SSH credentials available. Save a password/key for this VM or supply one in the request.',
    );
  }

  const knownKey = options.port || options.host ? `${host}:${port}` : `vm:${vm.id}`;

  return new Promise((resolve, reject) => {
    const conn = new Client();
    let settled = false;
    let stdout = '';
    let stderr = '';
    let truncated = false;
    const finish = (err, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        conn.end();
      } catch {
        /* ignore */
      }
      if (err) reject(err);
      else resolve(result);
    };
    const timer = setTimeout(() => {
      finish(httpError(504, `Command timed out after ${timeoutMs} ms`, { stdout, stderr }));
    }, timeoutMs);
    timer.unref?.();

    conn.on('ready', () => {
      conn.exec(command, { pty: false }, (err, stream) => {
        if (err) return finish(httpError(502, `Could not start command: ${err.message}`));
        stream.on('data', (chunk) => {
          if (stdout.length < MAX_OUTPUT) stdout += chunk.toString('utf8');
          else truncated = true;
        });
        stream.stderr.on('data', (chunk) => {
          if (stderr.length < MAX_OUTPUT) stderr += chunk.toString('utf8');
          else truncated = true;
        });
        stream.on('close', (code, signal) => {
          finish(null, {
            stdout: stdout.slice(0, MAX_OUTPUT),
            stderr: stderr.slice(0, MAX_OUTPUT),
            code: typeof code === 'number' ? code : null,
            signal: signal || null,
            truncated,
            target: { host, port, username },
          });
        });
        stream.on('error', (streamErr) => finish(httpError(502, `Command failed: ${streamErr.message}`)));
      });
    });
    conn.on('keyboard-interactive', (_name, _instructions, _lang, prompts, done) => {
      done(prompts.map(() => password || ''));
    });
    conn.on('error', (err) => {
      if (/verification failed/i.test(err.message)) {
        return finish(
          httpError(409, `SSH host key verification failed for ${host}. Forget the pinned key first if the guest was rebuilt.`, {
            code: 'HOSTKEY_MISMATCH',
          }),
        );
      }
      finish(httpError(502, `SSH connection failed: ${err.message}`));
    });
    try {
      conn.connect({
        host,
        port,
        username,
        password: password || undefined,
        privateKey: privateKey || undefined,
        readyTimeout: 15000,
        keepaliveInterval: 10000,
        keepaliveCountMax: 2,
        tryKeyboard: Boolean(password),
        hostVerifier: (key) => {
          const fingerprint = sha256Fingerprint(key);
          const known = store.getKnownHost(knownKey);
          if (!known) {
            store.setKnownHost(knownKey, fingerprint);
            return true;
          }
          return known.fingerprint === fingerprint;
        },
      });
    } catch (err) {
      finish(httpError(500, err.message));
    }
  });
}
