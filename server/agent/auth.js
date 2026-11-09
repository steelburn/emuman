import { store } from '../store.js';

export const AGENT_SCOPES = [
  {
    id: 'read',
    label: 'Read',
    description: 'List machines, inspect configuration, runtime state, logs and snapshots.',
  },
  {
    id: 'control',
    label: 'Control',
    description: 'Start, stop, reboot, pause, create/delete/clone machines and manage snapshots.',
  },
  {
    id: 'console',
    label: 'Console',
    description: 'View the VM screen/serial output and inject mouse, keyboard and serial input.',
  },
  {
    id: 'exec',
    label: 'Guest exec',
    description: 'Run commands inside a guest over SSH using saved or supplied credentials.',
  },
];

const SCOPE_IDS = new Set(AGENT_SCOPES.map((s) => s.id));

export function normalizeScopes(scopes) {
  const list = Array.isArray(scopes) ? scopes : [];
  return [...new Set(list.filter((s) => SCOPE_IDS.has(s)))];
}

export function readToken(req) {
  const header = String(req.headers.authorization || '');
  if (header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim();
  const alt = req.headers['x-emuman-token'];
  if (alt) return String(alt).trim();
  return null;
}

export function authenticateAgent(req) {
  const token = readToken(req);
  if (!token) return { error: 'A bearer token is required', status: 401 };
  const agent = store.resolveAgent(token);
  if (!agent) return { error: 'Invalid or revoked agent token', status: 401 };
  store.touchAgent(agent, req.ip);
  return { agent, token };
}

export function hasScope(agent, scope) {
  return Boolean(agent?.scopes?.includes(scope));
}

export function scopeGuard(scope) {
  return async (req, reply) => {
    const result = authenticateAgent(req);
    if (result.error) return reply.code(result.status).send({ error: result.error });
    req.agent = result.agent;
    if (!hasScope(result.agent, scope)) {
      return reply.code(403).send({
        error: `This token does not have the "${scope}" scope`,
        requiredScope: scope,
        grantedScopes: result.agent.scopes,
      });
    }
    return undefined;
  };
}

export function applyAgentCors(reply) {
  reply.header('Access-Control-Allow-Origin', '*');
  reply.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  reply.header(
    'Access-Control-Allow-Headers',
    'Authorization, Content-Type, X-Emuman-Token, X-Emuman, Mcp-Protocol-Version, Mcp-Session-Id',
  );
  reply.header(
    'Access-Control-Expose-Headers',
    'X-Display-Width, X-Display-Height, X-VM-Status, X-Agent-Name',
  );
  reply.header('Access-Control-Max-Age', '600');
  reply.header('Vary', 'Origin');
}

export function preflight(reply) {
  applyAgentCors(reply);
  return reply.code(204).send();
}
