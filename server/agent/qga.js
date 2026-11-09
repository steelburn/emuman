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

// The agent is part of the guest, i.e. untrusted: cap how much of its stream we buffer before
// giving up, so a compromised or buggy agent cannot grow host memory without bound.
const MAX_MESSAGE_BYTES = 1024 * 1024;

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
  let overflow = false;
  socket.on('data', (chunk) => {
    if (overflow) return;
    buffer = Buffer.concat([buffer, chunk]);
    if (buffer.length > MAX_MESSAGE_BYTES) {
      overflow = true;
      buffer = Buffer.alloc(0);
      socket.destroy();
    }
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
      if (overflow) throw new Error('guest agent reply exceeded the 1 MiB limit');
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

/**
 * Ask the guest to power off. The agent usually drops the channel mid-shutdown, so a missing
 * reply after the request was accepted is not an error.
 */
export async function qgaShutdown(vmId, { mode = 'powerdown', timeoutMs = 5000 } = {}) {
  try {
    return await qgaCommand(vmId, 'guest-shutdown', { mode }, { timeoutMs });
  } catch (err) {
    if (/channel closed|did not answer|ECONNRESET|EPIPE/i.test(err.message)) return {};
    throw err;
  }
}

/**
 * Ask the guest to power off. `guest-shutdown` is implemented by the agent as a real OS shutdown
 * request, so it is the reliable path — the ACPI power button is ignored by some guests, and
 * running `shutdown.exe` through `guest-exec` does not work at all (Session 0 has no console).
 * Returns which mechanism was used, or null when the agent is unavailable.
 */
export async function qgaRequestShutdown(vmId, { timeoutMs = 5000 } = {}) {
  try {
    await qgaCommand(vmId, 'guest-get-osinfo', {}, { timeoutMs: 3000 });
  } catch {
    return null; // no agent: let the caller fall back to ACPI
  }
  await qgaShutdown(vmId, { timeoutMs });
  return 'guest-shutdown';
}
