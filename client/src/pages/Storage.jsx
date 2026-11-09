import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Database,
  Disc3,
  HardDrive,
  RefreshCw,
  Server,
  Trash2,
  Upload,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useConfirm } from '../context/ConfirmContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useData } from '../context/DataContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { formatBytes, formatGB } from '../lib/format.js';
import { CopyButton, EmptyState, Meter, Spinner, StatusPill } from '../components/ui.jsx';

export default function Storage() {
  const toast = useToast();
  const confirm = useConfirm();
  const { refreshHost } = useData();
  const { can } = useAuth();
  const canManage = can('iso.manage');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [upload, setUpload] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const inputRef = useRef(null);
  const xhrRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const result = await api.get('/api/host/storage');
      setData(result);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(() => {
      if (!document.hidden) load();
    }, 15000);
    return () => clearInterval(timer);
  }, [load]);

  const uploadFile = (file) => {
    if (!canManage || !file) return;
    if (!/\.(iso|img)$/i.test(file.name)) {
      toast.error('Only .iso and .img files can be uploaded');
      return;
    }
    const form = new FormData();
    form.append('file', file);
    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    xhr.open('POST', '/api/host/isos');
    xhr.withCredentials = true;
    setUpload({ name: file.name, progress: 0, status: 'uploading' });
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        setUpload({ name: file.name, progress: (e.loaded / e.total) * 100, status: 'uploading' });
      }
    };
    xhr.onload = async () => {
      xhrRef.current = null;
      if (xhr.status >= 200 && xhr.status < 300) {
        setUpload({ name: file.name, progress: 100, status: 'done' });
        toast.success(`${file.name} uploaded to the ISO library`);
        setTimeout(() => setUpload(null), 2500);
        await load();
        refreshHost();
      } else {
        let message = 'Upload failed';
        try {
          message = JSON.parse(xhr.responseText).error || message;
        } catch {
          /* ignore */
        }
        setUpload({ name: file.name, progress: 0, status: 'error', message });
        toast.error(message, { title: 'Upload failed' });
      }
    };
    xhr.onerror = () => {
      xhrRef.current = null;
      setUpload({ name: file.name, progress: 0, status: 'error', message: 'Network error' });
      toast.error('Upload interrupted');
    };
    setUpload({ name: file.name, progress: 0, status: 'uploading' });
    xhr.send(form);
  };

  const cancelUpload = () => {
    xhrRef.current?.abort();
    xhrRef.current = null;
    setUpload(null);
  };

  const deleteIso = async (iso) => {
    const ok = await confirm({
      title: `Delete ${iso.name}?`,
      message: 'The ISO file will be removed from the library. Machines with this medium attached must be detached first.',
      confirmLabel: 'Delete ISO',
      danger: true,
    });
    if (!ok) return;
    setDeleting(iso.path);
    try {
      await api.del(`/api/host/isos?path=${encodeURIComponent(iso.path)}`);
      toast.success(`${iso.name} deleted`);
      await load();
      refreshHost();
    } catch (err) {
      toast.error(err.message, { title: 'Could not delete ISO' });
    } finally {
      setDeleting(null);
    }
  };

  const totals = data?.totals || {};
  const disks = useMemo(() => {
    const rows = [];
    for (const vm of data?.vms || []) {
      for (const disk of vm.disks || []) {
        rows.push({ vm, disk });
      }
    }
    return rows.sort((a, b) => a.vm.name.localeCompare(b.vm.name));
  }, [data]);

  const hostStorage = data?.host || { total: 0, used: 0, free: 0 };
  const usedPct = hostStorage.total ? (hostStorage.used / hostStorage.total) * 100 : 0;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Storage &amp; ISOs</h1>
          <p className="page-sub">
            Host pool · {formatBytes(hostStorage.used)} used of {formatBytes(hostStorage.total)} ·{' '}
            {formatBytes(hostStorage.free)} free
          </p>
        </div>
        <div className="page-actions">
          <button className="btn btn-ghost btn-sm" onClick={load} disabled={loading}>
            {loading ? <Spinner size={14} /> : <RefreshCw size={14} />} Refresh
          </button>
          {canManage && (
            <button className="btn btn-primary" onClick={() => inputRef.current?.click()} disabled={upload?.status === 'uploading'}>
              <Upload size={14} /> Upload ISO
            </button>
          )}
        </div>
      </div>

      {error && <div className="alert alert-error mb-16">{error}</div>}

      <div className="grid grid-stats mb-16">
        <div className="stat-card">
          <div className="stat-head">
            <span>Pool usage</span>
            <span className="stat-icon">
              <Database size={14} />
            </span>
          </div>
          <div className="stat-value">
            {Math.round(usedPct)}
            <span className="unit">%</span>
          </div>
          <div className="stat-spark" style={{ marginTop: 12 }}>
            <Meter value={hostStorage.used} max={hostStorage.total || 1} thin tone={usedPct > 90 ? 'danger' : usedPct > 75 ? 'warn' : 'accent'} />
          </div>
          <div className="stat-foot">{formatBytes(hostStorage.free)} available on the host filesystem</div>
        </div>
        <div className="stat-card">
          <div className="stat-head">
            <span>Disk provisioned</span>
            <span className="stat-icon">
              <HardDrive size={14} />
            </span>
          </div>
          <div className="stat-value">{formatBytes(totals.diskVirtual)}</div>
          <div className="stat-foot">{formatBytes(totals.diskActual)} physically used by qcow2 files</div>
        </div>
        <div className="stat-card">
          <div className="stat-head">
            <span>ISO library</span>
            <span className="stat-icon">
              <Disc3 size={14} />
            </span>
          </div>
          <div className="stat-value">
            {(data?.isos || []).length}
            <span className="unit">image{(data?.isos || []).length === 1 ? '' : 's'}</span>
          </div>
          <div className="stat-foot">{formatBytes(totals.isoSize)} of installation media</div>
        </div>
        <div className="stat-card">
          <div className="stat-head">
            <span>Virtual machines</span>
            <span className="stat-icon">
              <Server size={14} />
            </span>
          </div>
          <div className="stat-value">
            {(data?.vms || []).length}
            <span className="unit">with disks</span>
          </div>
          <div className="stat-foot">
            {(data?.vms || []).filter((v) => ['running', 'paused'].includes(v.status)).length} active
          </div>
        </div>
      </div>

      <div className="card mb-16">
        <div className="card-head">
          <span className="card-title-icon">
            <Disc3 size={15} />
          </span>
          <h3>ISO library</h3>
          <span className="muted">{(data?.isos || []).length} files</span>
          <div className="card-head-actions">
            {canManage && (
              <button className="btn btn-sm" onClick={() => inputRef.current?.click()} disabled={upload?.status === 'uploading'}>
                <Upload size={13} /> Upload
              </button>
            )}
          </div>
        </div>
        <div className="card-body">
          <input
            ref={inputRef}
            type="file"
            accept=".iso,.img"
            hidden
            onChange={(e) => {
              uploadFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          {canManage ? (
            <div
              className={`upload-zone ${dragging ? 'dragging' : ''}`}
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                uploadFile(e.dataTransfer.files?.[0]);
              }}
            >
              <Upload size={20} className="upload-icon" />
              <div>
                <strong style={{ color: 'var(--text-soft)' }}>Drop an ISO here</strong>, or click to browse
              </div>
              <div className="tiny muted-2 mt-8">
                .iso and .img · up to 32 GB · stored in {data?.isos?.[0]?.dir || 'the ISO directory'}
              </div>
            </div>
          ) : (
            <div className="alert alert-info" style={{ fontSize: 11.5 }}>
              <Disc3 size={14} />
              <span>Your role can browse the ISO library but cannot upload or delete images.</span>
            </div>
          )}

          {upload && (
            <div className="upload-progress">
              <div className="lbl">
                <span className="truncate" style={{ maxWidth: 420 }}>
                  {upload.name}
                </span>
                <span>
                  {upload.status === 'uploading'
                    ? `${upload.progress.toFixed(0)}%`
                    : upload.status === 'done'
                      ? 'uploaded'
                      : upload.message || 'failed'}
                </span>
              </div>
              <Meter
                value={upload.progress}
                max={100}
                thin
                tone={upload.status === 'error' ? 'danger' : upload.status === 'done' ? 'accent' : 'blue'}
              />
              {upload.status === 'uploading' && (
                <button className="link-btn danger mt-8" onClick={cancelUpload}>
                  Cancel upload
                </button>
              )}
            </div>
          )}

          {(data?.isos || []).length > 0 ? (
            <div className="table-wrap mt-16" style={{ border: 'none' }}>
              <table className="table" style={{ minWidth: 520 }}>
                <thead>
                  <tr>
                    <th>Image</th>
                    <th>Size</th>
                    <th>Location</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {(data?.isos || []).map((iso) => (
                    <tr key={iso.path}>
                      <td>
                        <div className="cell-main">
                          <span className="disk-icon" style={{ width: 28, height: 28 }}>
                            <Disc3 size={13} />
                          </span>
                          <span className="cell-name">{iso.name}</span>
                        </div>
                      </td>
                      <td className="num">{formatBytes(iso.size)}</td>
                      <td className="num tiny muted-2">{iso.dir}</td>
                      <td className="actions-cell">
                        <div className="flex items-center gap-4" style={{ justifyContent: 'flex-end' }}>
                          <CopyButton value={iso.path} label="" />
                          {canManage && (
                            <button
                              className="icon-btn"
                              onClick={() => deleteIso(iso)}
                              disabled={deleting === iso.path}
                              title="Delete ISO"
                            >
                              {deleting === iso.path ? <Spinner size={13} /> : <Trash2 size={14} />}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              compact
              icon={<Disc3 size={20} />}
              title="No ISO images yet"
              description="Upload an installer image to start provisioning guests."
            />
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <span className="card-title-icon">
            <HardDrive size={15} />
          </span>
          <h3>Virtual disks</h3>
          <span className="muted">{disks.length} volumes</span>
          <div className="card-head-actions">
            <span className="badge">{formatBytes(totals.diskActual)} on disk</span>
          </div>
        </div>
        {disks.length === 0 ? (
          <EmptyState
            compact
            icon={<HardDrive size={20} />}
            title="No virtual disks"
            description="Disks are created when you add a machine or attach a volume."
          />
        ) : (
          <div className="table-wrap" style={{ border: 'none', borderRadius: 0, boxShadow: 'none' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Machine</th>
                  <th>Volume</th>
                  <th>Bus</th>
                  <th>Provisioned</th>
                  <th>On disk</th>
                  <th>Usage</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {disks.map(({ vm, disk }) => {
                  const ratio = disk.virtualSize ? (disk.actualSize || 0) / disk.virtualSize : 0;
                  return (
                    <tr key={`${vm.id}-${disk.id}`}>
                      <td>
                        <div className="cell-main">
                          <span
                            className={`vm-avatar ${vm.status === 'running' ? 'running' : ''}`}
                            style={{ width: 26, height: 26, borderRadius: 7 }}
                          >
                            <Server size={12} />
                          </span>
                          <div>
                            <div className="cell-name">{vm.name}</div>
                            <StatusPill status={vm.status} pulse={false} />
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="cell-name mono tiny">{disk.file}</div>
                        <div className="cell-sub truncate" style={{ maxWidth: 320 }}>
                          {disk.path}
                        </div>
                      </td>
                      <td>
                        <span className="badge">{disk.bus}</span>
                      </td>
                      <td className="num">{formatBytes(disk.virtualSize)}</td>
                      <td className="num">{formatBytes(disk.actualSize || 0)}</td>
                      <td style={{ minWidth: 120 }}>
                        <Meter value={ratio * 100} max={100} thin tone="blue" right={`${Math.round(ratio * 100)}%`} />
                      </td>
                      <td className="actions-cell">
                        <CopyButton value={disk.path} label="" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="muted-2 tiny mt-16">
        Disk sizes are read with <code>qemu-img info</code> and cached for 15 seconds. Values for
        running machines may lag slightly.
      </div>
    </div>
  );
}
