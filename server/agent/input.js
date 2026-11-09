import path from 'node:path';
import fsp from 'node:fs/promises';
import net from 'node:net';
import { vmManager, httpError } from '../vm-manager.js';
import { paths, serialSocket } from '../env.js';

/* -------------------------------- key tables ------------------------------- */

const NAMED_KEYS = {
  enter: 'ret',
  return: 'ret',
  ret: 'ret',
  esc: 'esc',
  escape: 'esc',
  tab: 'tab',
  space: 'spc',
  spc: 'spc',
  backspace: 'backspace',
  bs: 'backspace',
  delete: 'delete',
  del: 'delete',
  insert: 'insert',
  ins: 'insert',
  home: 'home',
  end: 'end',
  pageup: 'pgup',
  pgup: 'pgup',
  pagedown: 'pgdn',
  pgdn: 'pgdn',
  up: 'up',
  down: 'down',
  left: 'left',
  right: 'right',
  ctrl: 'ctrl',
  control: 'ctrl',
  alt: 'alt',
  option: 'alt',
  shift: 'shift',
  meta: 'meta_l',
  super: 'meta_l',
  win: 'meta_l',
  cmd: 'meta_l',
  command: 'meta_l',
  capslock: 'caps_lock',
  printscreen: 'print',
  scrolllock: 'scroll_lock',
  pause: 'pause',
  menu: 'menu',
};
for (let i = 1; i <= 12; i += 1) NAMED_KEYS[`f${i}`] = `f${i}`;
for (let i = 0; i <= 9; i += 1) NAMED_KEYS[`${i}`] = `${i}`;

const PUNCTUATION = {
  '-': 'minus',
  _: 'minus',
  '=': 'equal',
  '+': 'equal',
  '[': 'bracket_left',
  '{': 'bracket_left',
  ']': 'bracket_right',
  '}': 'bracket_right',
  '\\': 'backslash',
  '|': 'backslash',
  ';': 'semicolon',
  ':': 'semicolon',
  "'": 'apostrophe',
  '"': 'apostrophe',
  '`': 'grave_accent',
  '~': 'grave_accent',
  ',': 'comma',
  '<': 'comma',
  '.': 'dot',
  '>': 'dot',
  '/': 'slash',
  '?': 'slash',
  ' ': 'spc',
};

const SHIFTED = new Set(['_', '+', '{', '}', '|', ':', '"', '~', '<', '>', '?']);

function charKey(ch) {
  if (/^[a-z]$/.test(ch)) return { key: ch, shift: false };
  if (/^[A-Z]$/.test(ch)) return { key: ch.toLowerCase(), shift: true };
  if (/^[0-9]$/.test(ch)) return { key: ch, shift: false };
  const shiftedDigit = {
    '!': '1', '@': '2', '#': '3', $: '4', '%': '5', '^': '6', '&': '7', '*': '8', '(': '9', ')': '0',
  };
  if (shiftedDigit[ch]) return { key: shiftedDigit[ch], shift: true };
  if (PUNCTUATION[ch]) return { key: PUNCTUATION[ch], shift: SHIFTED.has(ch) };
  if (ch === '\n' || ch === '\r') return { key: 'ret', shift: false };
  if (ch === '\t') return { key: 'tab', shift: false };
  return null;
}

function keyEvent(key, down) {
  return { type: 'key', data: { down, key: { type: 'qcode', data: key } } };
}

