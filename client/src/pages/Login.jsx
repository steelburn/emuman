import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { LogIn, MonitorPlay, Server, TerminalSquare, ShieldCheck, Cpu } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { PasswordInput, Spinner } from '../components/ui.jsx';

export function AuthArt({ version }) {
  return (
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
          Your machines.
          <br />
          <span>One console.</span>
        </h1>
        <p>
          A self-hosted manager for KVM/QEMU. Boot, inspect and operate virtual machines from the
          browser — with VNC, SSH and serial access built in.
        </p>
        <div className="auth-features">
          <div className="auth-feature">
            <span className="auth-feature-icon">
              <MonitorPlay size={15} />
            </span>
            Browser VNC console, no client plugins
          </div>
          <div className="auth-feature">
            <span className="auth-feature-icon">
              <TerminalSquare size={15} />
            </span>
            Integrated SSH terminal and serial console
          </div>
          <div className="auth-feature">
            <span className="auth-feature-icon">
              <Cpu size={15} />
            </span>
            Live CPU, memory and storage telemetry
          </div>
          <div className="auth-feature">
            <span className="auth-feature-icon">
              <ShieldCheck size={15} />
            </span>
            QMP-native control — no libvirt daemon required
          </div>
        </div>
      </div>

      <div className="auth-art-foot">
        <span>emuman {version || '1.0.0'}</span>
        <span>QEMU/KVM</span>
        <span>self-hosted</span>
      </div>
    </div>
  );
}

export default function Login() {
  const { refresh, version } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.post('/api/auth/login', { username, password });
      await refresh();
      toast.success('Welcome back');
      navigate(location.state?.from || '/', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

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
          <h2>Sign in</h2>
          <p className="auth-sub">Access your virtual infrastructure.</p>

          <form className="auth-form" onSubmit={submit}>
            {error && <div className="alert alert-error">{error}</div>}
            <label className="field">
              <span className="field-label">Username</span>
              <input
                className="input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoFocus
                required
              />
            </label>
            <label className="field">
              <span className="field-label">Password</span>
              <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} required />
            </label>
            <button className="btn btn-primary btn-block" type="submit" disabled={loading} style={{ marginTop: 4 }}>
              {loading ? <Spinner size={15} /> : <LogIn size={15} />}
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <div className="auth-foot">
            <Server size={12} style={{ verticalAlign: '-2px', marginRight: 5 }} />
            Protected by a local session cookie. Accounts are managed on this host.
          </div>
        </div>
      </div>
    </div>
  );
}
