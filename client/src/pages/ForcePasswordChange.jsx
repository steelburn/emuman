import { useState } from 'react';
import { KeyRound, LogOut, ShieldCheck } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { PasswordInput, Spinner } from '../components/ui.jsx';

export default function ForcePasswordChange() {
  const { user, refresh, logout } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (form.next.length < 8) {
      setError('Choose a password with at least 8 characters');
      return;
    }
    if (form.next !== form.confirm) {
      setError('New passwords do not match');
      return;
    }
    setSaving(true);
    try {
      await api.post('/api/auth/password', {
        currentPassword: form.current,
        newPassword: form.next,
      });
      await refresh();
      toast.success('Password updated');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="auth-shell">
      <div className="auth-art">
        <div className="auth-brand">
          <span className="brand-mark">e</span>
          <span className="brand-text">
            <span className="brand-name">
              emu<span>man</span>
            </span>
            <span className="brand-sub">KVM control plane</span>
          </span>
        </div>
        <div className="auth-headline">
          <h1>
            One last step,
            <br />
            <span>{user?.displayName || user?.username}.</span>
          </h1>
          <p>
            An administrator created or reset this account with a temporary password. Set your own
            password to unlock the rest of emuman.
          </p>
          <div className="auth-features">
            <div className="auth-feature">
              <span className="auth-feature-icon">
                <ShieldCheck size={15} />
              </span>
              Passwords are hashed with scrypt and never stored in plain text
            </div>
            <div className="auth-feature">
              <span className="auth-feature-icon">
                <KeyRound size={15} />
              </span>
              Other sessions are signed out when a password changes
            </div>
          </div>
        </div>
        <div className="auth-art-foot">
          <span>{user?.roleLabel || user?.role}</span>
          <span>account secured</span>
        </div>
      </div>

      <div className="auth-form-side">
        <div className="auth-card">
          <div className="auth-mobile-brand">
            <span className="brand-mark">e</span>
            <span className="brand-name">
              emu<span>man</span>
            </span>
          </div>
          <h2>Set a new password</h2>
          <p className="auth-sub">
            Signed in as <strong>{user?.username}</strong>. Enter the temporary password and choose a
            new one.
          </p>

          <form className="auth-form" onSubmit={submit}>
            {error && <div className="alert alert-error">{error}</div>}
            <label className="field">
              <span className="field-label">Temporary password</span>
              <PasswordInput
                value={form.current}
                onChange={(e) => set({ current: e.target.value })}
                autoComplete="current-password"
                autoFocus
                required
              />
            </label>
            <label className="field">
              <span className="field-label">New password</span>
              <PasswordInput
                value={form.next}
                onChange={(e) => set({ next: e.target.value })}
                autoComplete="new-password"
                required
                minLength={8}
              />
              <span className="field-hint">At least 8 characters.</span>
            </label>
            <label className="field">
              <span className="field-label">Confirm new password</span>
              <PasswordInput
                value={form.confirm}
                onChange={(e) => set({ confirm: e.target.value })}
                autoComplete="new-password"
                required
              />
            </label>
            <button className="btn btn-primary btn-block" type="submit" disabled={saving} style={{ marginTop: 4 }}>
              {saving ? <Spinner size={15} /> : <KeyRound size={15} />}
              {saving ? 'Updating…' : 'Update password'}
            </button>
          </form>

          <button
            className="btn btn-ghost btn-block"
            style={{ marginTop: 10 }}
            onClick={async () => {
              await logout();
              window.location.assign('/login');
            }}
          >
            <LogOut size={14} /> Sign out instead
          </button>
        </div>
      </div>
    </div>
  );
}
