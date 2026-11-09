import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  LayoutGrid,
  List,
  MoreHorizontal,
  MonitorPlay,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Search,
  Server,
  Square,
  TerminalSquare,
  Trash2,
} from 'lucide-react';
import { useData } from '../context/DataContext.jsx';
import { useUi } from '../context/UiContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { formatBytes, formatGB, formatUptime, pct, timeAgo } from '../lib/format.js';
import {
  Dropdown,
  EmptyState,
  Segmented,
  Select,
  StatusPill,
  useDebounced,
} from '../components/ui.jsx';
import VmCard from '../components/VmCard.jsx';
import { useVmActions } from '../hooks/useVmActions.jsx';

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'running', label: 'Running' },
  { value: 'paused', label: 'Paused' },
  { value: 'stopped', label: 'Stopped' },
];

export default function VmList() {
  const { vms, loading } = useData();
  const { openCreateVm } = useUi();
  const { can } = useAuth();
  const navigate = useNavigate();
  const actions = useVmActions();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('name');
  const [view, setView] = useState(() => localStorage.getItem('emuman.view') || 'cards');
  const debounced = useDebounced(search, 160);

  const counts = useMemo(
    () => ({
      all: vms.length,
      running: vms.filter((v) => v.status === 'running').length,
      paused: vms.filter((v) => v.status === 'paused').length,
      stopped: vms.filter((v) => v.status === 'stopped' || v.status === 'error').length,
    }),
    [vms],
  );

  const filtered = useMemo(() => {
    const term = debounced.trim().toLowerCase();
    let list = vms.filter((vm) => {
      if (filter !== 'all') {
        if (filter === 'stopped') {
          if (!['stopped', 'error', 'stopping'].includes(vm.status)) return false;
        } else if (vm.status !== filter) return false;
      }
      if (!term) return true;
      return (
        vm.name.toLowerCase().includes(term) ||
        (vm.description || '').toLowerCase().includes(term) ||
        vm.id.toLowerCase().includes(term) ||
        (vm.cdrom || '').toLowerCase().includes(term)
      );
    });
    list = [...list].sort((a, b) => {
      if (sort === 'created') return b.createdAt - a.createdAt;
      if (sort === 'status') return a.status.localeCompare(b.status) || a.name.localeCompare(b.name);
      if (sort === 'cpu') return (b.cpuPct || 0) - (a.cpuPct || 0);
      return a.name.localeCompare(b.name);
    });
    return list;
  }, [vms, filter, debounced, sort]);

  const changeView = (next) => {
    setView(next);
    localStorage.setItem('emuman.view', next);
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">
            Virtual machines <span className="badge">{vms.length}</span>
          </h1>
          <p className="page-sub">
            {counts.running} running · {counts.paused} paused · {counts.stopped} stopped
          </p>
        </div>
        <div className="page-actions">
          {can('vm.manage') && (
            <button className="btn btn-primary" onClick={openCreateVm}>
              <Plus size={15} /> New virtual machine
            </button>
          )}
        </div>
      </div>

      <div className="list-toolbar">
        <div className="search-wrap">
          <Search size={15} />
          <input
            className="input"
            placeholder="Search machines, IDs, ISOs…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Segmented value={filter} onChange={setFilter} options={FILTERS.map((f) => ({ ...f, label: `${f.label} ${counts[f.value] ?? ''}` }))} />
        <div className="toolbar-right">
          <Select
            value={sort}
            onChange={setSort}
            options={[
              { value: 'name', label: 'Sort: name' },
              { value: 'created', label: 'Sort: newest' },
              { value: 'status', label: 'Sort: status' },
              { value: 'cpu', label: 'Sort: CPU' },
            ]}
          />
          <Segmented
            size="sm"
            value={view}
            onChange={changeView}
            options={[
              { value: 'cards', label: '', icon: <LayoutGrid size={13} /> },
              { value: 'table', label: '', icon: <List size={13} /> },
            ]}
          />
        </div>
      </div>

      {loading && vms.length === 0 ? (
        <div className="table-empty">Loading machines…</div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Server size={24} />}
          title={vms.length ? 'No machines match this filter' : 'No virtual machines yet'}
          description={
            vms.length
              ? 'Try a different search term or switch the status filter.'
              : 'Create a KVM guest and attach an ISO to begin installing an operating system.'
          }
          action={
            vms.length ? (
              <button className="btn" onClick={() => { setSearch(''); setFilter('all'); }}>
                Clear filters
              </button>
            ) : can('vm.manage') ? (
              <button className="btn btn-primary" onClick={openCreateVm}>
                <Plus size={15} /> Create machine
              </button>
            ) : null
          }
        />
      ) : view === 'cards' ? (
        <div className="vm-grid">
          {filtered.map((vm) => (
            <VmCard key={vm.id} vm={vm} />
          ))}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Machine</th>
                <th>Status</th>
                <th>vCPU</th>
                <th>Memory</th>
                <th>Disks</th>
                <th>Console</th>
                <th>Activity</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((vm) => {
                const active = ['running', 'paused'].includes(vm.status);
                return (
                  <tr key={vm.id} className="clickable" onClick={() => navigate(`/vms/${vm.id}`)}>
                    <td>
                      <div className="cell-main">
                        <span className={`vm-avatar ${vm.status === 'running' ? 'running' : ''}`} style={{ width: 30, height: 30, borderRadius: 8 }}>
                          <Server size={14} />
                        </span>
                        <div style={{ minWidth: 0 }}>
                          <div className="cell-name">{vm.name}</div>
                          <div className="cell-sub">
                            {vm.id.slice(0, 8)} · {vm.firmware === 'efi' ? 'UEFI' : 'BIOS'}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <StatusPill status={vm.status} />
                    </td>
                    <td className="num">{vm.cpus}</td>
                    <td className="num">
                      {formatGB(vm.memoryMB / 1024)}
                      {active && <div className="tiny muted-2">{pct((vm.cpuPct || 0) / Math.max(1, vm.cpus))} CPU</div>}
                    </td>
                    <td className="num">
                      {vm.disks} × {formatGB(vm.diskGB)}
                    </td>
                    <td>
                      <div className="tiny mono">
                        <span className="muted-2">VNC</span> :{vm.vncPort}
                      </div>
                      <div className="tiny mono">
                        <span className="muted-2">SSH</span> :{vm.sshPort || '—'}
                      </div>
                    </td>
                    <td className="num tiny">
                      {vm.startedAt ? formatUptime((Date.now() - vm.startedAt) / 1000) : timeAgo(vm.createdAt)}
                      <div className="tiny muted-2">{vm.startedAt ? 'up' : 'created'}</div>
                    </td>
                    <td className="actions-cell" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-4" style={{ justifyContent: 'flex-end' }}>
                        <button
                          className="icon-btn"
                          title="Console"
                          disabled={!active}
                          onClick={() => navigate(`/vms/${vm.id}?tab=console`)}
                        >
                          <MonitorPlay size={15} />
                        </button>
                        <button
                          className="icon-btn"
                          title="SSH"
                          onClick={() => navigate(`/vms/${vm.id}?tab=ssh`)}
                        >
                          <TerminalSquare size={15} />
                        </button>
                        <Dropdown
                          trigger={
                            <button className="icon-btn" aria-label="Actions">
                              <MoreHorizontal size={15} />
                            </button>
                          }
                          items={[
                            {
                              label: vm.status === 'running' ? 'Pause' : 'Start',
                              icon: vm.status === 'running' ? <Pause size={14} /> : <Play size={14} />,
                              onClick: () =>
                                vm.status === 'running'
                                  ? actions.pause(vm)
                                  : vm.status === 'paused'
                                    ? actions.resume(vm)
                                    : actions.start(vm),
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
                            {
                              label: 'Delete',
                              icon: <Trash2 size={14} />,
                              danger: true,
                              onClick: () => actions.remove(vm),
                            },
                          ]}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {vms.length > 0 && (
        <div className="muted-2 tiny mt-16" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <span>{filtered.length} shown</span>
          <span>·</span>
          <span>{counts.running} running</span>
          <span>·</span>
          <span>{formatBytes(vms.reduce((s, vm) => s + vm.memoryMB * 1024 * 1024, 0), 0)} memory provisioned</span>
          <span>·</span>
          <span>{vms.reduce((s, vm) => s + vm.diskGB, 0)} GB disk provisioned</span>
        </div>
      )}
    </div>
  );
}
