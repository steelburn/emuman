import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Activity,
  ArrowRight,
  Boxes,
  Cpu,
  HardDrive,
  MemoryStick,
  MonitorPlay,
  Plus,
  RefreshCw,
  Server,
  TerminalSquare,
  Wrench,
} from 'lucide-react';
import { useData } from '../context/DataContext.jsx';
import { useUi } from '../context/UiContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { formatBytes, formatUptime, pct, timeAgo } from '../lib/format.js';
import { EmptyState, Meter, Sparkline, Spinner, StatusPill } from '../components/ui.jsx';
import VmCard from '../components/VmCard.jsx';

export default function Dashboard() {
  const { host, vms, events, tasks, connected, loading, refreshVms, refreshHost } = useData();
  const { openCreateVm } = useUi();
  const { can } = useAuth();
  const canManage = can('vm.manage');
  const navigate = useNavigate();
  const [cpuHist, setCpuHist] = useState([]);
  const [memHist, setMemHist] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const lastSample = useRef(null);

  useEffect(() => {
    if (!host?.sampleAt || host.sampleAt === lastSample.current) return;
    lastSample.current = host.sampleAt;
    setCpuHist((list) => [...list, Number(host.cpuPct) || 0].slice(-40));
    setMemHist((list) =>
      [...list, host.memTotal ? ((host.memUsed || 0) / host.memTotal) * 100 : 0].slice(-40),
    );
  }, [host?.sampleAt, host?.cpuPct, host?.memUsed, host?.memTotal]);

  const running = vms.filter((vm) => vm.status === 'running');
  const paused = vms.filter((vm) => vm.status === 'paused');
  const active = [...running, ...paused];
  const allocatedVcpus = active.reduce((sum, vm) => sum + vm.cpus, 0);
  const allocatedMem = active.reduce((sum, vm) => sum + vm.memoryMB, 0) * 1024 * 1024;
  const diskAllocated = vms.reduce((sum, vm) => sum + (vm.diskGB || 0), 0);

  const doRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refreshVms(), refreshHost()]);
    setTimeout(() => setRefreshing(false), 350);
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-sub">
            {host?.hostname || 'This host'} · QEMU {host?.qemuVersion || '—'} ·{' '}
            {host?.kvm ? 'KVM acceleration' : 'software emulation'} · up{' '}
            {host?.uptime ? formatUptime(host.uptime) : '—'}
          </p>
        </div>
        <div className="page-actions">
          <button className="btn btn-ghost btn-sm" onClick={doRefresh} disabled={refreshing}>
            {refreshing ? <Spinner size={14} /> : <RefreshCw size={14} />} Refresh
          </button>
          {canManage && (
            <button className="btn btn-primary" onClick={openCreateVm}>
              <Plus size={15} /> New virtual machine
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-stats mb-16">
        <div className="stat-card">
          <div className="stat-head">
            <span>Virtual machines</span>
            <span className="stat-icon">
              <Server size={14} />
            </span>
          </div>
          <div className="stat-value">
            {loading ? '—' : running.length}
            <span className="unit">/ {vms.length} running</span>
          </div>
          <div className="stat-foot">
            <span className={running.length ? 'ok' : 'muted-2'}>
              {running.length ? '● live' : '○ idle'}
            </span>
            <span>·</span>
            <span>{paused.length} paused</span>
            <span>·</span>
            <span>{vms.length - running.length - paused.length} stopped</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-head">
            <span>Host CPU</span>
            <span className="stat-icon">
              <Cpu size={14} />
            </span>
          </div>
          <div className="stat-value">
            {pct(host?.cpuPct ?? 0)}
            <span className="unit">{host?.cpuCount || '—'} threads</span>
          </div>
          <div className="stat-spark">
            <Sparkline data={cpuHist} max={100} height={34} />
          </div>
          <div className="stat-foot">
            <span>Load {host?.load?.map((n) => n.toFixed(2)).join(' / ') || '—'}</span>
            <span>·</span>
            <span>{allocatedVcpus} vCPU allocated</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-head">
            <span>Host memory</span>
            <span className="stat-icon">
              <MemoryStick size={14} />
            </span>
          </div>
          <div className="stat-value">
            {formatBytes(host?.memUsed)}
            <span className="unit">of {formatBytes(host?.memTotal)}</span>
          </div>
          <div className="stat-spark">
            <Sparkline data={memHist} max={100} height={34} stroke="var(--accent-2)" />
          </div>
          <div className="stat-foot">
            <span>Guests reserved {formatBytes(allocatedMem)}</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-head">
            <span>Storage pool</span>
            <span className="stat-icon">
              <HardDrive size={14} />
            </span>
          </div>
          <div className="stat-value">
            {formatBytes(host?.storage?.used)}
            <span className="unit">of {formatBytes(host?.storage?.total)}</span>
          </div>
          <div className="stat-spark" style={{ marginTop: 12 }}>
            <Meter
              value={host?.storage?.used || 0}
              max={host?.storage?.total || 1}
              tone={
                (host?.storage?.used || 0) / (host?.storage?.total || 1) > 0.9
                  ? 'danger'
                  : (host?.storage?.used || 0) / (host?.storage?.total || 1) > 0.75
                    ? 'warn'
                    : 'accent'
              }
              thin
            />
          </div>
          <div className="stat-foot">
            <span>{formatBytes(host?.storage?.free)} free</span>
            <span>·</span>
            <span>{diskAllocated} GB disks provisioned</span>
          </div>
        </div>
      </div>

      {vms.length === 0 && !loading ? (
        <div className="card" style={{ padding: 8 }}>
          <EmptyState
            icon={<Boxes size={24} />}
            title="No virtual machines yet"
            description="Create a KVM guest with a disk, an ISO and a network interface. VNC, SSH and serial consoles are provisioned automatically."
            action={
              canManage ? (
                <button className="btn btn-primary" onClick={openCreateVm}>
                  <Plus size={15} /> Create your first machine
                </button>
              ) : null
            }
          />
          <div className="callout-grid" style={{ padding: '0 18px 20px' }}>
            <div className="callout">
              <span className="callout-icon">
                <MonitorPlay size={15} />
              </span>
              <div>
                <h4>Browser VNC</h4>
                <p>noVNC console proxied over an authenticated WebSocket, no plugins needed.</p>
              </div>
            </div>
            <div className="callout">
              <span className="callout-icon">
                <TerminalSquare size={15} />
              </span>
              <div>
                <h4>SSH & serial</h4>
                <p>In-browser SSH via an encrypted bridge, plus the QEMU serial chardev.</p>
              </div>
            </div>
            <div className="callout">
              <span className="callout-icon">
                <Wrench size={15} />
              </span>
              <div>
                <h4>Snapshots</h4>
                <p>Save and restore qcow2 snapshots, including live VM state via QMP.</p>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="split" style={{ '--side': '340px' }}>
          <div className="card">
            <div className="card-head">
              <span className="card-title-icon">
                <Server size={15} />
              </span>
              <h3>Virtual machines</h3>
              <span className="muted">{vms.length}</span>
              <div className="card-head-actions">
                <Link to="/vms" className="btn btn-sm btn-ghost">
                  View all <ArrowRight size={13} />
                </Link>
              </div>
            </div>
            <div className="card-body">
              <div className="vm-grid">
                {vms.slice(0, 6).map((vm) => (
                  <VmCard key={vm.id} vm={vm} />
                ))}
                {canManage && (
                  <button
                    className="vm-card"
                    onClick={openCreateVm}
                    style={{
                      alignItems: 'center',
                      justifyContent: 'center',
                      minHeight: 150,
                      borderStyle: 'dashed',
                      cursor: 'pointer',
                    }}
                  >
                    <span className="stat-icon" style={{ width: 34, height: 34 }}>
                      <Plus size={16} />
                    </span>
                    <span className="muted small">New virtual machine</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="detail-side">
            <div className="card">
              <div className="card-head">
                <span className="card-title-icon">
                  <Activity size={15} />
                </span>
                <h3>Activity</h3>
                <div className="card-head-actions">
                  <span className="badge">{connected ? 'live' : 'offline'}</span>
                </div>
              </div>
              <div className="card-body" style={{ paddingTop: 6, paddingBottom: 6 }}>
                <div className="event-feed">
                  {events.slice(0, 8).map((evt) => (
                    <div className="event-item" key={evt.id}>
                      <span className={`event-dot ${evt.level || ''}`} />
                      <div className="event-main">
                        <div className="event-msg">{evt.message}</div>
                        <div className="event-meta">
                          <span>{timeAgo(evt.ts)}</span>
                          {evt.user && <span>{evt.user}</span>}
                          {evt.vmId && (
                            <button
                              className="link-btn"
                              style={{ fontSize: 10.5 }}
                              onClick={() => navigate(`/vms/${evt.vmId}`)}
                            >
                              open
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                  {events.length === 0 && (
                    <div className="muted small" style={{ padding: '16px 0' }}>
                      No activity recorded yet.
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <span className="card-title-icon">
                  <Wrench size={15} />
                </span>
                <h3>Recent tasks</h3>
              </div>
              <div className="card-body" style={{ paddingTop: 4, paddingBottom: 4 }}>
                {tasks.slice(0, 5).map((task) => (
                  <div className="task-item" key={task.id}>
                    <div className="task-head">
                      <span
                        className={`status-pill ${
                          task.status === 'success'
                            ? 'tone-ok'
                            : task.status === 'error'
                              ? 'tone-error'
                              : 'tone-info'
                        }`}
                        style={{ fontSize: 10, padding: '1px 6px' }}
                      >
                        {task.status}
                      </span>
                      <span className="task-title">{task.title}</span>
                      <span className="muted-2 tiny nowrap">{timeAgo(task.startedAt)}</span>
                    </div>
                    {task.logs?.length > 0 && <div className="task-log">{task.logs.map((l) => l.line).join('\n')}</div>}
                  </div>
                ))}
                {tasks.length === 0 && (
                  <div className="muted small" style={{ padding: '16px 0' }}>
                    Task history will appear here.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
