import net from 'node:net';
import { qgaSocket } from '../env.js';

/**
 * Minimal QEMU guest agent client.
 *
 * emuman always wires a `org.qemu.guest_agent.0` virtio-serial port for each machine, so when
 * the guest runs qemu-ga we can ask it to shut down cleanly (and later to freeze filesystems
 * before snapshots). The agent speaks newline-delimited JSON over a unix socket; every request
 * is preceded by `guest-sync-delimited` because the channel may still hold stale output from an
 * earlier client or a previous boot.
 */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function connect(socketPath, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('timed out connecting to the guest agent'));
    }, timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.removeListener('error', onError);
      resolve(socket);
    });
    const onError = (err) => {
      clearTimeout(timer);
      socket.destroy();
      reject(err);
    };
    socket.once('error', onError);
  });
}

function reader(socket) {
  let buffer = Buffer.alloc(0);
  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
  });
  return async (timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const newline = buffer.indexOf(0x0a);
      if (newline !== -1) {
        const line = buffer.subarray(0, newline);
        buffer = buffer.subarray(newline + 1);
        // guest-sync-delimited replies are prefixed with raw 0xFF flush markers; strip them
        // before decoding (UTF-8 decoding would turn them into U+FFFD and break JSON.parse).
        let start = 0;
        while (start < line.length && line[start] === 0xff) start += 1;
        const text = line.subarray(start).toString('utf8').trim();
        if (!text) continue;
        try {
          return JSON.parse(text);
        } catch {
          continue;
        }
      }
      if (Date.now() >= deadline) throw new Error('guest agent did not answer');
      if (socket.destroyed) throw new Error('guest agent channel closed');
      await sleep(20);
    }
  };
}

/**
 * Run one command through the guest agent.
 * Throws when the agent is not installed, not running, or rejects the command.
 */
export async function qgaCommand(vmId, command, args = {}, { timeoutMs = 5000 } = {}) {
  const socket = await connect(qgaSocket(vmId), Math.min(2000, timeoutMs));
  const read = reader(socket);
  try {
    const syncId = Math.floor(Math.random() * 1e9);
    socket.write(`${JSON.stringify({ execute: 'guest-sync-delimited', arguments: { id: syncId } })}\n`);
    const deadline = Date.now() + timeoutMs;
    let synced = false;
    while (!synced) {
      if (Date.now() >= deadline) throw new Error('guest agent did not acknowledge the sync');
      const message = await read(Math.max(250, deadline - Date.now()));
      if (message?.return === syncId) synced = true;
    }
    socket.write(`${JSON.stringify({ execute: command, arguments: args })}\n`);
    const reply = await read(timeoutMs);
    if (reply?.error) throw new Error(reply.error.desc || reply.error.class || 'guest agent rejected the command');
    return reply?.return ?? {};
  } finally {
    socket.destroy();
  }
}

export async function qgaPing(vmId, options) {
  await qgaCommand(vmId, 'guest-ping', {}, options);
  return true;
}

/** Run a program inside the guest (fire and forget; the agent returns the pid). */
export async function qgaExec(vmId, program, args = [], options) {
  return qgaCommand(vmId, 'guest-exec', { path: program, arg: args, 'capture-output': false }, options);
}

/**
 * Ask the guest to power off, using the mechanism its OS actually honours:
 * the Windows port of qemu-ga accepts `guest-shutdown` but the request can be dropped
 * silently (seen on Windows 11 at the lock screen), while going through `shutdown.exe`
 * always works. Returns which path was used, or null when the agent is unavailable.
 */
export async function qgaRequestShutdown(vmId, { timeoutMs = 5000 } = {}) {
  let os = null;
  try {
    os = await qgaCommand(vmId, 'guest-get-osinfo', {}, { timeoutMs: 3000 });
  } catch {
    /* the agent is not there; let the caller fall back to ACPI */
    return null;
  }
  if (/windows/i.test(os?.name || os?.['pretty-name'] || '')) {
    try {
      await qgaExec(vmId, 'C:\\Windows\\System32\\shutdown.exe', ['/s', '/f', '/t', '5'], { timeoutMs });
      return 'guest-exec';
    } catch (err) {
      // fall through to the plain agent request
    }
  }
  await qgaShutdown(vmId, { timeoutMs });
  return 'guest-shutdown';
}

/**
 * Ask the guest to power off. The agent usually drops the channel mid-shutdown, so a missing
 * reply is not an error once the request has been accepted.
 */
export async function qgaShutdown(vmId, { mode = 'powerdown', timeoutMs = 5000 } = {}) {
  try {
    return await qgaCommand(vmId, 'guest-shutdown', { mode }, { timeoutMs });
  } catch (err) {
    if (/channel closed|did not answer|ECONNRESET|EPIPE/i.test(err.message)) return {};
    throw err;
  }
}
