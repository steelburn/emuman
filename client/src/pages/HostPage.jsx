import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Activity,
  ClipboardList,
  Cpu,
  Download,
  HardDrive,
  ListChecks,
  MemoryStick,
  RefreshCw,
  Server,
  ShieldCheck,
  TerminalSquare,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useData } from '../context/DataContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { formatBytes, formatDate, formatUptime, pct, timeAgo } from '../lib/format.js';
import {
  CopyButton,
  EmptyState,
  Meter,
  Segmented,
  Sparkline,
  Spinner,
  StatusPill,
} from '../components/ui.jsx';

const TABS = [
  { id: 'system', label: 'System', icon: Server },
  { id: 'audit', label: 'Audit log', icon: Activity },
  { id: 'tasks', label: 'Tasks', icon: ListChecks },
  { id: 'logs', label: 'Server log', icon: TerminalSquare, permission: 'host.logs' },
];

export default function HostPage() {
  const { host, events, tasks, refreshHost, connected } = useData();
  const { can } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabs = TABS.filter((t) => !t.permission || can(t.permission));
  const requested = searchParams.get('tab');
  const tab = tabs.some((t) => t.id === requested) ? requested : 'system';
  const [hist, setHist] = useState({ cpu: [], mem: [] });
  const [level, setLevel] = useState('all');
  const [logs, setLogs] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [autoLogs, setAutoLogs] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!host?.sampleAt) return;
    setHist((prev) => ({
      cpu: [...prev.cpu, Number(host.cpuPct) || 0].slice(-60),
      mem: [...prev.mem, host.memTotal ? (host.memUsed / host.memTotal) * 100 : 0].slice(-60),
    }));
  }, [host?.sampleAt, host?.cpuPct, host?.memUsed, host?.memTotal]);

  const loadLogs = async () => {
    setLogsLoading(true);
    try {
      const data = await api.get('/api/host/logs?limit=400');
      setLogs(data.logs || []);
    } catch {
      /* ignore */
    } finally {
      setLogsLoading(false);
    }
  };

  useEffect(() => {
    if (tab !== 'logs') return;
    loadLogs();
    if (!autoLogs) return;
    const timer = setInterval(() => {
      if (!document.hidden) loadLogs();
    }, 4000);
    return () => clearInterval(timer);
  }, [tab, autoLogs]);

  const filteredEvents = useMemo(() => {
    if (level === 'all') return events;
    if (level === 'warn') return events.filter((e) => e.level === 'warn');
    if (level === 'error') return events.filter((e) => e.level === 'error');
    return events.filter((e) => !e.level || e.level === 'info');
  }, [events, level]);

  const refresh = async () => {
    setRefreshing(true);
    await refreshHost();
    setTimeout(() => setRefreshing(false), 400);
  };

  const setTab = (id) => {
    if (id === 'system') setSearchParams({});
    else setSearchParams({ tab: id });
  };

  const storagePct = host?.storage?.total ? (host.storage.used / host.storage.total) * 100 : 0;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Host &amp; audit</h1>
          <p className="page-sub">
            {host?.hostname} · {host?.platform} {host?.release} · emuman {host?.version}
          </p>
        </div>
        <div className="page-actions">
          <button className="btn btn-ghost btn-sm" onClick={refresh} disabled={refreshing}>
            {refreshing ? <Spinner size={14} /> : <RefreshCw size={14} />} Refresh
          </button>
          <span className="live-indicator">
            <span className={`live-dot ${connected ? 'on' : 'off'}`} />
            <span>{connected ? 'live metrics' : 'reconnecting'}</span>
          </span>
        </div>
      </div>

      <div className="tabs">
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
              <Icon size={14} /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'system' && (
        <div className="detail-side" style={{ gap: 16 }}>
          <div className="grid grid-2">
            <div className="card">
              <div className="card-head">
                <span className="card-title-icon">
                  <Cpu size={15} />
                </span>
                <h3>Host load</h3>
                <div className="card-head-actions">
                  <span className="badge">{host?.cpuCount || '—'} threads</span>
                </div>
              </div>
              <div className="card-body">
                <div className="flex items-end justify-between" style={{ marginBottom: 6 }}>
                  <div className="stat-value" style={{ marginTop: 0 }}>
                    {pct(host?.cpuPct ?? 0)}
                    <span className="unit">CPU</span>
                  </div>
                  <div className="mono tiny muted-2">load {host?.load?.map((n) => n.toFixed(2)).join(' / ')}</div>
                </div>
                <Sparkline data={hist.cpu} max={100} height={54} />
                <div className="divider" />
                <div className="flex items-end justify-between" style={{ marginBottom: 6 }}>
                  <div className="small text-soft">Memory</div>
                  <div className="mono tiny muted-2">
                    {formatBytes(host?.memUsed)} / {formatBytes(host?.memTotal)}
                  </div>
                </div>
                <Meter value={host?.memUsed || 0} max={host?.memTotal || 1} thin />
                <div className="divider" />
                <div className="flex items-end justify-between" style={{ marginBottom: 6 }}>
                  <div className="small text-soft">Storage pool</div>
                  <div className="mono tiny muted-2">
                    {formatBytes(host?.storage?.used)} / {formatBytes(host?.storage?.total)}
                  </div>
                </div>
                <Meter
                  value={host?.storage?.used || 0}
                  max={host?.storage?.total || 1}
                  thin
                  tone={storagePct > 90 ? 'danger' : storagePct > 75 ? 'warn' : 'accent'}
                />
                <div className="divider" />
                <div className="flex items-center justify-between small">
                  <span className="muted">Uptime</span>
                  <span className="mono">{host?.uptime ? formatUptime(host.uptime) : '—'}</span>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <span className="card-title-icon">
                  <Server size={15} />
                </span>
                <h3>System information</h3>
              </div>
              <div className="card-body">
                <div className="data-row">
                  <span className="data-label">Hostname</span>
                  <span className="data-value mono">{host?.hostname}</span>
                </div>
                <div className="data-row">
                  <span className="data-label">Operating system</span>
                  <span className="data-value">
                    {host?.platform} {host?.release} ({host?.arch})
                  </span>
                </div>
                <div className="data-row">
                  <span className="data-label">CPU model</span>
                  <span className="data-value">{host?.cpuModel}</span>
                </div>
                <div className="data-row">
                  <span className="data-label">Threads</span>
                  <span className="data-value mono">{host?.cpuCount}</span>
                </div>
                <div className="data-row">
                  <span className="data-label">Virtualization</span>
                  <span className="data-value">
                    <StatusPill
                      status={host?.kvm ? 'running' : 'paused'}
                      label={host?.kvm ? 'KVM accelerated' : 'Software emulation (TCG)'}
                      pulse={false}
                    />
                  </span>
                </div>
                <div className="data-row">
                  <span className="data-label">QEMU</span>
                  <span className="data-value mono">{host?.qemuVersion || 'not detected'}</span>
                </div>
                <div className="data-row">
                  <span className="data-label">UEFI firmware</span>
                  <span className="data-value mono tiny">{host?.firmware?.join(', ') || 'none'}</span>
                </div>
                <div className="data-row">
                  <span className="data-label">Node version</span>
                  <span className="data-value mono">{host?.nodeVersion}</span>
                </div>
                <div className="data-row">
                  <span className="data-label">emuman</span>
                  <span className="data-value mono">{host?.version}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <span className="card-title-icon">
                <HardDrive size={15} />
              </span>
              <h3>Paths &amp; capacity</h3>
            </div>
            <div className="card-body">
              <div className="form-grid">
                <div>
                  <div className="tiny muted-2 mb-12">DATA DIRECTORY</div>
                  <div className="flex items-center gap-8">
                    <code className="truncate">{host?.dataDir}</code>
                    <CopyButton value={host?.dataDir || ''} label="" />
                  </div>
                </div>
                <div>
                  <div className="tiny muted-2 mb-12">ISO LIBRARY</div>
                  <div className="flex items-center gap-8">
                    <code className="truncate">{host?.isoDir}</code>
                    <CopyButton value={host?.isoDir || ''} label="" />
                  </div>
                </div>
                <div>
                  <div className="tiny muted-2 mb-12">QEMU BINARY</div>
                  <div className="flex items-center gap-8">
                    <code className="truncate">{host?.qemuPath}</code>
                    <CopyButton value={host?.qemuPath || ''} label="" />
                  </div>
                </div>
                <div>
                  <div className="tiny muted-2 mb-12">STORAGE POOL</div>
                  <div className="flex items-center gap-8">
                    <code className="truncate">{host?.storageDir}</code>
                    <CopyButton value={host?.storageDir || ''} label="" />
                  </div>
                </div>
              </div>
              <div className="divider" />
              <div className="callout-grid">
                <div className="callout">
                  <span className="callout-icon">
                    <MemoryStick size={15} />
                  </span>
                  <div>
                    <h4>Guest memory reserved</h4>
                    <p>{formatBytes(host?.allocatedMem || 0)} across running machines.</p>
                  </div>
                </div>
                <div className="callout">
                  <span className="callout-icon">
                    <HardDrive size={15} />
                  </span>
                  <div>
                    <h4>ISO library</h4>
                    <p>{host?.isoCount || 0} image{host?.isoCount === 1 ? '' : 's'} stored on this host.</p>
                  </div>
                </div>
                <div className="callout">
                  <span className="callout-icon">
                    <ShieldCheck size={15} />
                  </span>
                  <div>
                    <h4>Data at rest</h4>
                    <p>SSH secrets encrypted with AES-256-GCM using the host key file.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'audit' && (
        <div className="card">
          <div className="card-head">
            <span className="card-title-icon">
              <Activity size={15} />
            </span>
            <h3>Audit log</h3>
            <span className="muted">{filteredEvents.length} entries</span>
            <div className="card-head-actions">
              <Segmented
                size="sm"
                value={level}
                onChange={setLevel}
                options={[
                  { value: 'all', label: 'All' },
                  { value: 'info', label: 'Info' },
                  { value: 'warn', label: 'Warnings' },
                  { value: 'error', label: 'Errors' },
                ]}
              />
            </div>
          </div>
          {filteredEvents.length === 0 ? (
            <EmptyState compact icon={<ClipboardList size={20} />} title="No matching events" description="Actions performed in emuman are recorded here." />
          ) : (
            <div className="table-wrap" style={{ border: 'none', borderRadius: 0, boxShadow: 'none' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Level</th>
                    <th>Action</th>
                    <th>Message</th>
                    <th>User</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEvents.map((evt) => (
                    <tr key={evt.id}>
                      <td className="num tiny nowrap">{formatDate(evt.ts)}</td>
                      <td>
                        <span className={`level-badge level-${evt.level || 'info'}`}>{evt.level || 'info'}</span>
                      </td>
                      <td className="mono tiny nowrap">{evt.action}</td>
                      <td>{evt.message}</td>
                      <td className="mono tiny">{evt.user || '—'}</td>
                      <td className="mono tiny muted-2">{evt.ip || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'tasks' && (
        <div className="card">
          <div className="card-head">
            <span className="card-title-icon">
              <ListChecks size={15} />
            </span>
            <h3>Task history</h3>
            <span className="muted">{tasks.length} recent</span>
          </div>
          <div className="card-body">
            {tasks.length === 0 ? (
              <EmptyState compact icon={<ListChecks size={20} />} title="No tasks yet" description="Disk creation, cloning and snapshots are tracked here." />
            ) : (
              tasks.map((task) => (
                <details key={task.id} className="task-item">
                  <summary style={{ cursor: 'pointer', listStyle: 'none' }}>
                    <div className="task-head">
                      <StatusPill
                        status={task.status === 'success' ? 'stopped' : task.status === 'error' ? 'error' : 'starting'}
                        label={task.status}
                        pulse={false}
                      />
                      <span className="task-title">{task.title}</span>
                      <span className="muted-2 tiny nowrap">
                        {timeAgo(task.startedAt)}
                        {task.endedAt ? ` · ${((task.endedAt - task.startedAt) / 1000).toFixed(1)}s` : ''}
                      </span>
                    </div>
                  </summary>
                  <div className="task-log">
                    {(task.logs || []).map((l) => l.line).join('\n') || 'No log output.'}
                  </div>
                </details>
              ))
            )}
          </div>
        </div>
      )}

      {tab === 'logs' && (
        <div className="detail-side" style={{ gap: 12 }}>
          <div className="list-toolbar" style={{ marginBottom: 0 }}>
            <div className="flex items-center gap-8">
              <span className="badge">{logs.length} lines</span>
              <span className="muted small">emuman server runtime log</span>
            </div>
            <div className="toolbar-right">
              <label className="checkbox">
                <input type="checkbox" checked={autoLogs} onChange={(e) => setAutoLogs(e.target.checked)} />
                <span className="checkbox-box">{autoLogs && <RefreshCw size={11} />}</span>
                <span>Auto-refresh</span>
              </label>
              <button className="btn btn-sm" onClick={loadLogs} disabled={logsLoading}>
                {logsLoading ? <Spinner size={13} /> : <RefreshCw size={13} />} Refresh
              </button>
              <button
                className="btn btn-sm"
                onClick={() => {
                  const blob = new Blob([logs.map((l) => `${new Date(l.ts).toISOString()} ${l.level} ${l.scope} ${l.message}`).join('\n')], {
                    type: 'text/plain',
                  });
                  const link = document.createElement('a');
                  link.href = URL.createObjectURL(blob);
                  link.download = 'emuman-server.log';
                  link.click();
                  setTimeout(() => URL.revokeObjectURL(link.href), 1500);
                }}
              >
                <Download size={13} /> Download
              </button>
            </div>
          </div>
          <div className="log-viewer" style={{ maxHeight: '64vh' }}>
            {logs.length === 0
              ? 'No log entries captured yet.'
              : logs
                  .slice()
                  .reverse()
                  .map((entry) => `${new Date(entry.ts).toISOString()} ${entry.level.toUpperCase().padEnd(5)} ${entry.scope} · ${entry.message}`)
                  .join('\n')}
          </div>
        </div>
      )}
    </div>
  );
}
