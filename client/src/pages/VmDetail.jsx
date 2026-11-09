import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Camera,
  ClipboardList,
  Disc3,
  HardDrive,
  Info,
  MonitorPlay,
  MoreHorizontal,
  Pause,
  Play,
  Power,
  RotateCcw,
  Settings,
  Square,
  TerminalSquare,
  Trash2,
  Wrench,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { formatBytes, formatUptime, isoName, pct } from '../lib/format.js';
import { useData } from '../context/DataContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import {
  CopyButton,
  Dropdown,
  EmptyState,
  Spinner,
  StatusPill,
} from '../components/ui.jsx';
import { useVmActions } from '../hooks/useVmActions.jsx';
import VmOverview from './vm/VmOverview.jsx';
import VmConsoleTab from './vm/VmConsoleTab.jsx';
import VmSshTab from './vm/VmSshTab.jsx';
import VmSerialTab from './vm/VmSerialTab.jsx';
import VmSnapshots from './vm/VmSnapshots.jsx';
import VmDisks from './vm/VmDisks.jsx';
import VmLogs from './vm/VmLogs.jsx';
import VmSettings from './vm/VmSettings.jsx';

const TABS = [
  { id: 'overview', label: 'Overview', icon: Info },
  { id: 'console', label: 'Console', icon: MonitorPlay, permission: 'vm.console.view' },
  { id: 'ssh', label: 'SSH', icon: TerminalSquare, permission: 'vm.ssh' },
  { id: 'serial', label: 'Serial', icon: ClipboardList, permission: 'vm.console.view' },
  { id: 'snapshots', label: 'Snapshots', icon: Camera, permission: 'vm.operate' },
  { id: 'disks', label: 'Disks & ISO', icon: Disc3, permission: 'vm.manage' },
  { id: 'logs', label: 'Logs', icon: Wrench },
  { id: 'settings', label: 'Settings', icon: Settings, permission: 'vm.manage' },
];