async function inject(qmp, events) {
  await qmp.execute('input-send-event', { events }, 10000);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* --------------------------------- display -------------------------------- */

export function pngSize(buffer) {
  if (!buffer || buffer.length < 24) return null;
  if (buffer.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

export async function displaySize(vm, { refresh = false } = {}) {
  const rt = vmManager.runtime(vm.id);
  if (!rt) throw httpError(404, 'Virtual machine not found');
  if (!refresh && rt.display && Date.now() - rt.display.at < 15000) return rt.display;
  const buffer = await vmManager.screenshot(vm.id);
  const size = pngSize(buffer);
  if (!size) throw httpError(500, 'Could not determine display resolution');
  const display = { ...size, at: Date.now() };
  rt.display = display;
  return display;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Math.round(Number(value) || 0)));
}

function absEvents(display, x, y) {
  const px = clamp(x, 0, Math.max(0, display.width - 1));
  const py = clamp(y, 0, Math.max(0, display.height - 1));
  return [
    { type: 'abs', data: { axis: 'x', value: Math.round((px / Math.max(1, display.width - 1)) * 32767) } },
    { type: 'abs', data: { axis: 'y', value: Math.round((py / Math.max(1, display.height - 1)) * 32767) } },
  ];
}

function requireInteractive(vm) {
  const rt = vmManager.runtime(vm.id);
  if (!rt || !['running', 'paused'].includes(rt.status) || !rt.qmp) {
    throw httpError(409, 'Virtual machine is not running');
  }
  return rt;
}

function validateButton(button) {
  const value = String(button || 'left').toLowerCase();
  if (!['left', 'right', 'middle'].includes(value)) {
    throw httpError(400, 'button must be left, right or middle');
  }
  return value;
}

/* ---------------------------------- input --------------------------------- */

export async function movePointer(vm, { x, y }) {
  const rt = requireInteractive(vm);
  const display = await displaySize(vm);
  await inject(rt.qmp, absEvents(display, x, y));
  return { x: clamp(x, 0, display.width - 1), y: clamp(y, 0, display.height - 1), display };
}

export async function clickPointer(vm, { x, y, button = 'left', clicks = 1 }) {
  const rt = requireInteractive(vm);
  const display = await displaySize(vm);
  const btn = validateButton(button);
  const count = clamp(clicks, 1, 5);
  const events = [];
  if (x !== undefined && y !== undefined) events.push(...absEvents(display, x, y));
  await inject(rt.qmp, events.length ? events : absEvents(display, display.width / 2, display.height / 2));
  await sleep(40);
  for (let i = 0; i < count; i += 1) {
    await inject(rt.qmp, [
      { type: 'btn', data: { down: true, button: btn } },
      { type: 'btn', data: { down: false, button: btn } },
    ]);
    if (i < count - 1) await sleep(80);
  }
  return {
    button: btn,
    clicks: count,
    x: x !== undefined ? clamp(x, 0, display.width - 1) : null,
    y: y !== undefined ? clamp(y, 0, display.height - 1) : null,
    display,
  };
}

export async function dragPointer(vm, { fromX, fromY, toX, toY, button = 'left', steps = 8 }) {
  const rt = requireInteractive(vm);
  const display = await displaySize(vm);
  const btn = validateButton(button);
  await inject(rt.qmp, absEvents(display, fromX, fromY));
  await sleep(40);
  await inject(rt.qmp, [{ type: 'btn', data: { down: true, button: btn } }]);
  const count = clamp(steps, 1, 30);
  for (let i = 1; i <= count; i += 1) {
    const x = Number(fromX) + ((Number(toX) - Number(fromX)) * i) / count;
    const y = Number(fromY) + ((Number(toY) - Number(fromY)) * i) / count;
    await inject(rt.qmp, absEvents(display, x, y));
    await sleep(20);
  }
  await inject(rt.qmp, [{ type: 'btn', data: { down: false, button: btn } }]);
  return { from: { x: clamp(fromX, 0, display.width - 1), y: clamp(fromY, 0, display.height - 1) }, to: { x: clamp(toX, 0, display.width - 1), y: clamp(toY, 0, display.height - 1) }, display };
}

export async function scrollPointer(vm, { dy = 1, dx = 0, x, y }) {
  const rt = requireInteractive(vm);
  const display = await displaySize(vm);
  if (x !== undefined && y !== undefined) await inject(rt.qmp, absEvents(display, x, y));
  const vertical = clamp(dy, -20, 20);
  const horizontal = clamp(dx, -20, 20);
  for (let i = 0; i < Math.abs(vertical); i += 1) {
    const button = vertical > 0 ? 'wheel-down' : 'wheel-up';
    await inject(rt.qmp, [
      { type: 'btn', data: { down: true, button } },
      { type: 'btn', data: { down: false, button } },
    ]);
    await sleep(25);
  }
  for (let i = 0; i < Math.abs(horizontal); i += 1) {
    const button = horizontal > 0 ? 'wheel-right' : 'wheel-left';
    await inject(rt.qmp, [
      { type: 'btn', data: { down: true, button } },
      { type: 'btn', data: { down: false, button } },
    ]);
    await sleep(25);
  }
  return { dy: vertical, dx: horizontal, display };
}

export async function typeText(vm, { text, intervalMs = 18 }) {
  const rt = requireInteractive(vm);
  const input = String(text ?? '');
  if (!input) throw httpError(400, 'text is required');
  if (input.length > 2000) throw httpError(400, 'text is limited to 2000 characters');
  const delay = clamp(intervalMs, 0, 200);
  let typed = 0;
  const skipped = [];
  for (const ch of input) {
    const mapped = charKey(ch);
    if (!mapped) {
      skipped.push(ch);
      continue;
    }
    const events = [];
    if (mapped.shift) events.push(keyEvent('shift', true));
    events.push(keyEvent(mapped.key, true), keyEvent(mapped.key, false));
    if (mapped.shift) events.push(keyEvent('shift', false));
    await inject(rt.qmp, events);
    typed += 1;
    if (delay) await sleep(delay);
  }
  return { typed, skipped: skipped.length ? [...new Set(skipped)].join('') : null, display: await displaySize(vm) };
}

function normalizeCombo(keys) {
  const list = Array.isArray(keys) ? keys : String(keys || '').split(/[+,]/);
  const codes = [];
  for (const raw of list) {
    const name = String(raw).trim().toLowerCase();
    if (!name) continue;
    const named = NAMED_KEYS[name];
    if (named) {
      codes.push(named);
      continue;
    }
    if (name.length === 1) {
      const mapped = charKey(name);
      if (mapped) {
        if (mapped.shift && !codes.includes('shift')) codes.push('shift');
        codes.push(mapped.key);
        continue;
      }
    }
    throw httpError(400, `Unknown key "${raw}"`);
  }
  if (!codes.length) throw httpError(400, 'No keys supplied');
  return codes;
}

export async function pressKeys(vm, { keys }) {
  const rt = requireInteractive(vm);
  const codes = normalizeCombo(keys);
  const events = [];
  for (const code of codes) events.push(keyEvent(code, true));
  for (const code of [...codes].reverse()) events.push(keyEvent(code, false));
  await inject(rt.qmp, events);
  return { keys: codes, display: await displaySize(vm) };
}

export async function applyInput(vm, payload = {}) {
  const type = String(payload.type || '').toLowerCase();
  switch (type) {
    case 'move':
      return { type, ...(await movePointer(vm, payload)) };
    case 'click':
      return { type, ...(await clickPointer(vm, payload)) };
    case 'drag':
      return { type, ...(await dragPointer(vm, payload)) };
    case 'scroll':
      return { type, ...(await scrollPointer(vm, payload)) };
    case 'type':
    case 'text':
      return { type: 'type', ...(await typeText(vm, payload)) };
    case 'key':
    case 'keys':
      return { type: 'key', ...(await pressKeys(vm, payload)) };
    default:
      throw httpError(400, 'type must be move, click, drag, scroll, type or key');
  }
}

/* ---------------------------------- serial -------------------------------- */

export async function writeSerial(vm, { text, appendNewline = false }) {
  const rt = requireInteractive(vm);
  if (!vm.serialEnabled) throw httpError(400, 'Serial console is disabled for this VM');
  let payload = String(text ?? '');
  if (appendNewline && !/[\r\n]$/.test(payload)) payload += '\r';
  if (!payload) throw httpError(400, 'text is required');
  const socketPath = serialSocket(vm.id);
  await new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(httpError(504, 'Serial console did not accept input (another client may be attached)'));
    }, 4000);
    socket.on('connect', () => {
      socket.write(payload, () => {
        setTimeout(() => {
          clearTimeout(timer);
          socket.end();
          resolve();
        }, 250);
      });
    });
    socket.on('error', (err) => {
      clearTimeout(timer);
      reject(httpError(502, `Serial console unavailable: ${err.message}`));
    });
  });
  return { bytes: Buffer.byteLength(payload), status: rt.status };
}
