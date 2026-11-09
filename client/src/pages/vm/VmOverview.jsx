import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Camera,
  Clock,
  Cpu,
  Disc3,
  HardDrive,
  Info,
  MemoryStick,
  MonitorPlay,
  Network,
  RefreshCw,
  TerminalSquare,
} from 'lucide-react';
import { api } from '../../lib/api.js';
import { formatBytes, formatDate, formatGB, formatUptime, isoName, pct, timeAgo } from '../../lib/format.js';
import { CopyButton, DataRow, Meter, Sparkline } from '../../components/ui.jsx';

export default function VmOverview({ vm, detail, running, vmEvents, refresh, setTab }) {
  const [stats, setStats] = useState(null);
  const [shot, setShot] = useState(null);
  const [shotError, setShotError] = useState(null);
  const [shotLoading, setShotLoading] = useState(false);
  const shotUrlRef = useRef(null);

  const loadStats = useCallback(async () => {
    try {
      const data = await api.get(`/api/vms/${vm.id}/stats`);
      setStats(data);
    } catch {
      /* ignore */
    }
  }, [vm.id]);

  useEffect(() => {
    if (!running) return;
    loadStats();
    const timer = setInterval(() => {
      if (!document.hidden) loadStats();
    }, 3000);
    return () => clearInterval(timer);
  }, [running, loadStats]);

  const grabScreenshot = useCallback(async () => {
    if (!running) return;
    setShotLoading(true);
    try {
      const response = await fetch(`/api/vms/${vm.id}/screenshot?t=${Date.now()}`, {
        credentials: 'same-origin',
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Screenshot unavailable');
      }
      const blob = await response.blob();
      if (!blob.size) throw new Error('Empty screenshot');
      const url = URL.createObjectURL(blob);
      if (shotUrlRef.current) URL.revokeObjectURL(shotUrlRef.current);
      shotUrlRef.current = url;
      setShot(url);
      setShotError(null);
    } catch (err) {
      setShotError(err.message);
    } finally {
      setShotLoading(false);
    }
  }, [vm.id, running]);

  useEffect(() => {
    if (!running) {
      setShot(null);
      setShotError(null);
      return;
    }
    grabScreenshot();
    const timer = setInterval(() => {
      if (!document.hidden) grabScreenshot();
    }, 12000);
    return () => clearInterval(timer);
  }, [running, grabScreenshot]);

  useEffect(
    () => () => {
      if (shotUrlRef.current) URL.revokeObjectURL(shotUrlRef.current);
    },
    [],
  );

  const history = stats?.history || [];
  const cpuPct = Math.min(100, (stats?.cpuPct ?? vm.cpuPct ?? 0) / Math.max(1, vm.cpus));
  const memUsed = stats?.memBytes ?? vm.memBytes ?? 0;
  const memAlloc = vm.memoryMB * 1024 * 1024;
  const disks = detail?.disks || [];

  const access = useMemo(
    () => ({
      vnc: vm.vncPort,
      ssh: vm.net?.sshPort || vm.sshPort,
      sshUser: vm.ssh?.user || vm.sshUser || 'root',
      mac: vm.net?.mac || vm.mac,
    }),
    [vm],
  );

  return (
    <div className="split">
      <div className="detail-side" style={{ gap: 16 }}>
        <div className="grid grid-2">
          <div className="card card-pad">
            <div className="flex items-center justify-between mb-12">
              <div className="flex items-center gap-8">
                <span className="stat-icon">
                  <Cpu size={14} />
                </span>
                <div>
                  <div className="small text-soft" style={{ fontWeight: 600 }}>
                    CPU usage
                  </div>
                  <div className="tiny muted-2">
                    {vm.cpus} vCPU · QEMU {(vm.pid || detail?.runtime?.pid) ? `pid ${vm.pid || detail.runtime.pid}` : ''}
                  </div>
                </div>
              </div>
              <div className="stat-value" style={{ marginTop: 0, fontSize: 22 }}>
                {running ? pct(cpuPct) : '—'}
              </div>
            </div>
            <Sparkline data={history.map((p) => p.cpu / Math.max(1, vm.cpus))} max={100} height={52} />
            <div className="stat-foot">
              <span>raw {(stats?.cpuPct ?? 0).toFixed(1)}% across vCPUs</span>
            </div>
          </div>

          <div className="card card-pad">
            <div className="flex items-center justify-between mb-12">
              <div className="flex items-center gap-8">
                <span className="stat-icon">
                  <MemoryStick size={14} />
                </span>
                <div>
                  <div className="small text-soft" style={{ fontWeight: 600 }}>
                    Memory (RSS)
                  </div>
                  <div className="tiny muted-2">allocated {formatBytes(memAlloc)}</div>
                </div>
              </div>
              <div className="stat-value" style={{ marginTop: 0, fontSize: 22 }}>
                {running ? formatBytes(memUsed) : '—'}
              </div>
            </div>
            <Sparkline
              data={history.map((p) => (p.mem / memAlloc) * 100)}
              max={100}
              height={52}
              stroke="var(--accent-2)"
            />
            <div className="stat-foot">
              <span>{running ? pct(Math.min(100, (memUsed / memAlloc) * 100)) : '0%'} of guest allowance</span>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <span className="card-title-icon">
              <MonitorPlay size={15} />
            </span>
            <h3>Display preview</h3>
            <div className="card-head-actions">
              <button className="btn btn-sm btn-ghost" onClick={grabScreenshot} disabled={!running || shotLoading}>
                <RefreshCw size={13} /> Refresh
              </button>
              <button className="btn btn-sm" onClick={() => setTab('console')} disabled={!running}>
                Open console
              </button>
            </div>
          </div>
          <div
            style={{
              background: '#04070d',
              minHeight: 190,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
              borderBottomLeftRadius: 12,
              borderBottomRightRadius: 12,
            }}
          >
            {running && shot ? (
              <img
                src={shot}
                alt={`${vm.name} display`}
                onClick={() => setTab('console')}
                style={{ width: '100%', display: 'block', cursor: 'pointer', imageRendering: 'auto', maxHeight: 340, objectFit: 'contain' }}
              />
            ) : (
              <div className="muted small" style={{ padding: 36, textAlign: 'center' }}>
                {running
                  ? shotError || 'Requesting framebuffer from QEMU…'
                  : 'The virtual display appears here while the machine is running.'}
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <span className="card-title-icon">
              <Info size={15} />
            </span>
            <h3>Configuration</h3>
            <div className="card-head-actions">
              <button className="btn btn-sm btn-ghost" onClick={() => setTab('settings')}>
                Edit
              </button>
            </div>
          </div>
          <div className="card-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: '0 28px' }}>
            <DataRow label="Machine type">{vm.machine || 'q35'}</DataRow>
            <DataRow label="Firmware">{vm.firmware === 'efi' ? 'UEFI (OVMF)' : 'SeaBIOS'}</DataRow>
            <DataRow label="Video">{vm.video || 'std'}</DataRow>
            <DataRow label="Boot order">{vm.bootFrom === 'cdrom' ? 'CD-ROM first' : 'Disk first'}</DataRow>
            <DataRow label="vCPU" mono>
              {vm.cpus}
            </DataRow>
            <DataRow label="Memory" mono>
              {formatGB(vm.memoryMB / 1024)}
            </DataRow>
            <DataRow label="ISO">
              {vm.cdrom ? isoName(vm.cdrom) : <span className="muted-2">none</span>}
            </DataRow>
            <DataRow label="Autostart">{vm.autostart ? 'enabled' : 'disabled'}</DataRow>
            <DataRow label="MAC address" mono>
              {access.mac}
            </DataRow>
            <DataRow label="Disk bus" mono>
              {vm.disks?.[0]?.bus || 'virtio'}
            </DataRow>
            <DataRow label="Created">{formatDate(vm.createdAt)}</DataRow>
            <DataRow label="UUID" mono>
              <span className="tiny">{vm.id}</span>
            </DataRow>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <span className="card-title-icon">
              <HardDrive size={15} />
            </span>
            <h3>Disks</h3>
            <div className="card-head-actions">
              <span className="muted small">{disks.length} attached</span>
              <button className="btn btn-sm btn-ghost" onClick={() => setTab('disks')}>
                Manage
              </button>
            </div>
          </div>
          {disks.length === 0 ? (
            <div className="card-body muted small">No disks attached to this machine.</div>
          ) : (
            disks.map((disk) => (
              <div className="disk-row" key={disk.id}>
                <span className="disk-icon">
                  <Disc3 size={16} />
                </span>
                <div className="disk-main">
                  <div className="disk-title">
                    {disk.file}
                    <span className="badge">{disk.bus}</span>
                    {disk.format && <span className="badge">{disk.format}</span>}
                  </div>
                  <div className="disk-sub">
                    {formatBytes(disk.actualSize || 0)} used of {formatBytes(disk.virtualSize || 0)}
                    {disk.snapshots ? ` · ${disk.snapshots} snapshot(s)` : ''}
                  </div>
                  <div className="mt-8">
                    <Meter
                      value={disk.actualSize || 0}
                      max={disk.virtualSize || 1}
                      thin
                      tone="blue"
                    />
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="detail-side">
        <div className="card">
          <div className="card-head">
            <span className="card-title-icon">
              <Network size={15} />
            </span>
            <h3>Console access</h3>
          </div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <div className="tiny muted-2" style={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                VNC display
              </div>
              <div className="flex items-center justify-between mt-8">
                <span className="mono small">127.0.0.1:{access.vnc}</span>
                <CopyButton value={`127.0.0.1:${access.vnc}`} label="" />
              </div>
              <button className="btn btn-sm btn-block mt-8" onClick={() => setTab('console')} disabled={!running}>
                <MonitorPlay size={13} /> Open VNC console
              </button>
            </div>
            <div className="divider" style={{ margin: 0 }} />
            <div>
              <div className="tiny muted-2" style={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Guest SSH forward
              </div>
              <div className="flex items-center justify-between mt-8">
                <span className="mono small">
                  {access.sshUser}@127.0.0.1:{access.ssh || '—'}
                </span>
                {access.ssh && <CopyButton value={`ssh -p ${access.ssh} ${access.sshUser}@127.0.0.1`} label="" />}
              </div>
              <button className="btn btn-sm btn-block mt-8" onClick={() => setTab('ssh')}>
                <TerminalSquare size={13} /> Open SSH session
              </button>
            </div>
            <div className="divider" style={{ margin: 0 }} />
            <div>
              <div className="tiny muted-2" style={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Serial console
              </div>
              <button className="btn btn-sm btn-block mt-8" onClick={() => setTab('serial')}>
                <TerminalSquare size={13} /> Open ttyS0
              </button>
            </div>
            {detail?.portsInUse?.vnc && !running && (
              <div className="alert alert-warn" style={{ fontSize: 11 }}>
                VNC port {access.vnc} is currently used by another process.
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <span className="card-title-icon">
              <Clock size={15} />
            </span>
            <h3>Runtime</h3>
          </div>
          <div className="card-body">
            <DataRow label="Status">{vm.status}</DataRow>
            <DataRow label="QEMU PID" mono>
              {vm.pid || detail?.runtime?.pid || '—'}
            </DataRow>
            <DataRow label="Uptime" mono>
              {running && vm.startedAt ? formatUptime((Date.now() - vm.startedAt) / 1000) : '—'}
            </DataRow>
            <DataRow label="Started">{vm.startedAt ? formatDate(vm.startedAt) : '—'}</DataRow>
            <DataRow label="Last event">
              {vmEvents[0] ? timeAgo(vmEvents[0].ts) : '—'}
            </DataRow>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <span className="card-title-icon">
              <Activity size={15} />
            </span>
            <h3>Machine activity</h3>
          </div>
          <div className="card-body" style={{ paddingTop: 4, paddingBottom: 4 }}>
            {vmEvents.length === 0 && <div className="muted small" style={{ padding: '12px 0' }}>No events for this machine yet.</div>}
            <div className="event-feed">
              {vmEvents.map((evt) => (
                <div className="event-item" key={evt.id}>
                  <span className={`event-dot ${evt.level || ''}`} />
                  <div className="event-main">
                    <div className="event-msg">{evt.message}</div>
                    <div className="event-meta">
                      <span>{timeAgo(evt.ts)}</span>
                      {evt.user && <span>{evt.user}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="console-hint">
          <Camera size={14} />
          <span>
            Display previews are captured through QMP <code>screendump</code> and refresh every 12
            seconds while the machine runs.
          </span>
        </div>
      </div>
    </div>
  );
}
