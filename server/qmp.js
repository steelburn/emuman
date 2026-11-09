import net from 'node:net';
import { EventEmitter } from 'node:events';

/**
 * Minimal QEMU Machine Protocol (QMP) client over a unix socket.
 * QMP speaks newline-delimited JSON.
 */
export class QMPClient extends EventEmitter {
  constructor(socket, path) {
    super();
    this.socket = socket;
    this.path = path;
    this.buffer = '';
    this.pending = new Map();
    this.nextId = 1;
    this.ready = false;
    this.closed = false;

    socket.setEncoding('utf8');
    socket.on('data', (chunk) => this._onData(chunk));
    socket.on('error', (err) => {
      this.emit('error', err);
    });
    socket.on('close', () => {
      this.closed = true;
      for (const [, entry] of this.pending) {
        entry.reject(new Error('QMP connection closed'));
      }
      this.pending.clear();
      this.emit('close');
    });
  }

  _onData(chunk) {
    this.buffer += chunk;
    let idx;
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      this._handle(msg);
    }
  }

  _handle(msg) {
    if (msg.QMP) {
      this.emit('greeting', msg.QMP);
      return;
    }
    if (msg.event) {
      this.emit('event', msg);
      this.emit(`event:${msg.event}`, msg);
      return;
    }
    if (msg.id && this.pending.has(msg.id)) {
      const entry = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) {
        const err = new Error(msg.error.desc || 'QMP error');
        err.qmp = msg.error;
        entry.reject(err);
      } else {
        entry.resolve(msg.return);
      }
      return;
    }
    if (msg.return !== undefined) {
      this.emit('return', msg.return);
    }
  }

  execute(command, args = undefined, timeoutMs = 15000) {
    if (this.closed) return Promise.reject(new Error('QMP connection closed'));
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`QMP command timed out: ${command}`));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
      const payload = { execute: command };
      if (args !== undefined) payload.arguments = args;
      payload.id = id;
      try {
        this.socket.write(`${JSON.stringify(payload)}\r\n`);
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      }
    });
  }

  async hmp(commandLine) {
    return this.execute('human-monitor-command', { 'command-line': commandLine });
  }

  close() {
    if (!this.closed) {
      try {
        this.socket.end();
      } catch {
        /* ignore */
      }
      this.closed = true;
    }
  }
}

export async function connectQMP(socketPath, { timeoutMs = 10000, retryDelayMs = 150 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      return await tryConnect(socketPath, Math.min(2500, deadline - Date.now()));
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
  throw new Error(`Unable to connect to QMP at ${socketPath}: ${lastError?.message || 'timeout'}`);
}

function tryConnect(socketPath, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    const client = new QMPClient(socket, socketPath);
    let settled = false;

    const fail = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      client.close();
      reject(err);
    };

    const timer = setTimeout(() => fail(new Error('timeout waiting for QMP greeting')), timeoutMs);

    client.once('greeting', async () => {
      try {
        await client.execute('qmp_capabilities', undefined, 3000);
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        client.ready = true;
        resolve(client);
      } catch (err) {
        fail(err);
      }
    });
    client.once('error', fail);
    socket.once('error', fail);
    socket.once('close', () => fail(new Error('socket closed before handshake')));
  });
}
