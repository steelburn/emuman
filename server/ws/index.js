import net from 'node:net';
import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';
import { Client as SSHClient } from 'ssh2';
import { vmManager } from '../vm-manager.js';
import { resolveSession, COOKIE_NAME } from '../auth.js';
import { can } from '../permissions.js';
import { store, decryptSecret } from '../store.js';
import { log } from '../log.js';
import { serialSocket } from '../env.js';

function parseCookies(header = '') {
  const out = {};
  for (const part of String(header).split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

function hostnameOf(value) {
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

function isAllowedOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const originHost = hostnameOf(origin);
  const hostHeader = String(req.headers.host || '').split(':')[0];
  return Boolean(originHost && hostHeader && originHost === hostHeader);
}

function authenticate(req) {
  const cookies = parseCookies(req.headers.cookie);
  const session = resolveSession(cookies[COOKIE_NAME]);
  return session?.user || null;
}

function sendJson(ws, payload) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
}

/* ----------------------------------- VNC ---------------------------------- */

/**
 * Buffers client→server RFB messages and drops input. Viewers may still send
 * pixel-format, encoding and framebuffer requests (needed to see the screen),
 * but key events, pointer events, clipboard writes and QEMU extended key
 * events never reach QEMU. The client also sets noVNC's viewOnly flag; this is
 * the server-side half of that guarantee.
 */
export function createRfbInputFilter(forward) {
  let buffer = Buffer.alloc(0);
  return (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
      const type = buffer[0];
      let size = 0;
      switch (type) {
        case 0:
          size = 20; // SetPixelFormat
          break;
        case 2:
          size = 4 + buffer.readUInt16BE(2) * 4; // SetEncodings
          break;
        case 3:
          size = 10; // FramebufferUpdateRequest
          break;
        case 4:
          size = 8; // KeyEvent (dropped)
          break;
        case 5:
          size = 6; // PointerEvent (dropped)
          break;
        case 6: {
          if (buffer.length < 8) return;
          const raw = buffer.readUInt32BE(4);
          // noVNC uses a negative length for extended clipboard payloads.
          const length = raw > 0x7fffffff ? 0x100000000 - raw : raw;
          size = 8 + length; // ClientCutText (dropped)
          break;
        }
        case 150:
          size = 10; // EnableContinuousUpdates
          break;
        case 248:
          if (buffer.length < 9) return;
          size = 9 + buffer[8]; // ClientFence
          break;
        case 251:
          if (buffer.length < 8) return;
          size = 8 + buffer[6] * 16; // SetDesktopSize
          break;
        case 255:
          size = 12; // QEMU extended key event (dropped)
          break;
        default:
          // Unknown client message: forward untouched rather than risk a stall.
          forward(buffer);
          buffer = Buffer.alloc(0);
          return;
      }
      if (buffer.length < size) return;
      const message = buffer.subarray(0, size);
      buffer = buffer.subarray(size);
      if (![4, 5, 6, 255].includes(type)) forward(message);
    }
  };
}

