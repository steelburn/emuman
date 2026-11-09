import { useEffect, useMemo, useState } from 'react';
import {
  Bot,
  Check,
  Code2,
  Copy,
  Cpu,
  ExternalLink,
  KeyRound,
  MonitorPlay,
  Plus,
  RefreshCw,
  ShieldCheck,
  TerminalSquare,
  Trash2,
  Webhook,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { copyText, timeAgo } from '../lib/format.js';
import { useToast } from '../context/ToastContext.jsx';
import { useConfirm } from '../context/ConfirmContext.jsx';
import {
  Checkbox,
  CopyButton,
  EmptyState,
  Field,
  Modal,
  Spinner,
} from '../components/ui.jsx';

const DEFAULT_SCOPES = ['read', 'control', 'console', 'exec'];

export default function AgentsPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [agents, setAgents] = useState([]);
  const [scopes, setScopes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [selected, setSelected] = useState(DEFAULT_SCOPES);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState(null);
  const [revoking, setRevoking] = useState(null);
  const origin = useMemo(() => window.location.origin, []);

  const load = async () => {
    try {
      const data = await api.get('/api/agents');
      setAgents(data.agents || []);
      setScopes(data.scopes || []);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleScope = (id) => {
    setSelected((list) => (list.includes(id) ? list.filter((s) => s !== id) : [...list, id]));
  };

  const create = async (e) => {
    e.preventDefault();
    if (!name.trim() || selected.length === 0) return;
    setCreating(true);
    try {
      const data = await api.post('/api/agents', { name: name.trim(), scopes: selected });
      setCreated(data);
      setName('');
      await load();
    } catch (err) {
      toast.error(err.message, { title: 'Could not create token' });
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (agent) => {
    const ok = await confirm({
      title: `Revoke "${agent.name}"?`,
      message: 'Any agent using this token will immediately lose access. This cannot be undone.',
      confirmLabel: 'Revoke token',
      danger: true,
    });
    if (!ok) return;
    setRevoking(agent.id);
    try {
      await api.del(`/api/agents/${agent.id}`);
      toast.success(`Token "${agent.name}" revoked`);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setRevoking(null);
    }
  };

  const exampleConfig = created
    ? JSON.stringify(
        {
          mcpServers: {
            emuman: {
              type: 'http',
              url: `${origin}/mcp`,
              headers: { Authorization: `Bearer ${created.token}` },
            },
          },
        },
        null,
        2,
      )
    : '';

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Agents</h1>
          <p className="page-sub">
            Connect AI agents and automation over scoped REST tokens or MCP — including screen,
            mouse and keyboard control of guests.
          </p>
        </div>
        <div className="page-actions">
          <button className="btn btn-ghost btn-sm" onClick={load} disabled={loading}>
            {loading ? <Spinner size={14} /> : <RefreshCw size={14} />} Refresh
          </button>
        </div>
      </div>

      <div className="callout-grid mb-16">
        <div className="callout">
          <span className="callout-icon">
            <Bot size={15} />
          </span>
          <div>
            <h4>MCP tools</h4>
            <p>Streamable HTTP MCP endpoint with tools for lifecycle, console and computer use.</p>
          </div>
        </div>
        <div className="callout">
          <span className="callout-icon">
            <MonitorPlay size={15} />
          </span>
          <div>
            <h4>Computer use</h4>
            <p>PNG screenshots, absolute pointer clicks, drags, scrolls, typing and key combos.</p>
          </div>
        </div>
        <div className="callout">
          <span className="callout-icon">
            <TerminalSquare size={15} />
          </span>
          <div>
            <h4>Guest exec</h4>
            <p>Optional SSH command execution using credentials saved per VM.</p>
          </div>
        </div>
        <div className="callout">
          <span className="callout-icon">
            <ShieldCheck size={15} />
          </span>
          <div>
            <h4>Scoped &amp; revocable</h4>
            <p>Tokens are hashed at rest, scoped by capability and audited by name.</p>
          </div>
        </div>
      </div>

      <div className="split" style={{ '--side': '360px' }}>
        <div className="detail-side" style={{ gap: 16 }}>
          <div className="card">
            <div className="card-head">
              <span className="card-title-icon">
                <KeyRound size={15} />
              </span>
              <h3>Agent tokens</h3>
              <span className="muted">{agents.length}</span>
            </div>
            {loading ? (
              <div className="table-empty">
                <Spinner size={15} /> Loading tokens…
              </div>
            ) : agents.length === 0 ? (
              <EmptyState
                compact
                icon={<Bot size={20} />}
                title="No agent tokens yet"
                description="Create a scoped token on the right to connect Claude, another MCP client or a custom automation."
              />
            ) : (
              <div className="table-wrap" style={{ border: 'none', borderRadius: 0, boxShadow: 'none' }}>
                <table className="table" style={{ minWidth: 640 }}>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Scopes</th>
                      <th>Token</th>
                      <th>Last used</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {agents.map((agent) => (
                      <tr key={agent.id}>
                        <td>
                          <div className="cell-main">
                            <span className="vm-avatar" style={{ width: 30, height: 30, borderRadius: 8 }}>
                              <Bot size={14} />
                            </span>
                            <div>
                              <div className="cell-name">{agent.name}</div>
                              <div className="cell-sub">created {timeAgo(agent.createdAt)}</div>
                            </div>
                          </div>
                        </td>
                        <td>
                          <div className="flex gap-4" style={{ flexWrap: 'wrap' }}>
                            {agent.scopes.map((scope) => (
                              <span key={scope} className="badge accent">
                                {scope}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="mono tiny muted-2">emuman_••••{agent.hint}</td>
                        <td className="tiny muted-2">
                          {agent.lastUsedAt ? timeAgo(agent.lastUsedAt) : 'never'}
                        </td>
                        <td className="actions-cell">
                          <button
                            className="btn btn-sm btn-ghost"
                            onClick={() => revoke(agent)}
                            disabled={revoking === agent.id}
                          >
                            {revoking === agent.id ? <Spinner size={12} /> : <Trash2 size={12} />} Revoke
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-head">
              <span className="card-title-icon">
                <Webhook size={15} />
              </span>
              <h3>Endpoints</h3>
            </div>
            <div className="card-body form-stack">
              <div>
                <div className="tiny muted-2 mb-12">MCP (STREAMABLE HTTP)</div>
                <div className="endpoint-row">
                  <code>{origin}/mcp</code>
                  <CopyButton value={`${origin}/mcp`} label="" />
                </div>
              </div>
              <div>
                <div className="tiny muted-2 mb-12">AGENT REST API</div>
                <div className="endpoint-row">
                  <code>{origin}/api/agent</code>
                  <CopyButton value={`${origin}/api/agent`} label="" />
                </div>
              </div>
              <div className="console-hint">
                <ExternalLink size={14} />
                <span>
                  Authenticate with <code>Authorization: Bearer &lt;token&gt;</code>. Use HTTPS or a
                  local tunnel when connecting from another machine.
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="detail-side">
          <div className="card">
            <div className="card-head">
              <span className="card-title-icon">
                <Plus size={15} />
              </span>
              <h3>Create a token</h3>
            </div>
            <form className="card-body form-stack" onSubmit={create}>
              <Field label="Agent name" hint="Shown in the audit log, e.g. “claude-desktop” or “ci-runner”." required>
                <input
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="claude-desktop"
                  maxLength={48}
                  required
                />
              </Field>
              <div className="field">
                <span className="field-label">Capabilities</span>
                <div className="agent-scopes">
                  {scopes.map((scope) => (
                    <div key={scope.id} className={`scope-card ${selected.includes(scope.id) ? 'selected' : ''}`}>
                      <Checkbox
                        checked={selected.includes(scope.id)}
                        onChange={() => toggleScope(scope.id)}
                        label={scope.label}
                      />
                      <p>{scope.description}</p>
                    </div>
                  ))}
                </div>
              </div>
              <button
                className="btn btn-primary btn-block"
                type="submit"
                disabled={creating || !name.trim() || selected.length === 0}
              >
                {creating ? <Spinner size={14} /> : <KeyRound size={14} />} Generate token
              </button>
              <p className="tiny muted-2">
                The token is shown once. It is stored only as a SHA-256 hash on this host.
              </p>
            </form>
          </div>

          <div className="card">
            <div className="card-head">
              <span className="card-title-icon">
                <Code2 size={15} />
              </span>
              <h3>Quick start</h3>
            </div>
            <div className="card-body">
              <div className="tiny muted-2 mb-8">1 · Create a token, then test the REST API</div>
              <div className="code-block" style={{ maxHeight: 150 }}>
{`curl -H "Authorization: Bearer $EMUMAN_TOKEN" \\
  ${origin}/api/agent/vms`}
              </div>
              <div className="tiny muted-2 mb-8 mt-16">2 · Add the MCP server (Claude Code)</div>
              <div className="code-block" style={{ maxHeight: 150 }}>
{`claude mcp add --transport http emuman \\
  ${origin}/mcp \\
  --header "Authorization: Bearer $EMUMAN_TOKEN"`}
              </div>
              <div className="tiny muted-2 mb-8 mt-16">3 · Computer use loop</div>
              <div className="code-block" style={{ maxHeight: 220 }}>
{`# screenshot → coordinates
curl -H "Authorization: Bearer $EMUMAN_TOKEN" \\
  ${origin}/api/agent/vms/<id>/screenshot -o screen.png

# click at (640, 400), then type
curl -H "Authorization: Bearer $EMUMAN_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"type":"click","x":640,"y":400}' \\
  ${origin}/api/agent/vms/<id>/input

curl -H "Authorization: Bearer $EMUMAN_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"type":"type","text":"root\\n"}' \\
  ${origin}/api/agent/vms/<id>/input`}
              </div>
              <div className="console-hint mt-16">
                <Cpu size={14} />
                <span>
                  The MCP tools mirror this API, e.g. <code>emuman_screenshot</code>,{' '}
                  <code>emuman_click</code>, <code>emuman_type_text</code>,{' '}
                  <code>emuman_press_keys</code>, <code>emuman_serial_read</code>,{' '}
                  <code>emuman_exec</code>.
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {created && (
        <Modal
          title="Agent token created"
          subtitle="Copy it now — it will not be shown again."
          icon={<KeyRound size={17} />}
          onClose={() => setCreated(null)}
          size="lg"
          footer={
            <button className="btn btn-primary" onClick={() => setCreated(null)}>
              <Check size={14} /> Done
            </button>
          }
        >
          <div className="alert alert-warn mb-16">
            <ShieldCheck size={15} />
            <span>
              This bearer token grants the selected scopes. Store it in a secret manager, not in
              source control. Revoke it here at any time.
            </span>
          </div>
          <div className="field">
            <span className="field-label">Token for “{created.agent.name}”</span>
            <div className="token-value">
              <code>{created.token}</code>
              <button className="btn btn-sm" onClick={() => copyText(created.token)}>
                <Copy size={13} /> Copy
              </button>
            </div>
            <p className="field-hint">
              Scopes: {created.agent.scopes.join(', ')}
            </p>
          </div>
          <div className="tiny muted-2 mt-16 mb-8">MCP configuration (Claude Desktop / generic)</div>
          <div className="code-block" style={{ maxHeight: 240 }}>
            {exampleConfig}
          </div>
          <div className="flex gap-8 mt-12">
            <CopyButton value={exampleConfig} label="Copy MCP config" />
            <CopyButton value={`${origin}/mcp`} label="Copy endpoint" />
          </div>
        </Modal>
      )}
    </div>
  );
}
