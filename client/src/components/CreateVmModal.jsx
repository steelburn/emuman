import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Cpu,
  Disc3,
  HardDrive,
  MemoryStick,
  MonitorPlay,
  Network,
  Play,
  Plus,
  Server,
  Sparkles,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { formatBytes, formatGB } from '../lib/format.js';
import { useUi } from '../context/UiContext.jsx';
import { useData } from '../context/DataContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Field, Modal, Segmented, Select, Toggle } from './ui.jsx';

const EMPTY = {
  name: '',
  description: '',
  cpus: 2,
  memoryMB: 2048,
  diskGB: 20,
  diskBus: 'virtio',
  isoPath: '',
  firmware: 'bios',
  video: 'std',
  bootFrom: 'disk',
  netMode: 'user',
  bridge: '',
  guestSshPort: 22,
  sshUser: 'root',
  autostart: false,
  startNow: true,
};

export default function CreateVmModal() {
  const { createVmOpen, closeCreateVm } = useUi();
  const { host, refreshVms } = useData();
  const toast = useToast();
  const navigate = useNavigate();
  const [form, setForm] = useState(EMPTY);
  const [isos, setIsos] = useState([]);
  const [bridges, setBridges] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [touched, setTouched] = useState(false);
  const [loadingData, setLoadingData] = useState(false);

  useEffect(() => {
    if (!createVmOpen) return;
    setForm({ ...EMPTY });
    setError(null);
    setTouched(false);
    setLoadingData(true);
    Promise.all([
      api.get('/api/host/isos').catch(() => ({ isos: [] })),
      api.get('/api/host/bridges').catch(() => ({ bridges: [] })),
    ])
      .then(([isoData, bridgeData]) => {
        setIsos(isoData.isos || []);
        setBridges(bridgeData.bridges || []);
      })
      .finally(() => setLoadingData(false));
    // Reset only when the modal opens; host metric updates must not clear the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createVmOpen]);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const selectedIso = useMemo(() => isos.find((i) => i.path === form.isoPath), [isos, form.isoPath]);
  const nameError = touched && !form.name.trim() ? 'Give the machine a name' : null;
  const efiAvailable = (host?.firmware || []).length > 0;

  const submit = async (e) => {
    e.preventDefault();
    setTouched(true);
    if (!form.name.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const vm = await api.post('/api/vms', {
        name: form.name.trim(),
        description: form.description,
        cpus: Number(form.cpus),
        memoryMB: Number(form.memoryMB),
        diskGB: Number(form.diskGB),
        diskBus: form.diskBus,
        isoPath: form.isoPath || null,
        firmware: form.firmware,
        video: form.video,
        bootFrom: form.isoPath ? form.bootFrom : 'disk',
        autostart: form.autostart,
        sshUser: form.sshUser,
        net: {
          mode: form.netMode,
          bridge: form.bridge,
          guestSshPort: Number(form.guestSshPort),
        },
      });
      toast.success(`${vm.name} created`, { title: 'Virtual machine ready' });
      refreshVms();
      closeCreateVm();
      navigate(`/vms/${vm.id}`);
      if (form.startNow) {
        try {
          await api.post(`/api/vms/${vm.id}/action`, { action: 'start' });
          toast.success(`${vm.name} is starting`);
        } catch (err) {
          toast.error(`Created, but could not start: ${err.message}`);
        }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!createVmOpen) return null;

  return (
    <Modal
      title="New virtual machine"
      subtitle="Create a KVM guest with its own disk, network and console."
      icon={<Plus size={18} />}
      onClose={closeCreateVm}
      size="xl"
      footer={
        <>
          <span className="muted-2 small" style={{ marginRight: 'auto' }}>
            Ports are allocated automatically from the configured ranges.
          </span>
          <button type="button" className="btn btn-ghost" onClick={closeCreateVm} disabled={loading}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={loading}>
            {loading ? 'Creating…' : form.startNow ? 'Create & start' : 'Create machine'}
          </button>
        </>
      }
    >
      <form onSubmit={submit}>
        {error && <div className="alert alert-error mb-16">{error}</div>}
        <div className="create-grid">
          <div className="form-stack">
            <div>
              <div className="section-label">Identity</div>
              <div className="form-grid">
                <Field label="Name" required error={nameError} className="span-2">
                  <input
                    className="input"
                    autoFocus
                    placeholder="e.g. production-web-01"
                    value={form.name}
                    onChange={(e) => set({ name: e.target.value })}
                    onBlur={() => setTouched(true)}
                    maxLength={64}
                  />
                </Field>
                <Field label="Description" className="span-2">
                  <input
                    className="input"
                    placeholder="Optional note about this machine"
                    value={form.description}
                    onChange={(e) => set({ description: e.target.value })}
                    maxLength={200}
                  />
                </Field>
              </div>
            </div>

            <div>
              <div className="section-label">Installation media</div>
              <Field
                label="ISO image"
                hint={
                  isos.length
                    ? 'Images from your ISO library. You can upload more from Storage.'
                    : 'No ISOs found. Upload one under Storage, or create an empty machine and attach later.'
                }
              >
                <Select
                  value={form.isoPath}
                  onChange={(isoPath) =>
                    set({
                      isoPath,
                      bootFrom: isoPath ? 'cdrom' : 'disk',
                    })
                  }
                  placeholder={loadingData ? 'Loading ISO library…' : 'None — empty disk'}
                  options={isos.map((iso) => ({
                    value: iso.path,
                    label: `${iso.name} · ${formatBytes(iso.size)}`,
                  }))}
                />
              </Field>
              {form.isoPath && (
                <div className="mt-12">
                  <Field label="Boot order">
                    <Segmented
                      value={form.bootFrom}
                      onChange={(bootFrom) => set({ bootFrom })}
                      options={[
                        { value: 'cdrom', label: 'CD-ROM (installer)' },
                        { value: 'disk', label: 'Hard disk' },
                      ]}
                    />
                  </Field>
                </div>
              )}
            </div>

            <div>
              <div className="section-label">Compute</div>
              <div className="form-grid">
                <Field label="vCPUs" hint={`Host has ${host?.cpuCount || '—'} threads`}>
                  <div className="number-inline">
                    <input
                      type="number"
                      className="input"
                      min={1}
                      max={64}
                      value={form.cpus}
                      onChange={(e) => set({ cpus: e.target.value })}
                    />
                    <span className="muted-2 small">cores</span>
                  </div>
                </Field>
                <Field label="Memory">
                  <div className="number-inline">
                    <input
                      type="number"
                      className="input"
                      min={128}
                      step={128}
                      max={262144}
                      value={form.memoryMB}
                      onChange={(e) => set({ memoryMB: e.target.value })}
                    />
                    <span className="muted-2 small">MB</span>
                  </div>
                </Field>
                <Field label="Disk size">
                  <div className="number-inline">
                    <input
                      type="number"
                      className="input"
                      min={1}
                      max={16384}
                      value={form.diskGB}
                      onChange={(e) => set({ diskGB: e.target.value })}
                    />
                    <span className="muted-2 small">GB</span>
                  </div>
                </Field>
                <Field label="Disk bus" hint="virtio is fastest; use SATA for older guests">
                  <Select
                    value={form.diskBus}
                    onChange={(diskBus) => set({ diskBus })}
                    options={[
                      { value: 'virtio', label: 'VirtIO (recommended)' },
                      { value: 'sata', label: 'SATA / AHCI' },
                    ]}
                  />
                </Field>
              </div>
              <div className="preset-row">
                {[1024, 2048, 4096, 8192, 16384].map((mb) => (
                  <button
                    type="button"
                    key={mb}
                    className={`preset ${Number(form.memoryMB) === mb ? 'active' : ''}`}
                    onClick={() => set({ memoryMB: mb })}
                  >
                    {mb >= 1024 ? `${mb / 1024} GB` : `${mb} MB`}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="section-label">System & network</div>
              <div className="form-grid">
                <Field label="Firmware" hint={efiAvailable ? 'UEFI requires OVMF (detected)' : 'OVMF not detected'}>
                  <Segmented
                    value={form.firmware}
                    onChange={(firmware) => set({ firmware })}
                    options={[
                      { value: 'bios', label: 'BIOS' },
                      { value: 'efi', label: 'UEFI' },
                    ]}
                  />
                </Field>
                <Field label="Display adapter">
                  <Select
                    value={form.video}
                    onChange={(video) => set({ video })}
                    options={[
                      { value: 'std', label: 'Standard VGA' },
                      { value: 'virtio', label: 'VirtIO GPU' },
                      { value: 'qxl', label: 'QXL (SPICE)' },
                      { value: 'vmware', label: 'VMware SVGA' },
                    ]}
                  />
                </Field>
                <Field label="Network mode" hint="User mode provides NAT and an SSH port-forward">
                  <Select
                    value={form.netMode}
                    onChange={(netMode) => set({ netMode })}
                    options={[
                      { value: 'user', label: 'User (NAT)' },
                      ...(bridges.length
                        ? [{ value: 'bridge', label: 'Bridge' }]
                        : []),
                    ]}
                  />
                </Field>
                {form.netMode === 'bridge' ? (
                  <Field label="Bridge interface">
                    <Select
                      value={form.bridge}
                      onChange={(bridge) => set({ bridge })}
                      placeholder="Select a bridge"
                      options={bridges.map((b) => ({ value: b, label: b }))}
                    />
                  </Field>
                ) : (
                  <Field label="Guest SSH port" hint="Forwarded to a random 127.0.0.1 port">
                    <input
                      className="input mono"
                      type="number"
                      min={1}
                      max={65535}
                      value={form.guestSshPort}
                      onChange={(e) => set({ guestSshPort: e.target.value })}
                    />
                  </Field>
                )}
                <Field label="Default SSH user" hint="Used to prefill the built-in SSH console">
                  <input
                    className="input"
                    value={form.sshUser}
                    onChange={(e) => set({ sshUser: e.target.value })}
                    maxLength={32}
                  />
                </Field>
              </div>
            </div>

            <div className="card card-pad" style={{ padding: '6px 16px' }}>
              <Toggle
                checked={form.autostart}
                onChange={(autostart) => set({ autostart })}
                label="Start with the emuman host"
                description="Power on this VM automatically when the manager boots"
              />
              <div className="divider" style={{ margin: '0' }} />
              <Toggle
                checked={form.startNow}
                onChange={(startNow) => set({ startNow })}
                label="Start immediately after creation"
                description="Ignored if the VM is created without a bootable medium"
              />
            </div>
          </div>

          <aside>
            <div className="summary-panel" style={{ position: 'sticky', top: 0 }}>
              <h4>Summary</h4>
              <div className="summary-row">
                <span>Name</span>
                <strong>{form.name.trim() || 'unnamed'}</strong>
              </div>
              <div className="summary-row">
                <span>Firmware</span>
                <strong>{form.firmware === 'efi' ? 'UEFI / OVMF' : 'SeaBIOS'}</strong>
              </div>
              <div className="summary-row">
                <span>Media</span>
                <strong>{selectedIso ? selectedIso.name : 'Empty disk'}</strong>
              </div>
              <div className="summary-row">
                <span>Boot</span>
                <strong>{form.isoPath ? (form.bootFrom === 'cdrom' ? 'CD-ROM' : 'Disk') : 'Disk'}</strong>
              </div>
              <div className="divider" />
              <div className="summary-row">
                <span>
                  <Cpu size={12} /> vCPU
                </span>
                <strong>{form.cpus}</strong>
              </div>
              <div className="summary-row">
                <span>
                  <MemoryStick size={12} /> Memory
                </span>
                <strong>{formatGB((Number(form.memoryMB) || 0) / 1024)}</strong>
              </div>
              <div className="summary-row">
                <span>
                  <HardDrive size={12} /> Disk
                </span>
                <strong>{form.diskGB} GB {form.diskBus}</strong>
              </div>
              <div className="summary-row">
                <span>
                  <Network size={12} /> Network
                </span>
                <strong>{form.netMode === 'bridge' ? form.bridge || 'bridge' : 'user NAT'}</strong>
              </div>
              <div className="divider" />
              <div className="console-hint">
                <Sparkles size={14} />
                <span>
                  VNC and serial consoles are provisioned automatically. SSH becomes reachable once
                  the guest runs an SSH server.
                </span>
              </div>
            </div>
          </aside>
        </div>
      </form>
    </Modal>
  );
}
