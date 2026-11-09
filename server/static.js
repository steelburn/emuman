import fs from 'node:fs';
import path from 'node:path';
import { paths } from './env.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

const ROOT = path.resolve(paths.public);

export function serveFrontend(app) {
  const indexFile = path.join(ROOT, 'index.html');
  if (!fs.existsSync(indexFile)) return false;

  const sendFile = (reply, file) => {
    const ext = path.extname(file).toLowerCase();
    reply.type(MIME[ext] || 'application/octet-stream');
    if (file.includes(`${path.sep}assets${path.sep}`)) {
      reply.header('Cache-Control', 'public, max-age=31536000, immutable');
    } else if (ext === '.html') {
      reply.header('Cache-Control', 'no-cache');
    } else {
      reply.header('Cache-Control', 'public, max-age=3600');
    }
    return reply.send(fs.createReadStream(file));
  };

  app.get('/*', async (req, reply) => {
    if (req.raw.url.startsWith('/api/') || req.raw.url.startsWith('/ws/')) {
      return reply.code(404).send({ error: 'Not found' });
    }
    const raw = String(req.params['*'] || '');
    let decoded;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      return reply.code(400).send({ error: 'Bad path' });
    }
    if (decoded.includes('\0')) return reply.code(400).send({ error: 'Bad path' });
    const candidate = path.resolve(ROOT, decoded);
    const inside = candidate === ROOT || candidate.startsWith(`${ROOT}${path.sep}`);
    if (!inside) return reply.code(404).send({ error: 'Not found' });

    try {
      const stat = await fs.promises.stat(candidate);
      if (stat.isFile()) return sendFile(reply, candidate);
    } catch {
      /* fall through to SPA */
    }
    return sendFile(reply, indexFile);
  });

  return true;
}
