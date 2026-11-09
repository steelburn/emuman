import { EventEmitter } from 'node:events';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const COLORS = {
  debug: '\x1b[90m',
  info: '\x1b[36m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
};
const RESET = '\x1b[0m';

export class Logger extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(100);
    this.ring = [];
    this.max = 500;
  }

  write(level, scope, message, meta) {
    const entry = {
      ts: Date.now(),
      level,
      scope,
      message: String(message),
      ...(meta ? { meta } : {}),
    };
    this.ring.push(entry);
    if (this.ring.length > this.max) this.ring.shift();
    const stamp = new Date(entry.ts).toISOString().slice(11, 23);
    const color = COLORS[level] || '';
    const extra = meta ? ` ${JSON.stringify(meta)}` : '';
    process.stdout.write(
      `${color}${stamp} ${level.toUpperCase().padEnd(5)} ${scope.padEnd(8)}${RESET} ${message}${extra}\n`,
    );
    this.emit('entry', entry);
    return entry;
  }

  debug(scope, message, meta) {
    if (LEVELS[process.env.EMUMAN_LOG_LEVEL || 'info'] <= LEVELS.debug) {
      return this.write('debug', scope, message, meta);
    }
    return null;
  }
  info(scope, message, meta) {
    return this.write('info', scope, message, meta);
  }
  warn(scope, message, meta) {
    return this.write('warn', scope, message, meta);
  }
  error(scope, message, meta) {
    return this.write('error', scope, message, meta);
  }

  recent(limit = 100) {
    return this.ring.slice(-limit);
  }
}

export const log = new Logger();
