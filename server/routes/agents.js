import { store } from '../store.js';
import { AGENT_SCOPES, normalizeScopes } from '../agent/auth.js';
import { requirePermission } from '../permissions.js';

export default async function agentTokenRoutes(app) {
  app.addHook('preHandler', requirePermission('agents.manage'));

  app.get('/', async () => ({
    agents: store.agents(),
    scopes: AGENT_SCOPES,
    endpoints: {
      rest: '/api/agent',
      mcp: '/mcp',
    },
  }));

  app.post('/', async (req, reply) => {
    const name = String(req.body?.name || '').trim();
    const scopes = normalizeScopes(req.body?.scopes);
    if (name.length < 2 || name.length > 48) {
      return reply.code(400).send({ error: 'Name must be between 2 and 48 characters' });
    }
    if (!scopes.length) {
      return reply.code(400).send({ error: 'Select at least one scope' });
    }
    const { agent, token } = store.createAgent({ name, scopes });
    store.addEvent({
      action: 'agent.token-create',
      message: `${req.user.username} created agent token "${name}" (${scopes.join(', ')})`,
      user: req.user.username,
      ip: req.ip,
    });
    reply.code(201);
    return { agent, token, scopes: AGENT_SCOPES };
  });

  app.delete('/:id', async (req, reply) => {
    const agent = store.revokeAgent(req.params.id);
    if (!agent) return reply.code(404).send({ error: 'Agent token not found' });
    store.addEvent({
      action: 'agent.token-revoke',
      message: `${req.user.username} revoked agent token "${agent.name}"`,
      user: req.user.username,
      ip: req.ip,
      level: 'warn',
    });
    return { ok: true, id: agent.id };
  });
}
