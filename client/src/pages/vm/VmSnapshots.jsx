import { useCallback, useEffect, useState } from 'react';
import { Camera, History, RefreshCw, RotateCcw, Trash2 } from 'lucide-react';
import { api } from '../../lib/api.js';
import { timeAgo } from '../../lib/format.js';
import { useConfirm } from '../../context/ConfirmContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { EmptyState, Spinner } from '../../components/ui.jsx';

export default function VmSnapshots({ vm, onChanged }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [snapshots, setSnapshots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [name, setName] = useState('');
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await api.get(`/api/vms/${vm.id}/snapshots`);
      setSnapshots(data.snapshots || []);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [vm.id]);

  useEffect(() => {
    load();
  }, [load]);

  const create = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy('create');
    try {
      const data = await api.post(`/api/vms/${vm.id}/snapshots`, { name: name.trim() });
      setSnapshots(data.snapshots || []);
      setName('');
      toast.success(`Snapshot "${name.trim()}" created`);
      onChanged?.();
    } catch (err) {
      toast.error(err.message, { title: 'Snapshot failed' });
    } finally {
      setBusy(null);
    }
  };

  const restore = async (snap) => {
    const ok = await confirm({
      title: `Restore "${snap.name}"?`,
      message:
        'The current machine state will be replaced by the snapshot. If the VM is running it will be force-stopped and booted from the saved state.',
      confirmLabel: 'Restore snapshot',
      danger: true,
    });
    if (!ok) return;
    setBusy(`restore:${snap.name}`);
    try {
      await api.post(`/api/vms/${vm.id}/snapshots/${encodeURIComponent(snap.name)}/restore`);
      toast.success(`Restoring "${snap.name}"`);
      onChanged?.();
      setTimeout(load, 1800);
    } catch (err) {
      toast.error(err.message, { title: 'Restore failed' });
    } finally {
      setBusy(null);
    }
  };

  const remove = async (snap) => {
    const ok = await confirm({
      title: `Delete snapshot "${snap.name}"?`,
      message: 'The snapshot and its saved VM state will be removed from the disk. Other snapshots are unaffected.',
      confirmLabel: 'Delete snapshot',
      danger: true,
    });
    if (!ok) return;
    setBusy(`delete:${snap.name}`);
    try {
      await api.del(`/api/vms/${vm.id}/snapshots/${encodeURIComponent(snap.name)}`);
      toast.success(`Snapshot "${snap.name}" deleted`);
      await load();
    } catch (err) {
      toast.error(err.message, { title: 'Delete failed' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="split" style={{ '--side': '320px' }}>
      <div className="card">
        <div className="card-head">
          <span className="card-title-icon">
            <History size={15} />
          </span>
          <h3>Snapshots</h3>
          <span className="muted">{snapshots.length}</span>
          <div className="card-head-actions">
            <button className="btn btn-sm btn-ghost" onClick={load} disabled={loading}>
              <RefreshCw size={13} /> Refresh
            </button>
          </div>
        </div>
        {error && <div className="alert alert-error" style={{ margin: 14 }}>{error}</div>}
        {loading ? (
          <div className="table-empty">
            <Spinner size={16} /> Loading snapshots…
          </div>
        ) : snapshots.length === 0 ? (
          <EmptyState
            compact
            icon={<Camera size={20} />}
            title="No snapshots"
            description="Save the current disk and VM state so you can roll back later."
          />
        ) : (
          <div className="table-wrap" style={{ border: 'none', borderRadius: 0, boxShadow: 'none' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>VM state</th>
                  <th>Created</th>
                  <th>Clock</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {snapshots.map((snap) => (
                  <tr key={snap.name}>
                    <td>
                      <div className="cell-main">
                        <span className="disk-icon" style={{ width: 28, height: 28 }}>
                          <Camera size={13} />
                        </span>
                        <span className="cell-name">{snap.name}</span>
                      </div>
                    </td>
                    <td className="num">{snap.vmSize || '—'}</td>
                    <td className="num">{snap.date || '—'}</td>
                    <td className="num">{snap.vmClock || '—'}</td>
                    <td className="actions-cell">
                      <div className="flex items-center gap-4" style={{ justifyContent: 'flex-end' }}>
                        <button
                          className="btn btn-sm"
                          onClick={() => restore(snap)}
                          disabled={Boolean(busy)}
                        >
                          {busy === `restore:${snap.name}` ? <Spinner size={12} /> : <RotateCcw size={12} />}
                          Restore
                        </button>
                        <button
                          className="icon-btn"
                          onClick={() => remove(snap)}
                          disabled={Boolean(busy)}
                          title="Delete snapshot"
                        >
                          {busy === `delete:${snap.name}` ? <Spinner size={13} /> : <Trash2 size={14} />}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="detail-side">
        <div className="card">
          <div className="card-head">
            <span className="card-title-icon">
              <Camera size={15} />
            </span>
            <h3>Take a snapshot</h3>
          </div>
          <form className="card-body form-stack" onSubmit={create}>
            <div className="field">
              <label className="field-label" htmlFor="snap-name">
                Snapshot name
              </label>
              <input
                id="snap-name"
                className="input mono"
                placeholder="before-upgrade"
                value={name}
                onChange={(e) => setName(e.target.value)}
                pattern="[A-Za-z0-9][A-Za-z0-9_.\-]{0,62}"
                required
              />
              <p className="field-hint">Letters, digits, dot, dash, underscore.</p>
            </div>
            <button className="btn btn-primary btn-block" type="submit" disabled={busy === 'create' || !name.trim()}>
              {busy === 'create' ? <Spinner size={14} /> : <Camera size={14} />}
              {busy === 'create' ? 'Creating…' : 'Create snapshot'}
            </button>
          </form>
        </div>

        <div className="console-hint">
          <Camera size={14} />
          <span>
            Snapshots require a <strong>qcow2</strong> disk. When the VM is running, QEMU saves RAM
            and device state together with the disk via <code>savevm</code>; stopped machines get a
            disk-only snapshot.
          </span>
        </div>
        <div className="console-hint warn">
          <RotateCcw size={14} />
          <span>
            Restoring boots the saved state immediately. Any work done after the snapshot is lost.
          </span>
        </div>
      </div>
    </div>
  );
}
