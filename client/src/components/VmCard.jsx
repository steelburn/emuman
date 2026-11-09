import { useNavigate } from 'react-router-dom';
import {
  AppWindow,
  Cpu,
  Disc3,
  HardDrive,
  MemoryStick,
  MonitorPlay,
  MoreHorizontal,
  Pause,
  Play,
  Power,
  RotateCcw,
  Square,
  TerminalSquare,
  Trash2,
} from 'lucide-react';
import { formatBytes, formatGB, formatUptime, isoName, osGuess, pct, timeAgo } from '../lib/format.js';
import { Dropdown, StatusPill } from './ui.jsx';
import { useVmActions } from '../hooks/useVmActions.jsx';
import { useAuth } from '../context/AuthContext.jsx';

const OS_ICONS = {
  windows: AppWindow,
  ubuntu: MonitorPlay,
  debian: MonitorPlay,
  alpine: MonitorPlay,
  fedora: MonitorPlay,
  bsd: MonitorPlay,
  linux: MonitorPlay,
};

export default function VmCard({ vm, compact = false }) {
  const navigate = useNavigate();
  const actions = useVmActions();
  const { can } = useAuth();
  const canOperate = can('vm.operate');
  const canManage = can('vm.manage');
  const canSsh = can('vm.ssh');
  const running = vm.status === 'running';
  const paused = vm.status === 'paused';
  const active = running || paused || vm.status === 'starting' || vm.status === 'stopping';
  const Icon = OS_ICONS[osGuess(vm)] || MonitorPlay;

  const open = (tab) => navigate(`/vms/${vm.id}${tab ? `?tab=${tab}` : ''}`);

  return (
    <div
      className={`vm-card ${running ? 'is-running' : ''}`}
      onClick={() => open()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && open()}
    >
      <div className="vm-card-top">
        <span className={`vm-avatar ${running ? 'running' : ''}`}>
          <Icon size={19} />
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="vm-card-name">{vm.name}</div>
          <div className="vm-card-sub">
            {vm.id.slice(0, 8)} · {vm.firmware === 'efi' ? 'UEFI' : 'BIOS'}
            {vm.cdrom ? ` · ${isoName(vm.cdrom)}` : ''}
          </div>
        </div>
        <div className="vm-card-status">
          <StatusPill status={vm.status} />
        </div>
      </div>

      {!compact && (
        <div className="vm-card-meta">
          <span className="chip">
            <Cpu size={11} /> {vm.cpus} vCPU
          </span>
          <span className="chip">
            <MemoryStick size={11} /> {(vm.memoryMB / 1024).toFixed(vm.memoryMB % 1024 ? 1 : 0)} GB
          </span>
          <span className="chip">
            <HardDrive size={11} /> {formatGB(vm.diskGB)}
          </span>
          <span className="chip blue">
            <MonitorPlay size={11} /> :{vm.vncPort}
          </span>
        </div>
      )}

      {active && (
        <div className="mini-usage">
          <div className="mini-usage-row">
            <span className="lbl">CPU</span>
            <span className="bar">
              <span style={{ width: `${Math.min(100, (vm.cpuPct || 0) / Math.max(1, vm.cpus))}%` }} />
            </span>
            <span className="val">{pct(Math.min(100, (vm.cpuPct || 0) / Math.max(1, vm.cpus)))}</span>
          </div>
          <div className="mini-usage-row">
            <span className="lbl">RAM</span>
            <span className="bar blue">
              <span
                style={{
                  width: `${Math.min(100, ((vm.memBytes || 0) / (vm.memoryMB * 1024 * 1024)) * 100)}%`,
                }}
              />
            </span>
            <span className="val">{formatBytes(vm.memBytes || 0)}</span>
          </div>
        </div>
      )}

      {vm.lastError && (
        <div className="small" style={{ color: 'var(--danger)', lineHeight: 1.4 }}>
          {vm.lastError}
        </div>
      )}

      <div className="vm-card-foot" onClick={(e) => e.stopPropagation()}>
        <button className="btn btn-sm" onClick={() => open('console')} disabled={!active}>
          <MonitorPlay size={13} /> Console
        </button>
        {canSsh && (
          <button className="btn btn-sm" onClick={() => open('ssh')}>
            <TerminalSquare size={13} /> SSH
          </button>
        )}
        <span className="spacer" />
        {canOperate &&
          (!active ? (
            <button className="btn btn-sm btn-primary" onClick={() => actions.start(vm)}>
              <Play size={13} /> Start
            </button>
          ) : (
            <button
              className="btn btn-sm"
              onClick={() => (paused ? actions.resume(vm) : actions.shutdown(vm))}
              title={paused ? 'Resume' : 'Graceful shutdown'}
            >
              {paused ? <Play size={13} /> : <Power size={13} />}
              {paused ? 'Resume' : 'Shutdown'}
            </button>
          ))}
        <Dropdown
          trigger={
            <button className="icon-btn" aria-label="More actions">
              <MoreHorizontal size={16} />
            </button>
          }
          items={[
            ...(canOperate
              ? [
                  {
                    label: running ? 'Pause' : 'Resume',
                    icon: running ? <Pause size={14} /> : <Play size={14} />,
                    disabled: !active,
                    onClick: () => (running ? actions.pause(vm) : actions.resume(vm)),
                  },
                  {
                    label: 'Reboot',
                    icon: <RotateCcw size={14} />,
                    disabled: !active,
                    onClick: () => actions.reboot(vm),
                  },
                  {
                    label: 'Force stop',
                    icon: <Square size={14} />,
                    disabled: !active,
                    onClick: () => actions.stop(vm),
                  },
                  { divider: true },
                ]
              : []),
            {
              label: 'Serial console',
              icon: <TerminalSquare size={14} />,
              disabled: !active,
              onClick: () => open('serial'),
            },
            ...(canManage
              ? [
                  {
                    label: 'Disks',
                    icon: <Disc3 size={14} />,
                    onClick: () => open('disks'),
                  },
                  { divider: true },
                  {
                    label: 'Delete',
                    icon: <Trash2 size={14} />,
                    danger: true,
                    onClick: () => actions.remove(vm),
                  },
                ]
              : []),
          ]}
        />
      </div>
      {vm.startedAt && (
        <div className="tiny muted-2" style={{ marginTop: -2 }}>
          Up {formatUptime((Date.now() - vm.startedAt) / 1000)} · created {timeAgo(vm.createdAt)}
        </div>
      )}
    </div>
  );
}
