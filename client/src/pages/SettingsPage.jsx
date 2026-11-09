import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  CheckCircle2,
  Cpu,
  Database,
  Info,
  KeyRound,
  RefreshCw,
  Save,
  Server,
  Settings,
  ShieldCheck,
  Trash2,
  UserCog,
  Users,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useConfirm } from '../context/ConfirmContext.jsx';
import { useData } from '../context/DataContext.jsx';
import { formatDate } from '../lib/format.js';
import {
  CopyButton,
  Field,
  PasswordInput,
  Select,
  Spinner,
  StatusPill,
} from '../components/ui.jsx';

const TABS = [
  { id: 'host', label: 'Host settings', icon: Settings, permission: 'host.settings' },
  { id: 'security', label: 'Account & security', icon: ShieldCheck },
  { id: 'ssh', label: 'Known SSH hosts', icon: KeyRound, permission: 'host.settings' },
  { id: 'about', label: 'About', icon: Info },
];

export default function SettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, logout, refresh, can } = useAuth();
  const { host, refreshHost } = useData();
  const toast = useToast();
  const confirm = useConfirm();

  const tabs = useMemo(() => TABS.filter((t) => !t.permission || can(t.permission)), [can]);
  const requestedTab = searchParams.get('tab');
  const tab = tabs.some((t) => t.id === requestedTab) ? requestedTab : tabs[0]?.id || 'security';
  const canHostSettings = can('host.settings');

  const [settings, setSettings] = useState({});
  const [settingsReady, setSettingsReady] = useState(!canHostSettings);
  const [meta, setMeta] = useState({ qemuVersion: null, kvm: false, firmware: [] });
  const [saving, setSaving] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [passwords, setPasswords] = useState({ current: '', next: '', confirm: '' });
  const [savingPassword, setSavingPassword] = useState(false);
  const [knownHosts, setKnownHosts] = useState([]);

  useEffect(() => {
    if (!canHostSettings) {
      setSettingsReady(true);
      return;
    }
    api
      .get('/api/host/settings')
      .then((data) => {
        setSettings(data.settings);
        setMeta({ qemuVersion: data.qemuVersion, kvm: data.kvm, firmware: data.firmware || [] });
      })
      .catch((err) => toast.error(err.message))
      .finally(() => setSettingsReady(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canHostSettings]);

  const loadKnownHosts = () => {
    api
      .get('/api/host/known-hosts')
      .then((data) => setKnownHosts(data.hosts || []))
      .catch(() => {});
  };

  useEffect(() => {
    if (tab === 'ssh' && canHostSettings) loadKnownHosts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, canHostSettings]);

  const setTab = (id) => {
    if (id === 'host') setSearchParams({});
    else setSearchParams({ tab: id });
  };

  if (!settingsReady) {
    return (
      <div className="page">
        <div className="splash" style={{ minHeight: '40vh' }}>
          <Spinner size={20} /> Loading settings…
        </div>
      </div>
    );
  }

  const set = (patch) => setSettings((s) => ({ ...s, ...patch }));

  const saveHost = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const data = await api.patch('/api/host/settings', {
        qemuPath: settings.qemuPath,
        isoDir: settings.isoDir,
        storageDir: settings.storageDir,
        vncPortStart: Number(settings.vncPortStart),
        vncPortEnd: Number(settings.vncPortEnd),
        sshPortStart: Number(settings.sshPortStart),
        sshPortEnd: Number(settings.sshPortEnd),
        metricsIntervalMs: Number(settings.metricsIntervalMs),
      });
      setSettings(data.settings);
      setMeta((m) => ({ ...m, qemuVersion: data.qemuVersion, firmware: data.firmware || m.firmware }));
      toast.success('Host settings saved');
      refreshHost();
    } catch (err) {
      toast.error(err.message, { title: 'Could not save settings' });
    } finally {
      setSaving(false);
    }
  };

  const detectQemu = async () => {
    setDetecting(true);
    try {
      const data = await api.post('/api/host/qemu/detect');
      setMeta((m) => ({ ...m, qemuVersion: data.qemuVersion, kvm: data.kvm }));
      toast.success(`Detected QEMU ${data.qemuVersion || 'binary'}`);
      refreshHost();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setDetecting(false);
    }
  };

  const changePassword = async (e) => {
    e.preventDefault();
    if (passwords.next.length < 8) {
      toast.error('New password must be at least 8 characters');
      return;
    }
    if (passwords.next !== passwords.confirm) {
      toast.error('New passwords do not match');
      return;
    }
    setSavingPassword(true);
    try {
      await api.post('/api/auth/password', {
        currentPassword: passwords.current,
        newPassword: passwords.next,
      });
      setPasswords({ current: '', next: '', confirm: '' });
      toast.success('Password changed. Other sessions were signed out.');
      await refresh();
    } catch (err) {
      toast.error(err.message, { title: 'Password not changed' });
    } finally {
      setSavingPassword(false);
    }
  };

  const forgetHost = async (entry) => {
    const ok = await confirm({
      title: `Forget ${entry.host}?`,
      message: 'The pinned fingerprint will be removed and the next SSH connection will trust the key again.',
      confirmLabel: 'Forget host',
    });
    if (!ok) return;
    try {
      await api.del(`/api/host/known-hosts?host=${encodeURIComponent(entry.host)}`);
      toast.success('Host key removed');
      loadKnownHosts();
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="page page-narrow">
      <div className="page-head">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-sub">
            {canHostSettings
              ? 'Host configuration, account security and trusted SSH keys.'
              : 'Account security and session management for your role.'}
          </p>
        </div>
      </div>

      <div className="tabs">
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
              <Icon size={14} /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'host' && (
        <form className="detail-side" style={{ gap: 16 }} onSubmit={saveHost}>
          <div className="card">
            <div className="card-head">
              <span className="card-title-icon">
                <Cpu size={15} />
              </span>
              <h3>QEMU &amp; virtualization</h3>
              <div className="card-head-actions">
                <StatusPill
                  status={meta.kvm ? 'running' : 'paused'}
                  label={meta.kvm ? 'KVM available' : 'KVM unavailable'}
                  pulse={false}
                />
                <span className="badge">{meta.qemuVersion || 'unknown'}</span>
              </div>
            </div>
            <div className="card-body form-stack">
              <Field
                label="QEMU system binary"
                hint="Absolute path to qemu-system-x86_64. Changing this affects newly started machines."
              >
                <div className="flex gap-8">
                  <input
                    className="input mono"
                    value={settings.qemuPath}
                    onChange={(e) => set({ qemuPath: e.target.value })}
                  />
                  <button className="btn" type="button" onClick={detectQemu} disabled={detecting}>
                    {detecting ? <Spinner size={14} /> : <RefreshCw size={14} />} Detect
                  </button>
                </div>
              </Field>
              <div className="alert alert-info" style={{ fontSize: 11.5 }}>
                <Info size={14} />
                <span>
                  Detected UEFI firmware:{' '}
                  {meta.firmware?.length
                    ? meta.firmware
                        .map((f) => (typeof f === 'string' ? f : f?.code || '').split('/').pop())
                        .join(', ')
                    : 'none — UEFI guests will fall back to BIOS'}
                  . Acceleration is {meta.kvm ? 'hardware (KVM)' : 'software (TCG)'}.
                </span>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <span className="card-title-icon">
                <Database size={15} />
              </span>
              <h3>Storage paths</h3>
            </div>
            <div className="card-body form-grid">
              <Field label="ISO library" hint="Uploads and the attach dialog read from this directory.">
                <input className="input mono" value={settings.isoDir} onChange={(e) => set({ isoDir: e.target.value })} />
              </Field>
              <Field label="Storage pool" hint="Reports capacity for the pool. VM directories live under the data dir.">
                <input className="input mono" value={settings.storageDir} onChange={(e) => set({ storageDir: e.target.value })} />
              </Field>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <span className="card-title-icon">
                <Server size={15} />
              </span>
              <h3>Console &amp; port ranges</h3>
            </div>
            <div className="card-body form-grid">
              <Field label="VNC port range start" hint="QEMU binds these on 127.0.0.1 only.">
                <input
                  className="input mono"
                  type="number"
                  min={5900}
                  max={6500}
                  value={settings.vncPortStart}
                  onChange={(e) => set({ vncPortStart: e.target.value })}
                />
              </Field>
              <Field label="VNC range end">
                <input
                  className="input mono"
                  type="number"
                  min={5902}
                  max={7000}
                  value={settings.vncPortEnd}
                  onChange={(e) => set({ vncPortEnd: e.target.value })}
                />
              </Field>
              <Field label="SSH forward range start" hint="Host-side ports for guest port 22.">
                <input
                  className="input mono"
                  type="number"
                  min={1024}
                  max={65000}
                  value={settings.sshPortStart}
                  onChange={(e) => set({ sshPortStart: e.target.value })}
                />
              </Field>
              <Field label="SSH forward range end">
                <input
                  className="input mono"
                  type="number"
                  min={1025}
                  max={65535}
                  value={settings.sshPortEnd}
                  onChange={(e) => set({ sshPortEnd: e.target.value })}
                />
              </Field>
              <Field label="Metrics interval" hint="How often CPU and memory samples are collected.">
                <Select
                  value={String(settings.metricsIntervalMs)}
                  onChange={(v) => set({ metricsIntervalMs: Number(v) })}
                  options={[
                    { value: '1000', label: '1 second' },
                    { value: '2000', label: '2 seconds (default)' },
                    { value: '3000', label: '3 seconds' },
                    { value: '5000', label: '5 seconds' },
                  ]}
                />
              </Field>
              <Field label="Data directory">
                <input className="input mono" value={host?.dataDir || ''} readOnly disabled />
              </Field>
            </div>
          </div>

          <div className="flex items-center gap-8">
            <button className="btn btn-primary" type="submit" disabled={saving}>
              {saving ? <Spinner size={14} /> : <Save size={14} />} Save settings
            </button>
            <span className="tiny muted-2">Port changes apply to machines started after saving.</span>
          </div>
        </form>
      )}

      {tab === 'security' && (
        <div className="split" style={{ '--side': '320px' }}>
          <div className="card">
            <div className="card-head">
              <span className="card-title-icon">
                <UserCog size={15} />
              </span>
              <h3>Your account</h3>
            </div>
            <div className="card-body">
              <div className="data-row">
                <span className="data-label">Username</span>
                <span className="data-value mono">{user?.username}</span>
              </div>
              {user?.displayName && (
                <div className="data-row">
                  <span className="data-label">Display name</span>
                  <span className="data-value">{user.displayName}</span>
                </div>
              )}
              <div className="data-row">
                <span className="data-label">Role</span>
                <span className="data-value">
                  <span
                    className={`role-badge tone-${
                      user?.role === 'admin' ? 'danger' : user?.role === 'operator' ? 'accent' : 'neutral'
                    }`}
                  >
                    {user?.roleLabel || user?.role}
                  </span>
                </span>
              </div>
              <div className="data-row">
                <span className="data-label">Account created</span>
                <span className="data-value">{formatDate(user?.createdAt)}</span>
              </div>
              <div className="data-row">
                <span className="data-label">Last sign-in</span>
                <span className="data-value">{formatDate(user?.lastLoginAt)}</span>
              </div>
              <div className="divider" />
              <div className="tiny muted-2" style={{ marginBottom: 8 }}>
                PERMISSIONS GRANTED BY YOUR ROLE
              </div>
              <div className="role-perms">
                {(user?.permissions || []).map((permission) => (
                  <span className="perm-chip" key={permission}>
                    {permission === '*' ? 'all permissions' : permission}
                  </span>
                ))}
              </div>
              <div className="divider" />
              <form className="form-stack" onSubmit={changePassword} style={{ maxWidth: 420 }}>
                <h3 style={{ fontSize: 14 }}>Change password</h3>
                <Field label="Current password" required>
                  <PasswordInput
                    value={passwords.current}
                    onChange={(e) => setPasswords((p) => ({ ...p, current: e.target.value }))}
                    autoComplete="current-password"
                    required
                  />
                </Field>
                <Field label="New password" hint="At least 8 characters." required>
                  <PasswordInput
                    value={passwords.next}
                    onChange={(e) => setPasswords((p) => ({ ...p, next: e.target.value }))}
                    autoComplete="new-password"
                    required
                  />
                </Field>
                <Field label="Confirm new password" required>
                  <PasswordInput
                    value={passwords.confirm}
                    onChange={(e) => setPasswords((p) => ({ ...p, confirm: e.target.value }))}
                    autoComplete="new-password"
                    required
                  />
                </Field>
                <button className="btn btn-primary" type="submit" disabled={savingPassword}>
                  {savingPassword ? <Spinner size={14} /> : <KeyRound size={14} />} Update password
                </button>
              </form>
            </div>
          </div>

          <div className="detail-side">
            {can('users.manage') && (
              <div className="card">
                <div className="card-head">
                  <span className="card-title-icon">
                    <Users size={15} />
                  </span>
                  <h3>Users &amp; roles</h3>
                </div>
                <div className="card-body">
                  <p className="small muted" style={{ lineHeight: 1.6 }}>
                    Add accounts, assign administrator, operator or viewer roles, reset passwords and
                    revoke sessions.
                  </p>
                  <Link className="btn btn-sm btn-block mt-16" to="/users">
                    <Users size={14} /> Manage users
                  </Link>
                </div>
              </div>
            )}
            <div className="card">
              <div className="card-head">
                <span className="card-title-icon">
                  <ShieldCheck size={15} />
                </span>
                <h3>Session</h3>
              </div>
              <div className="card-body">
                <p className="small muted" style={{ lineHeight: 1.6 }}>
                  You are signed in with a 30-day HTTP-only session cookie. Other sessions are
                  revoked when you change your password.
                </p>
                <button
                  className="btn btn-danger btn-sm btn-block mt-16"
                  onClick={async () => {
                    await logout();
                    window.location.assign('/login');
                  }}
                >
                  Sign out of this session
                </button>
              </div>
            </div>
            <div className="console-hint">
              <ShieldCheck size={14} />
              <span>
                Passwords are hashed with scrypt (N=16384). The API requires a JSON content type or
                the emuman header to prevent cross-site form posts.
              </span>
            </div>
          </div>
        </div>
      )}

      {tab === 'ssh' && (
        <div className="card">
          <div className="card-head">
            <span className="card-title-icon">
              <KeyRound size={15} />
            </span>
            <h3>Trusted SSH host keys</h3>
            <span className="muted">{knownHosts.length} pinned</span>
            <div className="card-head-actions">
              <button className="btn btn-sm btn-ghost" onClick={loadKnownHosts}>
                <RefreshCw size={13} /> Refresh
              </button>
            </div>
          </div>
          {knownHosts.length === 0 ? (
            <div className="card-body muted small">
              No host keys pinned yet. The first SSH connection to a target stores its SHA-256
              fingerprint (trust on first use) and blocks later key changes.
            </div>
          ) : (
            <div className="table-wrap" style={{ border: 'none', borderRadius: 0, boxShadow: 'none' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Target</th>
                    <th>SHA-256 fingerprint</th>
                    <th>Pinned</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {knownHosts.map((entry) => (
                    <tr key={entry.host}>
                      <td className="mono small">{entry.host}</td>
                      <td className="mono tiny" style={{ maxWidth: 360, overflowWrap: 'anywhere' }}>
                        {entry.fingerprint}
                      </td>
                      <td className="tiny muted-2">{formatDate(entry.addedAt)}</td>
                      <td className="actions-cell">
                        <button className="btn btn-sm btn-ghost" onClick={() => forgetHost(entry)}>
                          <Trash2 size={12} /> Forget
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="card-body">
            <div className="alert alert-info" style={{ fontSize: 11.5 }}>
              <Info size={14} />
              <span>
                Emuman pins the server host key on first connection. If a machine is rebuilt, use
                “Forget” before reconnecting. Keys are stored per target (for guest forwards, per VM
                ID).
              </span>
            </div>
          </div>
        </div>
      )}

      {tab === 'about' && (
        <div className="detail-side" style={{ gap: 16 }}>
          <div className="card">
            <div className="card-head">
              <span className="card-title-icon">
                <Info size={15} />
              </span>
              <h3>emuman</h3>
              <span className="badge accent">v{host?.version}</span>
            </div>
            <div className="card-body">
              <p className="small muted" style={{ lineHeight: 1.7 }}>
                A self-hosted web console for KVM/QEMU. Emuman talks directly to QEMU through the
                Machine Protocol (QMP) — there is no libvirt dependency — and ships browser VNC,
                SSH and serial consoles.
              </p>
              <div className="callout-grid mt-16">
                <div className="callout">
                  <span className="callout-icon">
                    <CheckCircle2 size={15} />
                  </span>
                  <div>
                    <h4>Machines</h4>
                    <p>Create, boot, pause, snapshot, clone, resize and delete KVM guests.</p>
                  </div>
                </div>
                <div className="callout">
                  <span className="callout-icon">
                    <CheckCircle2 size={15} />
                  </span>
                  <div>
                    <h4>Consoles</h4>
                    <p>noVNC over authenticated WebSockets, SSH via ssh2, serial chardev.</p>
                  </div>
                </div>
                <div className="callout">
                  <span className="callout-icon">
                    <CheckCircle2 size={15} />
                  </span>
                  <div>
                    <h4>Operations</h4>
                    <p>Live metrics, ISO uploads, audit trail, task history, host settings.</p>
                  </div>
                </div>
                <div className="callout">
                  <span className="callout-icon">
                    <CheckCircle2 size={15} />
                  </span>
                  <div>
                    <h4>Security</h4>
                    <p>scrypt passwords, HttpOnly sessions, AES-256-GCM secrets, pinned SSH keys.</p>
                  </div>
                </div>
              </div>
              <div className="divider" />
              <div className="data-row">
                <span className="data-label">Data directory</span>
                <span className="data-value mono tiny" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {host?.dataDir} <CopyButton value={host?.dataDir || ''} label="" />
                </span>
              </div>
              <div className="data-row">
                <span className="data-label">Backend</span>
                <span className="data-value mono tiny">Node {host?.nodeVersion} · Fastify · ws · ssh2</span>
              </div>
              <div className="data-row">
                <span className="data-label">Frontend</span>
                <span className="data-value mono tiny">React · Vite · xterm.js · noVNC</span>
              </div>
              <div className="data-row">
                <span className="data-label">Hypervisor</span>
                <span className="data-value mono tiny">QEMU {host?.qemuVersion} · {host?.kvm ? 'KVM' : 'TCG'}</span>
              </div>
            </div>
          </div>
          <div className="console-hint">
            <Info size={14} />
            <span>
              Ports 5900–5999 (VNC) and 2200–2299 (SSH forwards) are bound to 127.0.0.1 by default.
              Console traffic is proxied by the emuman server, so only the web port needs to be
              reachable.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
