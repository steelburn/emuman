import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check,
  Disc3,
  DiscAlbum,
  HardDrive,
  Info,
  Maximize2,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { api } from '../../lib/api.js';
import { formatBytes, isoName } from '../../lib/format.js';
import { useConfirm } from '../../context/ConfirmContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import {
  CopyButton,
  EmptyState,
  Field,
  Meter,
  Modal,
  Segmented,
  Select,
  Spinner,
} from '../../components/ui.jsx';

export default function VmDisks({ vm, detail, running, onChanged }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [disks, setDisks] = useState(detail?.disks || []);
  const [isos, setIsos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [resizeDisk, setResizeDisk] = useState(null);
  const [resizeSize, setResizeSize] = useState(0);
  const [newDisk, setNewDisk] = useState({ sizeGB: 20, bus: 'virtio' });
  const [isoChoice, setIsoChoice] = useState(vm.cdrom || '');
  const [bootFrom, setBootFrom] = useState(vm.bootFrom || 'disk');

  useEffect(() => {
    setDisks(detail?.disks || []);
  }, [detail?.disks]);

  const loadIsos = useCallback(async () => {
    try {
      const data = await api.get('/api/host/isos');
      setIsos(data.isos || []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    loadIsos();
  }, [loadIsos]);

  useEffect(() => {
    setIsoChoice(vm.cdrom || '');
    setBootFrom(vm.bootFrom || 'disk');
  }, [vm.cdrom, vm.bootFrom]);

  const usedTotal = useMemo(() => disks.reduce((s, d) => s + (d.actualSize || 0), 0), [disks]);
  const virtualTotal = useMemo(() => disks.reduce((s, d) => s + (d.virtualSize || 0), 0), [disks]);

  const refreshAll = async () => {
    await onChanged?.();
    await loadIsos();
  };

  const addDisk = async (e) => {
    e.preventDefault();
    setBusy('add');
    try {
      await api.post(`/api/vms/${vm.id}/disks`, {
        sizeGB: Number(newDisk.sizeGB),
        bus: newDisk.bus,
      });
      toast.success(`Added a ${newDisk.sizeGB} GB ${newDisk.bus} disk`);
      setAddOpen(false);
      await onChanged?.();
      setTimeout(onChanged, 900);
    } catch (err) {
      toast.error(err.message, { title: 'Could not add disk' });
    } finally {
      setBusy(null);
    }
  };

  const removeDisk = async (disk) => {
    const ok = await confirm({
      title: `Remove ${disk.file}?`,
      message: running
        ? 'Detach this disk from the running machine and delete the qcow2 file. Data on the disk will be lost.'
        : 'Detach this disk and delete its qcow2 file from the host. Data will be lost.',
      confirmLabel: 'Remove disk',
      danger: true,
    });
    if (!ok) return;
    if (running) {
      toast.error('Stop the machine before removing a disk');
      return;
    }
    setBusy(`remove:${disk.id}`);
    try {
      await api.del(`/api/vms/${vm.id}/disks/${disk.id}`);
      toast.success(`${disk.file} removed`);
      await refreshAll();
    } catch (err) {
      toast.error(err.message, { title: 'Remove failed' });
    } finally {
      setBusy(null);
    }
  };

  const resize = async (e) => {
    e.preventDefault();
    if (!resizeDisk) return;
    setBusy(`resize:${resizeDisk.id}`);
    try {
      await api.post(`/api/vms/${vm.id}/disks/${resizeDisk.id}/resize`, {
        sizeGB: Number(resizeSize),
      });
      toast.success(`${resizeDisk.file} resized to ${resizeSize} GB`, {
        title: 'Grow the filesystem inside the guest',
      });
      setResizeDisk(null);
      await onChanged?.();
    } catch (err) {
      toast.error(err.message, { title: 'Resize failed' });
    } finally {
      setBusy(null);
    }
  };

  const attachIso = async (value) => {
    setBusy('iso');
    try {
      await api.patch(`/api/vms/${vm.id}`, { cdrom: value || null });
      setIsoChoice(value);
      toast.success(value ? `Attached ${isoName(value)}` : 'ISO detached');
      await onChanged?.();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  };

  const saveBoot = async (value) => {
    setBusy('boot');
    try {
      await api.patch(`/api/vms/${vm.id}`, { bootFrom: value });
      setBootFrom(value);
      toast.success('Boot order updated');
      await onChanged?.();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="detail-side" style={{ gap: 16 }}>
      <div className="card">
        <div className="card-head">
          <span className="card-title-icon">
            <HardDrive size={15} />
          </span>
          <h3>Virtual disks</h3>
          <span className="muted">
            {formatBytes(usedTotal)} / {formatBytes(virtualTotal)}
          </span>
          <div className="card-head-actions">
            <button className="btn btn-sm btn-ghost" onClick={refreshAll} disabled={loading}>
              <RefreshCw size={13} /> Refresh
            </button>
            <button className="btn btn-sm btn-primary" onClick={() => setAddOpen(true)}>
              <Plus size={13} /> Add disk
            </button>
          </div>
        </div>
        {disks.length === 0 ? (
          <EmptyState
            compact
            icon={<Disc3 size={20} />}
            title="No disks attached"
            description="Add a qcow2 disk to install an operating system."
          />
        ) : (
          disks.map((disk) => (
            <div className="disk-row" key={disk.id}>
              <span className="disk-icon">
                <Disc3 size={16} />
              </span>
              <div className="disk-main">
                <div className="disk-title">
                  {disk.file}
                  <span className="badge accent">{disk.bus}</span>
                  <span className="badge">{disk.format || 'qcow2'}</span>
                  {disk.boot && <span className="badge blue">boot</span>}
                </div>
                <div className="disk-sub">
                  {formatBytes(disk.actualSize || 0)} on disk · {formatBytes(disk.virtualSize || 0)} virtual
                  {disk.snapshots ? ` · ${disk.snapshots} snapshot(s)` : ''}
                </div>
                <div className="mt-8">
                  <Meter value={disk.actualSize || 0} max={disk.virtualSize || 1} thin tone="blue" />
                </div>
                {disk.path && (
                  <div className="mt-8 flex items-center gap-6">
                    <span className="tiny muted-2 mono truncate" style={{ maxWidth: 520 }}>
                      {disk.path}
                    </span>
                    <CopyButton value={disk.path} label="" />
                  </div>
                )}
              </div>
              <div className="flex items-center gap-4" style={{ alignSelf: 'center' }}>
                <button
                  className="btn btn-sm"
                  onClick={() => {
                    setResizeDisk(disk);
                    setResizeSize(Math.max(disk.sizeGB || 1, Math.ceil((disk.virtualSize || 0) / 1024 ** 3)));
                  }}
                  title="Resize disk"
                >
                  <Maximize2 size={12} /> Resize
                </button>
                <button
                  className="icon-btn"
                  onClick={() => removeDisk(disk)}
                  disabled={Boolean(busy) || running}
                  title={running ? 'Stop the VM to remove disks' : 'Remove disk'}
                >
                  {busy === `remove:${disk.id}` ? <Spinner size={13} /> : <Trash2 size={14} />}
                </button>
              </div>
            </div>
          ))
        )}
        <div className="card-body" style={{ borderTop: '1px solid var(--border-soft)', paddingTop: 12 }}>
          <div className="console-hint" style={{ border: 'none', padding: 0, background: 'transparent' }}>
            <Info size={14} />
            <span>
              New disks are qcow2 on the host storage pool. While the machine runs, virtio disks can
              be hot-plugged; SATA changes need a power cycle.
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="card-head">
            <span className="card-title-icon">
              <DiscAlbum size={15} />
            </span>
            <h3>Installation ISO</h3>
            <div className="card-head-actions">
              <button className="btn btn-sm btn-ghost" onClick={loadIsos}>
                <RefreshCw size={12} />
              </button>
            </div>
          </div>
          <div className="card-body form-stack">
            <Field
              label="Attached medium"
              hint={running ? 'Changing media takes effect after the next boot.' : undefined}
            >
              <Select
                value={isoChoice}
                onChange={(value) => {
                  setIsoChoice(value);
                  attachIso(value);
                }}
                placeholder="No ISO attached"
                options={isos.map((iso) => ({ value: iso.path, label: `${iso.name} · ${formatBytes(iso.size)}` }))}
                disabled={busy === 'iso'}
              />
            </Field>
            <div className="flex items-center gap-8">
              <span className="small text-soft truncate" style={{ flex: 1 }}>
                {vm.cdrom ? isoName(vm.cdrom) : 'No installation media'}
              </span>
              {vm.cdrom && (
                <button className="btn btn-sm btn-ghost" onClick={() => attachIso(null)} disabled={busy === 'iso'}>
                  Detach
                </button>
              )}
            </div>
            <Field label="Boot order" hint="Use CD-ROM for the installer, then switch back to disk.">
              <Segmented
                value={bootFrom}
                onChange={saveBoot}
                options={[
                  { value: 'disk', label: 'Disk first' },
                  { value: 'cdrom', label: 'CD-ROM first' },
                ]}
              />
            </Field>
            {isos.length === 0 && (
              <div className="tiny muted-2">
                No ISOs in the library. Upload images from the Storage page.
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <span className="card-title-icon">
              <Check size={15} />
            </span>
            <h3>Storage footprint</h3>
          </div>
          <div className="card-body">
            <div className="data-row">
              <span className="data-label">Provisioned</span>
              <span className="data-value mono">{formatBytes(virtualTotal)}</span>
            </div>
            <div className="data-row">
              <span className="data-label">On disk</span>
              <span className="data-value mono">{formatBytes(usedTotal)}</span>
            </div>
            <div className="data-row">
              <span className="data-label">Disk count</span>
              <span className="data-value mono">{disks.length}</span>
            </div>
            <div className="data-row">
              <span className="data-label">Bus</span>
              <span className="data-value mono">{disks.map((d) => d.bus).join(', ') || '—'}</span>
            </div>
            <div className="mt-12">
              <Meter
                value={usedTotal}
                max={virtualTotal || 1}
                label="Thin provisioning"
                right={`${virtualTotal ? Math.round((usedTotal / virtualTotal) * 100) : 0}%`}
              />
            </div>
            <div className="console-hint mt-16">
              <Info size={14} />
              <span>
                qcow2 images grow on demand up to their virtual size. Resizing a disk does not grow
                the guest filesystem — do that inside the VM.
              </span>
            </div>
          </div>
        </div>
      </div>

      {addOpen && (
        <Modal
          title="Add virtual disk"
          subtitle={`Attach a new qcow2 volume to ${vm.name}.`}
          icon={<Plus size={17} />}
          onClose={() => setAddOpen(false)}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setAddOpen(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={addDisk} disabled={busy === 'add'}>
                {busy === 'add' ? <Spinner size={14} /> : <Plus size={14} />} Create disk
              </button>
            </>
          }
        >
          <form className="form-stack" onSubmit={addDisk}>
            <div className="form-grid">
              <Field label="Size" hint="GiB, thin-provisioned">
                <div className="number-inline">
                  <input
                    className="input"
                    type="number"
                    min={1}
                    max={16384}
                    value={newDisk.sizeGB}
                    onChange={(e) => setNewDisk((d) => ({ ...d, sizeGB: e.target.value }))}
                  />
                  <span className="muted-2 small">GB</span>
                </div>
              </Field>
              <Field label="Bus" hint={running ? 'Only virtio supports hot-plug' : undefined}>
                <Select
                  value={newDisk.bus}
                  onChange={(bus) => setNewDisk((d) => ({ ...d, bus }))}
                  options={[
                    { value: 'virtio', label: 'VirtIO (recommended)' },
                    { value: 'sata', label: 'SATA / AHCI' },
                  ]}
                  disabled={running}
                />
              </Field>
            </div>
            <div className="console-hint">
              <Info size={14} />
              <span>
                {running
                  ? 'The disk will be created and hot-plugged into the running machine.'
                  : 'The disk is created immediately and attached on the next boot.'}
              </span>
            </div>
          </form>
        </Modal>
      )}

      {resizeDisk && (
        <Modal
          title={`Resize ${resizeDisk.file}`}
          subtitle="Disks can only be grown, never shrunk. The guest filesystem must be expanded separately."
          icon={<Maximize2 size={17} />}
          onClose={() => setResizeDisk(null)}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setResizeDisk(null)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={resize} disabled={busy === `resize:${resizeDisk.id}`}>
                {busy === `resize:${resizeDisk.id}` ? <Spinner size={14} /> : <Maximize2 size={14} />} Resize
              </button>
            </>
          }
        >
          <form className="form-stack" onSubmit={resize}>
            <Field
              label="New size (GB)"
              hint={`Current virtual size: ${formatBytes(resizeDisk.virtualSize || 0)}`}
            >
              <div className="number-inline">
                <input
                  className="input"
                  type="number"
                  min={Math.max(1, Math.ceil((resizeDisk.virtualSize || 0) / 1024 ** 3))}
                  value={resizeSize}
                  onChange={(e) => setResizeSize(e.target.value)}
                />
                <span className="muted-2 small">GB</span>
              </div>
            </Field>
          </form>
        </Modal>
      )}
    </div>
  );
}
