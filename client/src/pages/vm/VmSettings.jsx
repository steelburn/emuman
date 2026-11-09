import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  Copy,
  Cpu,
  HardDrive,
  KeyRound,
  Network,
  Save,
  Settings as SettingsIcon,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { api } from '../../lib/api.js';
import { useConfirm } from '../../context/ConfirmContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useVmActions } from '../../hooks/useVmActions.jsx';
import {
  CopyButton,
  Field,
  Modal,
  PasswordInput,
  Segmented,
  Select,
  Spinner,
  Toggle,
} from '../../components/ui.jsx';

export default function VmSettings({ vm, detail, running, onChanged, onDeleted }) {
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const actions = useVmActions();
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [bridges, setBridges] = useState([]);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [cloneName, setCloneName] = useState(`${vm.name} clone`);
  const [cloning, setCloning] = useState(false);
  const [sshUser, setSshUser] = useState(vm.ssh?.user || 'root');
  const [sshPassword, setSshPassword] = useState('');
  const [sshSaving, setSshSaving] = useState(false);
  const [hasSaved, setHasSaved] = useState(Boolean(vm.hasSavedSshPassword));

  const initForm = (source) => ({
    name: source.name || '',
    description: source.description || '',
    cpus: source.cpus || 2,
    memoryMB: source.memoryMB || 2048,
    firmware: source.firmware || 'bios',
    video: source.video || 'std',
    bootFrom: source.bootFrom || 'disk',
    autostart: Boolean(source.autostart),
    extraArgs: (source.extraArgs || []).join('\n'),
    sshUser: source.ssh?.user || source.sshUser || 'root',
    netMode: source.net?.mode || 'user',
    bridge: source.net?.bridge || '',
    mac: source.net?.mac || '',
    guestSshPort: source.net?.guestSshPort || 22,
  });

  useEffect(() => {
    setForm(initForm(vm));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vm.id, vm.updatedAt]);

  useEffect(() => {
    setHasSaved(Boolean(vm.hasSavedSshPassword));
    setSshUser(vm.ssh?.user || 'root');
  }, [vm.hasSavedSshPassword, vm.ssh?.user]);

  useEffect(() => {
    api
      .get('/api/host/bridges')
      .then((data) => setBridges(data.bridges || []))
      .catch(() => {});
  }, []);

  if (!form) return null;
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const save = async (e) => {
    e?.preventDefault();
    if (!form.name.trim()) {
      toast.error('Name cannot be empty');
      return;
    }
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      description: form.description,
      autostart: form.autostart,
      sshUser: form.sshUser,
    };
    if (!running) {
      Object.assign(payload, {
        cpus: Number(form.cpus),
        memoryMB: Number(form.memoryMB),
        firmware: form.firmware,
        video: form.video,
        bootFrom: form.bootFrom,
        extraArgs: form.extraArgs
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean),
        net: {
          mode: form.netMode,
          bridge: form.bridge,
          mac: form.mac,
          guestSshPort: Number(form.guestSshPort),
        },
      });
    }
    try {
      await api.patch(`/api/vms/${vm.id}`, payload);
      toast.success('Configuration saved');
      await onChanged?.();
    } catch (err) {
      toast.error(err.message, { title: 'Save failed' });
    } finally {
      setSaving(false);
    }
  };

  const saveSsh = async (e) => {
    e.preventDefault();
    setSshSaving(true);
    try {
      const data = await api.post(`/api/vms/${vm.id}/ssh-credentials`, {
        username: sshUser,
        password: sshPassword || undefined,
      });
      setHasSaved(data.hasSavedPassword);
      setSshPassword('');
      toast.success('SSH credentials updated');
      await onChanged?.();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSshSaving(false);
    }
  };

  const clearSsh = async () => {
    const ok = await confirm({
      title: 'Forget saved SSH password?',
      message: 'The encrypted password stored for this VM will be deleted.',
      confirmLabel: 'Forget password',
    });
    if (!ok) return;
    try {
      await api.post(`/api/vms/${vm.id}/ssh-credentials`, { clear: true });
      setHasSaved(false);
      toast.success('Saved SSH password removed');
      await onChanged?.();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const clone = async () => {
    if (!cloneName.trim()) return;
    setCloning(true);
    const copy = await actions.clone(vm, cloneName.trim());
    setCloning(false);
    if (copy) {
      setCloneOpen(false);
      navigate(`/vms/${copy.id}`);
    }
  };

  return (
    <div className="split" style={{ '--side': '320px' }}>
      <form className="detail-side" style={{ gap: 16 }} onSubmit={save}>
        <div className="card">
          <div className="card-head">
            <span className="card-title-icon">
              <SettingsIcon size={15} />
            </span>
            <h3>General</h3>
          </div>
          <div className="card-body form-grid">
            <Field label="Name" required>
              <input
                className="input"
                value={form.name}
                onChange={(e) => set({ name: e.target.value })}
                maxLength={64}
              />
            </Field>
            <Field label="Default SSH user">
              <input
                className="input"
                value={form.sshUser}
                onChange={(e) => set({ sshUser: e.target.value })}
                maxLength={32}
              />
            </Field>
            <Field label="Description" className="span-2">
              <textarea
                className="input"
                rows={2}
                value={form.description}
                onChange={(e) => set({ description: e.target.value })}
                maxLength={500}
              />
            </Field>
            <div className="span-2">
              <Toggle
                checked={form.autostart}
                onChange={(autostart) => set({ autostart })}
                label="Autostart with emuman"
                description="Power on when the manager starts and no runtime is already active"
              />
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <span className="card-title-icon">
              <Cpu size={15} />
            </span>
            <h3>Hardware &amp; boot</h3>
            {running && <span className="badge warn">stop the VM to edit</span>}
          </div>
          <div className="card-body form-grid">
            <Field label="vCPUs">
              <input
                className="input mono"
                type="number"
                min={1}
                max={64}
                value={form.cpus}
                onChange={(e) => set({ cpus: e.target.value })}
                disabled={running}
              />
            </Field>
            <Field label="Memory (MB)">
              <input
                className="input mono"
                type="number"
                min={128}
                step={128}
                value={form.memoryMB}
                onChange={(e) => set({ memoryMB: e.target.value })}
                disabled={running}
              />
            </Field>
            <Field label="Firmware">
              <Segmented
                value={form.firmware}
                onChange={(firmware) => set({ firmware })}
                options={[
                  { value: 'bios', label: 'BIOS' },
                  { value: 'efi', label: 'UEFI' },
                ]}
              />
            </Field>
            <Field label="Video adapter">
              <Select
                value={form.video}
                onChange={(video) => set({ video })}
                options={[
                  { value: 'std', label: 'Standard VGA' },
                  { value: 'virtio', label: 'VirtIO GPU' },
                  { value: 'qxl', label: 'QXL (SPICE)' },
                  { value: 'vmware', label: 'VMware SVGA' },
                ]}
                disabled={running}
              />
            </Field>
            <Field label="Boot order">
              <Segmented
                value={form.bootFrom}
                onChange={(bootFrom) => set({ bootFrom })}
                options={[
                  { value: 'disk', label: 'Disk first' },
                  { value: 'cdrom', label: 'CD-ROM first' },
                ]}
              />
            </Field>
            <div className="span-2">
              <Field
                label="Extra QEMU arguments"
                hint="One argument per line. Applied on the next start. Invalid arguments will prevent the VM from booting."
              >
                <textarea
                  className="input mono"
                  rows={3}
                  value={form.extraArgs}
                  onChange={(e) => set({ extraArgs: e.target.value })}
                  placeholder="-device qemu-xhci"
                  disabled={running}
                />
              </Field>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <span className="card-title-icon">
              <Network size={15} />
            </span>
            <h3>Networking</h3>
            {running && <span className="badge warn">stop the VM to edit</span>}
          </div>
          <div className="card-body form-grid">
            <Field label="Mode">
              <Select
                value={form.netMode}
                onChange={(netMode) => set({ netMode })}
                options={[
                  { value: 'user', label: 'User (NAT + port forwards)' },
                  ...(bridges.length ? [{ value: 'bridge', label: 'Bridge' }] : []),
                ]}
                disabled={running}
              />
            </Field>
            {form.netMode === 'bridge' ? (
              <Field label="Bridge device" hint={bridges.length ? undefined : 'No bridges detected on this host'}>
                <Select
                  value={form.bridge}
                  onChange={(bridge) => set({ bridge })}
                  placeholder="Select bridge"
                  options={bridges.map((b) => ({ value: b, label: b }))}
                  disabled={running}
                />
              </Field>
            ) : (
              <Field label="Guest SSH port">
                <input
                  className="input mono"
                  type="number"
                  min={1}
                  max={65535}
                  value={form.guestSshPort}
                  onChange={(e) => set({ guestSshPort: e.target.value })}
                  disabled={running}
                />
              </Field>
            )}
            <Field label="MAC address" hint="Used for DHCP reservations">
              <input
                className="input mono"
                value={form.mac}
                onChange={(e) => set({ mac: e.target.value })}
                disabled={running}
                pattern="([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}"
              />
            </Field>
            <Field label="Host SSH forward">
              <input
                className="input mono"
                value={vm.net?.sshPort ? `127.0.0.1:${vm.net.sshPort}` : 'not forwarded'}
                readOnly
                disabled
              />
            </Field>
          </div>
        </div>

        <div className="flex items-center gap-8">
          <button className="btn btn-primary" type="submit" disabled={saving}>
            {saving ? <Spinner size={14} /> : <Save size={14} />} Save changes
          </button>
          <span className="tiny muted-2">
            {running
              ? 'Hardware and network changes are locked while the machine is running.'
              : 'Changes take effect the next time the machine starts.'}
          </span>
        </div>
      </form>

      <div className="detail-side">
        <div className="card">
          <div className="card-head">
            <span className="card-title-icon">
              <KeyRound size={15} />
            </span>
            <h3>SSH credentials</h3>
            {hasSaved && <span className="badge accent">stored</span>}
          </div>
          <form className="card-body form-stack" onSubmit={saveSsh}>
            <Field label="Username">
              <input className="input" value={sshUser} onChange={(e) => setSshUser(e.target.value)} />
            </Field>
            <Field
              label="Password"
              hint={hasSaved ? 'A password is stored (AES-256-GCM). Enter a new one to replace it.' : 'Optional. Stored encrypted with the host secret.'}
            >
              <PasswordInput
                value={sshPassword}
                onChange={(e) => setSshPassword(e.target.value)}
                autoComplete="new-password"
                placeholder={hasSaved ? '••••••••' : 'SSH password'}
              />
            </Field>
            <div className="flex gap-8">
              <button className="btn btn-primary btn-sm" type="submit" disabled={sshSaving}>
                {sshSaving ? <Spinner size={13} /> : <ShieldCheck size={13} />} Save
              </button>
              {hasSaved && (
                <button className="btn btn-sm btn-ghost" type="button" onClick={clearSsh}>
                  Forget
                </button>
              )}
            </div>
            <p className="tiny muted-2">
              Used to prefill the built-in SSH console. The secret never leaves the server except
              when establishing the SSH session.
            </p>
          </form>
        </div>

        <div className="card">
          <div className="card-head">
            <span className="card-title-icon">
              <HardDrive size={15} />
            </span>
            <h3>Identity</h3>
          </div>
          <div className="card-body">
            <div className="data-row">
              <span className="data-label">UUID</span>
              <span className="data-value mono tiny" style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <span className="truncate" style={{ maxWidth: 160 }}>{vm.id}</span>
                <CopyButton value={vm.id} label="" />
              </span>
            </div>
            <div className="data-row">
              <span className="data-label">MAC</span>
              <span className="data-value mono tiny">{vm.net?.mac || '—'}</span>
            </div>
            <div className="data-row">
              <span className="data-label">VNC</span>
              <span className="data-value mono tiny">127.0.0.1:{vm.vncPort}</span>
            </div>
            <div className="data-row">
              <span className="data-label">QEMU PID</span>
              <span className="data-value mono tiny">{detail?.runtime?.pid || '—'}</span>
            </div>
            <div className="data-row">
              <span className="data-label">Machine</span>
              <span className="data-value mono tiny">{vm.machine || 'q35'}</span>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <span className="card-title-icon">
              <Copy size={15} />
            </span>
            <h3>Clone</h3>
          </div>
          <div className="card-body">
            <p className="small muted" style={{ lineHeight: 1.55 }}>
              Create a full copy of every disk and the configuration. The machine must be stopped.
            </p>
            <button className="btn btn-sm btn-block mt-12" onClick={() => setCloneOpen(true)} disabled={running}>
              <Copy size={13} /> Clone this machine
            </button>
            {running && <p className="tiny muted-2 mt-8">Stop the machine before cloning.</p>}
          </div>
        </div>

        <div className="card" style={{ borderColor: 'rgba(255,112,112,0.25)' }}>
          <div className="card-head" style={{ borderColor: 'rgba(255,112,112,0.18)' }}>
            <span className="card-title-icon" style={{ color: 'var(--danger)' }}>
              <AlertTriangle size={15} />
            </span>
            <h3>Danger zone</h3>
          </div>
          <div className="card-body">
            <p className="small muted" style={{ lineHeight: 1.55 }}>
              Deleting the machine removes its configuration, disks, snapshots and logs from this
              host.
            </p>
            <button
              className="btn btn-danger btn-sm btn-block mt-12"
              onClick={async () => {
                const deleted = await actions.remove(vm);
                if (deleted) onDeleted?.();
              }}
            >
              <Trash2 size={13} /> Delete virtual machine
            </button>
          </div>
        </div>
      </div>

      {cloneOpen && (
        <Modal
          title="Clone virtual machine"
          subtitle={`A full copy of ${vm.name} will be created with new IDs, MAC and ports.`}
          icon={<Copy size={17} />}
          onClose={() => setCloneOpen(false)}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setCloneOpen(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={clone} disabled={cloning || !cloneName.trim()}>
                {cloning ? <Spinner size={14} /> : <Copy size={14} />} Clone machine
              </button>
            </>
          }
        >
          <Field label="Name for the copy" required>
            <input
              className="input"
              value={cloneName}
              onChange={(e) => setCloneName(e.target.value)}
              autoFocus
              maxLength={64}
            />
          </Field>
        </Modal>
      )}
    </div>
  );
}