function handleVnc(ws, vmId, { viewOnly = false } = {}) {
  const vm = vmManager.getVm(vmId);
  const rt = vmManager.runtime(vmId);
  if (!vm) {
    sendJson(ws, { type: 'error', message: 'VM not found' });
    return ws.close(4404, 'VM not found');
  }
  if (!rt || !['running', 'paused', 'stopping'].includes(rt.status)) {
    sendJson(ws, { type: 'error', message: 'VM is not running' });
    return ws.close(4409, 'VM not running');
  }

  const socket = net.createConnection({ host: '127.0.0.1', port: vm.vncPort });
  socket.setNoDelay(true);
  let connected = false;

  socket.on('connect', () => {
    connected = true;
    sendJson(ws, { type: 'connected', port: vm.vncPort, viewOnly });
  });
  socket.on('data', (chunk) => {
    if (ws.readyState === ws.OPEN) ws.send(chunk, { binary: true });
  });
  socket.on('error', (err) => {
    log.warn('vnc', `${vm.name}: ${err.message}`);
    sendJson(ws, { type: 'error', message: `VNC connection failed: ${err.message}` });
    ws.close(1011, 'VNC error');
  });
  socket.on('close', () => {
    if (ws.readyState === ws.OPEN) ws.close(1000, 'VNC closed');
  });
  const writeToSocket = viewOnly
    ? createRfbInputFilter((message) => socket.write(message))
    : (data) => socket.write(data);
  ws.on('message', (data, isBinary) => {
    if (isBinary) writeToSocket(data);
  });
  ws.on('close', () => socket.destroy());
  ws.on('error', () => socket.destroy());
  // If no data arrives quickly, surface a hint about the VM console.
  setTimeout(() => {
    if (!connected) sendJson(ws, { type: 'connecting', port: vm.vncPort, viewOnly });
  }, 1500).unref?.();
}

/* ---------------------------------- serial -------------------------------- */

function handleSerial(ws, vmId, { readOnly = false } = {}) {
  const vm = vmManager.getVm(vmId);
  if (!vm) {
    sendJson(ws, { type: 'error', message: 'VM not found' });
    return ws.close(4404, 'VM not found');
  }
  if (!vm.serialEnabled) {
    sendJson(ws, { type: 'error', message: 'Serial console disabled for this VM' });
    return ws.close(4409, 'Serial disabled');
  }
  const sockPath = serialSocket(vmId);
  const ready = vmManager.serialAvailable(vmId);
  vmManager
    .tailSerial(vmId, 64 * 1024)
    .then((history) => {
      if (history) sendJson(ws, { type: 'history', data: history });
    })
    .catch(() => {});
  if (!ready) {
    sendJson(ws, {
      type: 'status',
      status: 'offline',
      message: 'Serial console is available while the VM is running.',
    });
    return;
  }

  const socket = net.createConnection(sockPath);
  socket.setNoDelay(true);
  socket.on('connect', () => sendJson(ws, { type: 'status', status: 'connected', readOnly }));
  socket.on('data', (chunk) => {
    if (ws.readyState === ws.OPEN) ws.send(chunk, { binary: true });
  });
  socket.on('error', (err) => {
    sendJson(ws, { type: 'status', status: 'error', message: err.message });
    if (ws.readyState === ws.OPEN) ws.close(1011, 'Serial error');
  });
  socket.on('close', () => {
    if (ws.readyState === ws.OPEN) ws.close(1000, 'Serial closed');
  });
  ws.on('message', (data, isBinary) => {
    if (readOnly) return;
    const payload = isBinary ? data : Buffer.from(String(data));
    socket.write(payload);
  });
  ws.on('close', () => socket.destroy());
  ws.on('error', () => socket.destroy());
}

/* ----------------------------------- SSH ---------------------------------- */

const MAX_SSH_MESSAGE = 2 * 1024 * 1024;

function sha256Fingerprint(key) {
  return `SHA256:${crypto.createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`;
}

