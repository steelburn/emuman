import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Ban,
  CheckCircle2,
  KeyRound,
  LogOut,
  MoreHorizontal,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useConfirm } from '../context/ConfirmContext.jsx';
import { formatDate, timeAgo } from '../lib/format.js';
import {
  Checkbox,
  CopyButton,
  Dropdown,
  EmptyState,
  Field,
  Modal,
  PasswordInput,
  Select,
  Spinner,
} from '../components/ui.jsx';

const PASSWORD_ALPHABET =
  'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*';

function generatePassword(length = 20) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < length; i += 1) out += PASSWORD_ALPHABET[bytes[i] % PASSWORD_ALPHABET.length];
  return out;
}

const EMPTY_CREATE = {
  username: '',
  displayName: '',
  role: 'operator',
  password: '',
  mustChangePassword: true,
};

function UserAvatar({ user, size = 34 }) {
  const label = user.displayName || user.username;
  return (
    <span className="user-avatar" style={{ width: size, height: size, fontSize: size * 0.38 }}>
      {label.slice(0, 1).toUpperCase()}
    </span>
  );
}

export default function UsersPage() {
  const { user: me } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState(EMPTY_CREATE);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);

  const [resetUser, setResetUser] = useState(null);
  const [resetForm, setResetForm] = useState({ password: '', mustChangePassword: true });
  const [resetting, setResetting] = useState(false);

  const [credentials, setCredentials] = useState(null);

  const load = useCallback(async () => {
    try {
      const result = await api.get('/api/users');
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
  }, [load]);

  const roles = data?.roles || [];
  const users = data?.users || [];
  const roleById = useMemo(() => Object.fromEntries(roles.map((r) => [r.id, r])), [roles]);
  const counts = useMemo(
    () => ({
      total: users.length,
      active: users.filter((u) => !u.disabled).length,
      admins: users.filter((u) => u.role === 'admin' && !u.disabled).length,
    }),
    [users],
  );

  const roleOptions = roles.map((r) => ({ value: r.id, label: r.label }));

  const patchUser = async (target, patch, { success } = {}) => {
    setBusy(target.id);
    try {
      const result = await api.patch(`/api/users/${target.id}`, patch);
      toast.success(success || `${target.username} updated`);
      await load();
      return result.user;
    } catch (err) {
      toast.error(err.message, { title: `Could not update ${target.username}` });
      return null;
    } finally {
      setBusy(null);
    }
  };

  const changeRole = async (target, role) => {
    if (role === target.role) return;
    const roleMeta = roleById[role];
    const ok = await confirm({
      title: `Change ${target.username} to ${roleMeta?.label || role}?`,
      message:
        target.role === 'admin' && role !== 'admin'
          ? 'They will immediately lose administrator access. Their active sessions will be signed out.'
          : 'The new role takes effect immediately and their active sessions will be signed out.',
      confirmLabel: 'Change role',
      danger: target.role === 'admin' && role !== 'admin',
    });
    if (!ok) return;
    await patchUser(target, { role }, { success: `${target.username} is now ${roleMeta?.label || role}` });
  };

  const toggleDisabled = async (target) => {
    const disabling = !target.disabled;
    const ok = await confirm({
      title: disabling ? `Disable ${target.username}?` : `Enable ${target.username}?`,
      message: disabling
        ? 'The account cannot sign in and all of its sessions are revoked. Its data and audit history are kept.'
        : 'The account will be able to sign in again with its existing password.',
      confirmLabel: disabling ? 'Disable account' : 'Enable account',
      danger: disabling,
    });
    if (!ok) return;
    await patchUser(
      target,
      { disabled: disabling },
      { success: `${target.username} ${disabling ? 'disabled' : 'enabled'}` },
    );
  };

  const revokeSessions = async (target) => {
    const ok = await confirm({
      title: `Sign out ${target.username}?`,
      message: `All ${target.sessionCount} active session(s) for this account will be revoked. They can sign in again with their password.`,
      confirmLabel: 'Sign out everywhere',
      danger: false,
    });
    if (!ok) return;
    setBusy(target.id);
    try {
      const result = await api.post(`/api/users/${target.id}/logout`);
      toast.success(`${result.revoked} session(s) signed out`);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (target) => {
    const ok = await confirm({
      title: `Delete ${target.username}?`,
      message:
        'The account and its sessions are removed permanently. Audit history stays. Virtual machines are not affected.',
      confirmLabel: 'Delete account',
      danger: true,
    });
    if (!ok) return;
    setBusy(target.id);
    try {
      await api.del(`/api/users/${target.id}`);
      toast.success(`${target.username} deleted`);
      await load();
    } catch (err) {
      toast.error(err.message, { title: 'Could not delete account' });
    } finally {
      setBusy(null);
    }
  };

  const create = async (e) => {
    e.preventDefault();
    setCreateError(null);
    if (!createForm.password) {
      setCreateError('Set a password or generate one first');
      return;
    }
    setCreating(true);
    try {
      const result = await api.post('/api/users', {
        username: createForm.username,
        displayName: createForm.displayName,
        role: createForm.role,
        password: createForm.password,
        mustChangePassword: createForm.mustChangePassword,
      });
      setCreateOpen(false);
      const created = { ...createForm };
      setCreateForm(EMPTY_CREATE);
      await load();
      setCredentials({
        title: 'Account created',
        username: created.username,
        password: created.password,
        note: created.mustChangePassword
          ? 'Share this once. The user must choose a new password on their first sign-in.'
          : 'Share this once. The password is not shown again.',
      });
      toast.success(`${result.user.username} created`);
    } catch (err) {
      setCreateError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const resetPassword = async (e) => {
    e.preventDefault();
    if (!resetUser) return;
    setResetting(true);
    try {
      const result = await api.post(`/api/users/${resetUser.id}/password`, {
        password: resetForm.password || undefined,
        mustChangePassword: resetForm.mustChangePassword,
      });
      const target = resetUser;
      setResetUser(null);
      setResetForm({ password: '', mustChangePassword: true });
      await load();
      if (result.temporaryPassword) {
        setCredentials({
          title: 'Temporary password',
          username: target.username,
          password: result.temporaryPassword,
          note: resetForm.mustChangePassword
            ? 'Share this once. The user must choose a new password on their next sign-in.'
            : 'Share this once. It will not be shown again.',
        });
      } else {
        toast.success(`Password updated for ${target.username}`);
      }
    } catch (err) {
      toast.error(err.message, { title: 'Password not reset' });
    } finally {
      setResetting(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="page">
        <div className="splash" style={{ minHeight: '40vh' }}>
          <Spinner size={20} /> Loading users…
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="page">
        <EmptyState
          icon={<Users size={24} />}
          title="Could not load users"
          description={error}
          action={
            <button className="btn btn-primary" onClick={load}>
              <RefreshCw size={14} /> Retry
            </button>
          }
        />
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">
            Users &amp; roles <span className="badge">{counts.total}</span>
          </h1>
          <p className="page-sub">
            {counts.active} active · {counts.admins} administrator{counts.admins === 1 ? '' : 's'} ·{' '}
            role-based access to machines, consoles and host settings.
          </p>
        </div>
        <div className="page-actions">
          <button className="btn btn-ghost btn-sm" onClick={load} disabled={busy !== null}>
            <RefreshCw size={14} /> Refresh
          </button>
          <button className="btn btn-primary" onClick={() => setCreateOpen(true)}>
            <UserPlus size={15} /> Add user
          </button>
        </div>
      </div>

      <div className="role-grid">
        {roles.map((role) => {
          const members = users.filter((u) => u.role === role.id).length;
          return (
            <div className={`role-card tone-${role.tone || 'neutral'}`} key={role.id}>
              <div className="role-card-head">
                <span className="role-icon">
                  <ShieldCheck size={16} />
                </span>
                <div>
                  <h3>{role.label}</h3>
                  <span className="tiny muted-2">
                    {members} member{members === 1 ? '' : 's'}
                  </span>
                </div>
              </div>
              <p>{role.description}</p>
              <div className="role-perms">
                {(role.permissionDetails || []).slice(0, 5).map((permission) => (
                  <span className="perm-chip" key={permission.id} title={permission.description}>
                    {permission.id}
                  </span>
                ))}
                {(role.permissionDetails || []).length > 5 && (
                  <span className="perm-chip more">
                    +{role.permissionDetails.length - 5} more
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="card">
        <div className="card-head">
          <span className="card-title-icon">
            <Users size={15} />
          </span>
          <h3>Accounts</h3>
          <span className="muted">{users.length} total</span>
        </div>
        <div className="table-wrap" style={{ border: 'none', borderRadius: 0, boxShadow: 'none' }}>
          <table className="table">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Status</th>
                <th>Sessions</th>
                <th>Last sign-in</th>
                <th>Created</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const role = roleById[user.role] || { label: user.roleLabel, tone: 'neutral' };
                return (
                  <tr key={user.id}>
                    <td>
                      <div className="cell-main">
                        <UserAvatar user={user} />
                        <div style={{ minWidth: 0 }}>
                          <div className="cell-name">
                            {user.displayName || user.username}
                            {user.isSelf && <span className="badge accent self-badge">you</span>}
                          </div>
                          <div className="cell-sub">
                            @{user.username}
                            {user.mustChangePassword && (
                              <span className="badge warn" style={{ marginLeft: 6 }}>
                                password change required
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <Select
                        value={user.role}
                        options={roleOptions}
                        disabled={user.isSelf || busy === user.id}
                        onChange={(value) => changeRole(user, value)}
                        className="role-select"
                      />
                    </td>
                    <td>
                      {user.disabled ? (
                        <span className="status-pill tone-off">
                          <span className="status-dot" /> Disabled
                        </span>
                      ) : (
                        <span className="status-pill tone-ok">
                          <span className="status-dot" /> Active
                        </span>
                      )}
                    </td>
                    <td className="num">{user.sessionCount}</td>
                    <td className="tiny muted-2 nowrap">
                      {user.lastLoginAt ? timeAgo(user.lastLoginAt) : 'never'}
                    </td>
                    <td className="tiny muted-2 nowrap">{formatDate(user.createdAt)}</td>
                    <td className="actions-cell">
                      {busy === user.id ? (
                        <Spinner size={15} />
                      ) : (
                        <Dropdown
                          trigger={
                            <button className="icon-btn" aria-label={`Actions for ${user.username}`}>
                              <MoreHorizontal size={16} />
                            </button>
                          }
                          items={[
                            {
                              label: 'Reset password',
                              icon: <KeyRound size={14} />,
                              disabled: user.isSelf,
                              hint: user.isSelf ? 'use Account settings' : undefined,
                              onClick: () => {
                                setResetUser(user);
                                setResetForm({ password: '', mustChangePassword: true });
                              },
                            },
                            {
                              label: 'Sign out all sessions',
                              icon: <LogOut size={14} />,
                              disabled: user.sessionCount === 0,
                              onClick: () => revokeSessions(user),
                            },
                            {
                              label: user.disabled ? 'Enable account' : 'Disable account',
                              icon: user.disabled ? <CheckCircle2 size={14} /> : <Ban size={14} />,
                              disabled: user.isSelf,
                              onClick: () => toggleDisabled(user),
                            },
                            { divider: true },
                            {
                              label: 'Delete account',
                              icon: <Trash2 size={14} />,
                              danger: true,
                              disabled: user.isSelf,
                              onClick: () => remove(user),
                            },
                          ]}
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="card-body">
          <div className="alert alert-info" style={{ fontSize: 11.5 }}>
            <ShieldCheck size={14} />
            <span>
              Roles are enforced by the API and WebSocket proxies, not just this page. Viewers get
              view-only consoles and cannot SSH; operators manage machines; administrators also
              manage users, host settings and agent tokens. At least one active administrator is
              always required.
            </span>
          </div>
        </div>
      </div>

      {createOpen && (
        <Modal
          title="Add user"
        subtitle="Create an account and choose what it can do."
        icon={<UserPlus size={17} />}
        onClose={() => {
          setCreateOpen(false);
          setCreateError(null);
        }}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setCreateOpen(false)}>
              Cancel
            </button>
            <button className="btn btn-primary" type="submit" form="create-user-form" disabled={creating}>
              {creating ? <Spinner size={14} /> : <UserPlus size={14} />} Create account
            </button>
          </>
        }
      >
        <form id="create-user-form" className="form-stack" onSubmit={create}>
          {createError && <div className="alert alert-error">{createError}</div>}
          <div className="form-grid">
            <Field label="Username" hint="3-32 characters: letters, digits, dot, dash or underscore." required>
              <input
                className="input"
                value={createForm.username}
                onChange={(e) => setCreateForm((f) => ({ ...f, username: e.target.value }))}
                autoComplete="off"
                autoFocus
                required
                minLength={3}
                maxLength={32}
                pattern="[a-zA-Z0-9][a-zA-Z0-9_.\-]{2,31}"
              />
            </Field>
            <Field label="Display name" hint="Optional, shown in the sidebar and audit trail.">
              <input
                className="input"
                value={createForm.displayName}
                onChange={(e) => setCreateForm((f) => ({ ...f, displayName: e.target.value }))}
                maxLength={64}
              />
            </Field>
          </div>
          <Field label="Role" hint={roleById[createForm.role]?.description}>
            <Select
              value={createForm.role}
              onChange={(role) => setCreateForm((f) => ({ ...f, role }))}
              options={roleOptions}
            />
          </Field>
          <Field label="Initial password" hint="At least 8 characters. The user can change it after signing in." required>
            <div className="flex gap-8">
              <div style={{ flex: 1 }}>
                <PasswordInput
                  value={createForm.password}
                  onChange={(e) => setCreateForm((f) => ({ ...f, password: e.target.value }))}
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </div>
              <button
                type="button"
                className="btn"
                onClick={() => setCreateForm((f) => ({ ...f, password: generatePassword() }))}
              >
                <KeyRound size={14} /> Generate
              </button>
            </div>
          </Field>
          <Checkbox
            checked={createForm.mustChangePassword}
            onChange={(mustChangePassword) => setCreateForm((f) => ({ ...f, mustChangePassword }))}
            label="Require a password change at first sign-in"
          />
        </form>
        </Modal>
      )}

      {resetUser && (
        <Modal
          title={`Reset password for ${resetUser.username}`}
        subtitle="The account's existing sessions will be signed out."
        icon={<KeyRound size={17} />}
        onClose={() => setResetUser(null)}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setResetUser(null)}>
              Cancel
            </button>
            <button className="btn btn-primary" type="submit" form="reset-password-form" disabled={resetting}>
              {resetting ? <Spinner size={14} /> : <KeyRound size={14} />} Reset password
            </button>
          </>
        }
      >
        <form id="reset-password-form" className="form-stack" onSubmit={resetPassword}>
          <Field
            label="New password"
            hint="Leave blank to generate a strong temporary password. It is shown once after resetting."
          >
            <div className="flex gap-8">
              <div style={{ flex: 1 }}>
                <PasswordInput
                  value={resetForm.password}
                  onChange={(e) => setResetForm((f) => ({ ...f, password: e.target.value }))}
                  autoComplete="new-password"
                  minLength={8}
                />
              </div>
              <button
                type="button"
                className="btn"
                onClick={() => setResetForm((f) => ({ ...f, password: generatePassword() }))}
              >
                <KeyRound size={14} /> Generate
              </button>
            </div>
          </Field>
          <Checkbox
            checked={resetForm.mustChangePassword}
            onChange={(mustChangePassword) => setResetForm((f) => ({ ...f, mustChangePassword }))}
            label="Require a password change at next sign-in"
          />
          <div className="alert alert-warn" style={{ fontSize: 11.5 }}>
            <ShieldCheck size={14} />
            <span>
              Resetting a password immediately revokes every session for this account. Share the
              new password over a trusted channel.
            </span>
          </div>
        </form>
        </Modal>
      )}

      {credentials && (
        <Modal
          title={credentials.title}
          subtitle="Copy these now — the password is not stored in readable form."
          icon={<KeyRound size={17} />}
          onClose={() => setCredentials(null)}
          footer={
            <button className="btn btn-primary" onClick={() => setCredentials(null)}>
              Done
            </button>
          }
        >
          <div className="form-stack">
            <div className="credential-box">
              <div>
                <span className="tiny muted-2">USERNAME</span>
                <div className="mono">{credentials.username}</div>
              </div>
              <div>
                <span className="tiny muted-2">PASSWORD</span>
                <div className="flex items-center gap-8">
                  <code className="mono credential-password">{credentials.password}</code>
                  <CopyButton value={credentials.password} label="Copy" />
                </div>
              </div>
            </div>
            <div className="alert alert-info" style={{ fontSize: 11.5 }}>
              <ShieldCheck size={14} />
              <span>{credentials.note}</span>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
