import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, UserPlus } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { PasswordInput, Spinner } from '../components/ui.jsx';
import { AuthArt } from './Login.jsx';

export default function Setup() {
  const { refresh, version } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: 'admin', password: '', confirm: '' });
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (form.password.length < 8) {
      setError('Choose a password with at least 8 characters');
      return;
    }
    if (form.password !== form.confirm) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      await api.post('/api/auth/setup', { username: form.username, password: form.password });
      await refresh();
      toast.success('Administrator account created');
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const strength = Math.min(4, Math.floor(form.password.length / 4));

  return (
    <div className="auth-shell">
      <AuthArt version={version} />
      <div className="auth-form-side">
        <div className="auth-card">
          <div className="auth-mobile-brand">
            <span className="brand-mark">e</span>
            <span className="brand-name">
              emu<span>man</span>
            </span>
          </div>
          <h2>Create your account</h2>
          <p className="auth-sub">
            This is the first launch. Set up the administrator account that will manage this host.
          </p>

          <form className="auth-form" onSubmit={submit}>
            {error && <div className="alert alert-error">{error}</div>}
            <label className="field">
              <span className="field-label">Username</span>
              <input
                className="input"
                value={form.username}
                onChange={(e) => set({ username: e.target.value })}
                autoComplete="username"
                autoFocus
                required
                minLength={3}
                maxLength={32}
                pattern="[a-zA-Z0-9][a-zA-Z0-9_.\-]{2,31}"
              />
              <span className="field-hint">Letters, digits, dot, dash or underscore</span>
            </label>
            <label className="field">
              <span className="field-label">Password</span>
              <PasswordInput
                value={form.password}
                onChange={(e) => set({ password: e.target.value })}
                autoComplete="new-password"
                required
                minLength={8}
              />
            </label>
            {form.password && (
              <div className="password-strength">
                {[0, 1, 2, 3].map((i) => (
                  <span key={i} className={i < strength ? 'filled' : ''} />
                ))}
                <em>{['weak', 'fair', 'good', 'strong'][Math.max(0, strength - 1)]}</em>
              </div>
            )}
            <label className="field">
              <span className="field-label">Confirm password</span>
              <PasswordInput
                value={form.confirm}
                onChange={(e) => set({ confirm: e.target.value })}
                autoComplete="new-password"
                required
              />
            </label>
            <button className="btn btn-primary btn-block" type="submit" disabled={loading} style={{ marginTop: 4 }}>
              {loading ? <Spinner size={15} /> : <UserPlus size={15} />}
              {loading ? 'Creating account…' : 'Create administrator'}
            </button>
          </form>

          <div className="auth-foot">
            <ShieldCheck size={12} style={{ verticalAlign: '-2px', marginRight: 5 }} />
            Credentials are stored locally with scrypt hashing. Sessions last 30 days.
          </div>
        </div>
      </div>
    </div>
  );
}