export default function VmDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const toast = useToast();
  const { vms, events, refreshVms } = useData();
  const { can } = useAuth();
  const actions = useVmActions();
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const summary = useMemo(() => vms.find((vm) => vm.id === id), [vms, id]);
  const visibleTabs = useMemo(() => TABS.filter((t) => !t.permission || can(t.permission)), [can]);
  const requestedTab = searchParams.get('tab');
  const tab = visibleTabs.some((t) => t.id === requestedTab) ? requestedTab : 'overview';

  const load = useCallback(
    async ({ silent = false } = {}) => {
      try {
        const data = await api.get(`/api/vms/${id}`);
        setDetail(data);
        setLoadError(null);
      } catch (err) {
        if (!silent) setLoadError(err);
      } finally {
        setLoading(false);
      }
    },
    [id],
  );

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) load({ silent: true });
    }, 6000);
    return () => clearInterval(timer);
  }, [load]);

  const vm = detail?.vm
    ? {
        ...detail.vm,
        status: summary?.status || detail.vm.status,
        cpuPct: summary?.cpuPct ?? detail.runtime?.cpuPct ?? 0,
        memBytes: summary?.memBytes ?? detail.runtime?.memBytes ?? 0,
        pid: summary?.pid ?? detail.runtime?.pid ?? null,
        startedAt: summary?.startedAt ?? detail.runtime?.startedAt ?? null,
        lastError: summary?.lastError ?? detail.runtime?.lastError ?? null,
      }
    : summary;

  const running = vm && ['running', 'paused'].includes(vm.status);
  const busy = vm && ['starting', 'stopping'].includes(vm.status);
  const canOperate = can('vm.operate');
  const canManage = can('vm.manage');

  const setTab = (next) => {
    if (next === 'overview') setSearchParams({});
    else setSearchParams({ tab: next });
  };

  const refresh = useCallback(
    async (silent = true) => {
      await load({ silent });
      refreshVms();
    },
    [load, refreshVms],
  );

  const vmEvents = useMemo(
    () => events.filter((e) => e.vmId === id).slice(0, 8),
    [events, id],
  );

  if (loading && !vm) {
    return (
      <div className="page">
        <div className="splash" style={{ minHeight: '50vh' }}>
          <Spinner size={22} />
          <span>Loading machine…</span>
        </div>
      </div>
    );
  }

  if (!vm) {
    return (
      <div className="page">
        <EmptyState
          icon={<HardDrive size={24} />}
          title="Virtual machine not found"
          description={loadError?.message || 'It may have been deleted from this host.'}
          action={
            <Link className="btn btn-primary" to="/vms">
              <ArrowLeft size={14} /> Back to machines
            </Link>
          }
        />
      </div>
    );
  }

  const start = async () => {
    const ok = await actions.start(vm);
    if (ok) setTimeout(() => refresh(), 700);
  };
  const stop = async () => {
    const ok = await actions.stop(vm);
    if (ok) setTimeout(() => refresh(), 500);
  };
  const shutdown = async () => {
    const ok = await actions.shutdown(vm);
    if (ok) setTimeout(() => refresh(), 1200);
  };
  const reboot = async () => {
    const ok = await actions.reboot(vm);
    if (ok) setTimeout(() => refresh(), 1500);
  };

  return (
    <div className="page">
      <div className="vm-hero">
        <span className={`vm-avatar ${running ? 'running' : ''}`}>
          <MonitorPlay size={24} />
        </span>
        <div className="vm-hero-main">
          <div className="vm-hero-title-row">
            <h1>{vm.name}</h1>
            <StatusPill status={vm.status} />
            {vm.autostart && <span className="badge">autostart</span>}
            {vm.firmware === 'efi' && <span className="badge blue">UEFI</span>}
          </div>
          <div className="vm-hero-desc">{vm.description || 'No description for this machine.'}</div>
          <div className="vm-hero-meta">
            <span className="mono">{vm.id}</span>
            <span>·</span>
            <span>{vm.cpus} vCPU</span>
            <span>{formatBytes(vm.memoryMB * 1024 * 1024)} RAM</span>
            <span>{vm.disks?.length ?? vm.disks ?? 0} disk(s)</span>
            {running && vm.startedAt ? (
              <span className="mono" style={{ color: 'var(--accent)' }}>
                up {formatUptime((Date.now() - vm.startedAt) / 1000)}
              </span>
            ) : (
              <span className="mono muted-2">offline</span>
            )}
          </div>
        </div>
        <div className="vm-hero-actions">
          {vm.status === 'running' ? (
            <button className="btn btn-primary" onClick={() => setTab('console')}>
              <MonitorPlay size={15} /> Open console
            </button>
          ) : vm.status === 'paused' && canOperate ? (
            <button className="btn btn-primary" onClick={() => actions.resume(vm)}>
              <Play size={15} /> Resume
            </button>
          ) : canOperate ? (
            <button className="btn btn-primary" onClick={start} disabled={busy}>
              <Play size={15} /> Start
            </button>
          ) : null}
          {running && canOperate && (
            <button className="btn" onClick={shutdown} disabled={busy}>
              <Power size={15} /> Shutdown
            </button>
          )}
          {!canOperate && <span className="badge">read-only</span>}
          <Dropdown
            trigger={
              <button className="btn btn-icon" aria-label="More actions">
                <MoreHorizontal size={16} />
              </button>
            }
            items={[
              ...(canOperate
                ? [
                    vm.status === 'running'
                      ? { label: 'Pause', icon: <Pause size={14} />, onClick: () => actions.pause(vm) }
                      : {
                          label: 'Resume',
                          icon: <Play size={14} />,
                          disabled: vm.status !== 'paused',
                          onClick: () => actions.resume(vm),
                        },
                    { label: 'Reboot', icon: <RotateCcw size={14} />, disabled: !running, onClick: reboot },
                    {
                      label: 'Force stop',
                      icon: <Square size={14} />,
                      disabled: !running && !busy,
                      onClick: stop,
                    },
                    { divider: true },
                  ]
                : []),
              {
                label: 'Serial console',
                icon: <TerminalSquare size={14} />,
                onClick: () => setTab('serial'),
              },
              ...(canOperate
                ? [
                    {
                      label: 'Snapshots',
                      icon: <Camera size={14} />,
                      onClick: () => setTab('snapshots'),
                    },
                  ]
                : []),
              ...(canManage
                ? [
                    { divider: true },
                    {
                      label: 'Delete machine',
                      icon: <Trash2 size={14} />,
                      danger: true,
                      onClick: async () => {
                        const deleted = await actions.remove(vm);
                        if (deleted) navigate('/vms');
                      },
                    },
                  ]
                : []),
            ]}
          />
        </div>
      </div>

      <div className="tabs" role="tablist">
        {visibleTabs.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={`tab ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              <Icon size={14} /> {t.label}
              {t.id === 'console' && running && <span className="tab-dot" />}
            </button>
          );
        })}
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {detail?.serial && <span className="badge accent">serial ready</span>}
          <CopyButton value={vm.id} label="ID" />
        </span>
      </div>

      {tab === 'overview' && (
        <VmOverview vm={vm} detail={detail} running={running} vmEvents={vmEvents} refresh={refresh} setTab={setTab} />
      )}
      {tab === 'console' && (
        <VmConsoleTab
          vm={vm}
          running={running}
          onStart={canOperate ? start : null}
          setTab={setTab}
          viewOnly={!can('vm.console.input')}
        />
      )}
      {tab === 'ssh' && <VmSshTab vm={vm} detail={detail} />}
      {tab === 'serial' && <VmSerialTab vm={vm} running={running} />}
      {tab === 'snapshots' && <VmSnapshots vm={vm} onChanged={() => refresh()} />}
      {tab === 'disks' && <VmDisks vm={vm} detail={detail} running={running} onChanged={() => refresh()} />}
      {tab === 'logs' && <VmLogs vm={vm} />}
      {tab === 'settings' && (
        <VmSettings
          vm={vm}
          detail={detail}
          running={running}
          onChanged={() => refresh()}
          onDeleted={() => navigate('/vms')}
          toast={toast}
        />
      )}
    </div>
  );
}