function handleSsh(ws, req, user) {
  let conn = null;
  let stream = null;
  let targetKey = null;
  let attempts = 0;
  let failed = false;

  const fail = (message, code = 'SSH_ERROR') => {
    failed = true;
    sendJson(ws, { type: 'status', status: 'error', code, message });
    try {
      conn?.end();
    } catch {
      /* ignore */
    }
    if (ws.readyState === ws.OPEN) setTimeout(() => ws.close(1011, code), 30).unref?.();
  };

  ws.on('message', async (raw, isBinary) => {
    if (isBinary) {
      if (stream) stream.write(raw);
      return;
    }
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }

    if (msg.type === 'connect' && !conn) {
      attempts += 1;
      if (attempts > 3) return fail('Too many connection attempts');
      let host = String(msg.host || '').trim();
      let port = Number(msg.port) || 22;
      let username = String(msg.username || '').trim();
      let password = msg.password ? String(msg.password) : null;
      let privateKey = msg.privateKey || null;
      let passphrase = msg.passphrase || null;
      let vm = null;

      if (msg.vmId) {
        vm = vmManager.getVm(String(msg.vmId));
        if (!vm) return fail('VM not found', 'NO_VM');
        host = host || '127.0.0.1';
        port = Number(msg.port) || vm.net.sshPort || 22;
        username = username || vm.ssh.user || 'root';
        targetKey = `vm:${vm.id}`;
        if (!password && !privateKey && vm.ssh.savedPassword) {
          password = decryptSecret(vm.ssh.savedPassword);
        }
        if (!password && !privateKey && vm.ssh.savedKey) {
          privateKey = decryptSecret(vm.ssh.savedKey);
        }
      }
      if (!host || !username) return fail('Host and username are required');
      if (!/^[a-zA-Z0-9.\-_:/[\]@]+$/.test(host)) return fail('Invalid host name');
      if (!Number.isInteger(port) || port < 1 || port > 65535) return fail('Invalid port');
      if (!password && !privateKey) {
        return fail('A password or private key is required', 'NO_CREDENTIALS');
      }

      const knownKey = targetKey || `${host}:${port}`;
      const known = store.getKnownHost(knownKey);
      sendJson(ws, { type: 'status', status: 'connecting', host, port, username });
      log.info('ssh', `${user.username} → ${username}@${host}:${port}`);

      conn = new SSHClient();
      conn.on('ready', () => {
        stream = null;
        conn.shell(
          { term: 'xterm-256color', cols: Number(msg.cols) || 120, rows: Number(msg.rows) || 32 },
          (err, shell) => {
            if (err) return fail(`Could not open shell: ${err.message}`);
            stream = shell;
            sendJson(ws, { type: 'status', status: 'ready' });
            store.addEvent({
              action: 'ssh.connect',
              message: `${user.username} opened SSH to ${username}@${host}:${port}`,
              user: user.username,
              ip: req.socket?.remoteAddress,
            });
            shell.on('data', (chunk) => {
              if (ws.readyState === ws.OPEN) {
                ws.send(JSON.stringify({ type: 'data', data: chunk.toString('base64') }));
              }
            });
            shell.stderr.on('data', (chunk) => {
              if (ws.readyState === ws.OPEN) {
                ws.send(JSON.stringify({ type: 'data', data: chunk.toString('base64'), stderr: true }));
              }
            });
            shell.on('close', (code) => {
              sendJson(ws, { type: 'status', status: 'closed', message: `Shell exited (${code})` });
              if (ws.readyState === ws.OPEN) ws.close(1000, 'SSH closed');
            });
          },
        );
      });
      conn.on('keyboard-interactive', (_name, _instructions, _lang, prompts, finish) => {
        sendJson(ws, { type: 'status', status: 'keyboard-interactive' });
        finish(prompts.map(() => password || ''));
      });
      conn.on('error', (err) => {
        if (/verification failed/i.test(err.message)) {
          return fail(
            `Host key verification failed for ${host}. The server key changed since the last connection.`,
            'HOSTKEY_MISMATCH',
          );
        }
        fail(err.message);
      });
      conn.on('close', () => {
        if (failed) return;
        if (ws.readyState === ws.OPEN) {
          sendJson(ws, { type: 'status', status: 'closed' });
          ws.close(1000, 'SSH closed');
        }
      });
      try {
        conn.connect({
          host,
          port,
          username,
          password: password || undefined,
          privateKey: privateKey || undefined,
          passphrase: passphrase || undefined,
          readyTimeout: 20000,
          keepaliveInterval: 15000,
          keepaliveCountMax: 3,
          tryKeyboard: Boolean(password),
          hostVerifier: (key) => {
            const fingerprint = sha256Fingerprint(key);
            const existing = store.getKnownHost(knownKey);
            if (!existing) {
              store.setKnownHost(knownKey, fingerprint);
              sendJson(ws, { type: 'hostkey', fingerprint, trusted: true, firstSeen: true });
              return true;
            }
            if (existing.fingerprint !== fingerprint) {
              sendJson(ws, {
                type: 'hostkey',
                fingerprint,
                known: existing.fingerprint,
                trusted: false,
              });
              return false;
            }
            sendJson(ws, { type: 'hostkey', fingerprint, trusted: true, firstSeen: false });
            return true;
          },
        });
      } catch (err) {
        fail(err.message);
      }
      return;
    }

    if (msg.type === 'resize' && stream) {
      const cols = Math.max(2, Math.min(500, Number(msg.cols) || 80));
      const rows = Math.max(2, Math.min(300, Number(msg.rows) || 24));
      try {
        stream.setWindow(rows, cols, 0, 0);
      } catch {
        /* ignore */
      }
      return;
    }
    if (msg.type === 'input' && stream && msg.data) {
      stream.write(Buffer.from(msg.data, 'base64'));
      return;
    }
    if (msg.type === 'disconnect') {
      try {
        conn?.end();
      } catch {
        /* ignore */
      }
      ws.close(1000, 'Bye');
    }
  });

  ws.on('close', () => {
    try {
      conn?.end();
    } catch {
      /* ignore */
    }
  });
  ws.on('error', () => {
    try {
      conn?.end();
    } catch {
      /* ignore */
    }
  });
}

/* ---------------------------------- attach -------------------------------- */

export function attachWebSockets(server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_SSH_MESSAGE });
  const eventClients = new Set();

  const broadcast = (payload) => {
    const data = JSON.stringify(payload);
    for (const client of eventClients) {
      if (client.readyState === client.OPEN) client.send(data);
    }
  };

  vmManager.on('change', (payload) => broadcast(payload));
  log.on('entry', (entry) => broadcast({ type: 'log', entry }));
  store.on('event', (evt) => broadcast({ type: 'event', evt }));
  store.on('task', (task) => broadcast({ type: 'task', task }));

  server.on('upgrade', (req, socket, head) => {
    let url;
    try {
      url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    } catch {
      socket.destroy();
      return;
    }
    if (!url.pathname.startsWith('/ws/')) {
      socket.destroy();
      return;
    }
    if (!isAllowedOrigin(req)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    const user = authenticate(req);
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    if (user.mustChangePassword) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    const match = url.pathname.match(/^\/ws\/(vnc|serial)\/([0-9a-f-]{36})$/i);
    const isSsh = url.pathname === '/ws/ssh';
    const isEvents = url.pathname === '/ws/events';
    if (!match && !isSsh && !isEvents) {
      socket.destroy();
      return;
    }
    if (match && !can(user, 'vm.console.view')) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    if (isSsh && !can(user, 'vm.ssh')) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.isAlive = true;
      ws.on('pong', () => {
        ws.isAlive = true;
      });
      if (match) {
        const [, kind, vmId] = match;
        const viewOnly = !can(user, 'vm.console.input');
        if (kind === 'vnc') handleVnc(ws, vmId, { viewOnly });
        else handleSerial(ws, vmId, { readOnly: viewOnly });
      } else if (isSsh) {
        handleSsh(ws, req, user);
      } else {
        eventClients.add(ws);
        sendJson(ws, {
          type: 'hello',
          user: { username: user.username, role: user.role, displayName: user.displayName || null },
          serverTime: Date.now(),
        });
        ws.on('close', () => eventClients.delete(ws));
        ws.on('error', () => eventClients.delete(ws));
      }
    });
  });

  const pingTimer = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      try {
        ws.ping();
      } catch {
        /* ignore */
      }
    }
  }, 30000);
  pingTimer.unref?.();

  return { wss, broadcast, clients: eventClients };
}
