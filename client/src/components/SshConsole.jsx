import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import {
  Expand,
  KeyRound,
  Lock,
  Plug,
  RefreshCw,
  ShieldCheck,
  TerminalSquare,
  Unplug,
  Upload,
  User,
} from 'lucide-react';
import { api, wsUrl } from '../lib/api.js';
import { b64ToBytes, strToB64 } from '../lib/b64.js';
import { useToast } from '../context/ToastContext.jsx';
import { Field, PasswordInput, Spinner, StatusPill } from './ui.jsx';

const TERM_THEME = {
  background: '#05080f',
  foreground: '#c6d6e8',
  cursor: '#2ee6b0',
  cursorAccent: '#04120e',
  selectionBackground: 'rgba(46, 230, 176, 0.28)',
  black: '#0b1220',
  red: '#ff8585',
  green: '#4fe3b4',
  yellow: '#ffd37a',
  blue: '#6db9ff',
  magenta: '#c9a4ff',
  cyan: '#63e8f0',
  white: '#d6e2f0',
  brightBlack: '#5b6f8a',
  brightRed: '#ff9f9f',
  brightGreen: '#6df0c4',
  brightYellow: '#ffe0a1',
  brightBlue: '#93ccff',
  brightMagenta: '#d9bdff',
  brightCyan: '#8cf1f6',
  brightWhite: '#f0f6ff',
};

export default function SshConsole({
  vmId = null,
  defaults = {},
  compact = false,
  autoFocus = false,
  onConnected,
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    host: defaults.host || '',
    port: defaults.port || 22,
    username: defaults.username || 'root',
    authMode: 'password',
    password: '',
    privateKey: '',
    save: false,
  });
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);
  const [fingerprint, setFingerprint] = useState(null);
  const [session, setSession] = useState(null);
  const [savedPassword, setSavedPassword] = useState(Boolean(defaults.hasSavedPassword));
  const [keyFileName, setKeyFileName] = useState(null);

  const termRef = useRef(null);
  const fitRef = useRef(null);
  const containerRef = useRef(null);
  const wrapperRef = useRef(null);
  const wsRef = useRef(null);
  const statusRef = useRef('idle');
  const sizeRef = useRef({ cols: 80, rows: 24 });

  useEffect(() => {
    setForm((f) => ({
      ...f,
      host: defaults.host ?? f.host,
      port: defaults.port ?? f.port,
      username: defaults.username ?? f.username,
    }));
    setSavedPassword(Boolean(defaults.hasSavedPassword));
  }, [defaults.host, defaults.port, defaults.username, defaults.hasSavedPassword]);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  useEffect(() => {
    const term = new Terminal({
      theme: TERM_THEME,
      fontFamily: 'ui-monospace, "JetBrains Mono", "SF Mono", Menlo, Consolas, monospace',
      fontSize: compact ? 12 : 12.5,
      lineHeight: 1.25,
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback: 6000,
      convertEol: false,
      allowTransparency: true,
      macOptionIsMeta: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(containerRef.current);
    termRef.current = term;
    fitRef.current = fit;
    try {
      fit.fit();
    } catch {
      /* ignore */
    }
    sizeRef.current = { cols: term.cols, rows: term.rows };

    term.onData((data) => {
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN && statusRef.current === 'ready') {
        ws.send(JSON.stringify({ type: 'input', data: strToB64(data) }));
      }
    });
    term.onResize(({ cols, rows }) => {
      sizeRef.current = { cols, rows };
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols, rows }));
      }
    });

    const observer = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        /* ignore */
      }
    });
    if (wrapperRef.current) observer.observe(wrapperRef.current);
    if (autoFocus) setTimeout(() => term.focus(), 300);

    return () => {
      observer.disconnect();
      try {
        wsRef.current?.close();
      } catch {
        /* ignore */
      }
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setStatusSafe = (next) => {
    statusRef.current = next;
    setStatus(next);
  };

  const disconnect = useCallback(() => {
    try {
      wsRef.current?.send(JSON.stringify({ type: 'disconnect' }));
    } catch {
      /* ignore */
    }
    try {
      wsRef.current?.close(1000, 'client disconnect');
    } catch {
      /* ignore */
    }
    wsRef.current = null;
    setStatusSafe('idle');
  }, []);

  const connect = useCallback(() => {
    const host = form.host.trim();
    const port = Number(form.port) || 22;
    if (!host) {
      setError('Enter a host name or address');
      return;
    }
    if (!form.username.trim()) {
      setError('Enter a username');
      return;
    }
    if (form.authMode === 'password' && !form.password && !(vmId && savedPassword)) {
      setError('Enter a password, or use the saved credentials');
      return;
    }
    if (form.authMode === 'key' && !form.privateKey.trim()) {
      setError('Paste an OpenSSH private key');
      return;
    }
    setError(null);
    setFingerprint(null);
    try {
      wsRef.current?.close();
    } catch {
      /* ignore */
    }
    const term = termRef.current;
    term?.reset();
    term?.write(`\x1b[90mConnecting to ${form.username}@${host}:${port}…\x1b[0m\r\n`);
    setStatusSafe('connecting');

    const ws = new WebSocket(wsUrl('/ws/ssh'));
    wsRef.current = ws;

    ws.onopen = () => {
      const { cols, rows } = sizeRef.current;
      ws.send(
        JSON.stringify({
          type: 'connect',
          vmId,
          host,
          port,
          username: form.username.trim(),
          password: form.authMode === 'password' ? form.password || undefined : undefined,
          privateKey: form.authMode === 'key' ? form.privateKey : undefined,
          cols,
          rows,
        }),
      );
    };

    ws.onmessage = async (event) => {
      if (wsRef.current !== ws) return;
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (msg.type === 'status') {
        if (msg.status === 'connecting') {
          setStatusSafe('connecting');
        } else if (msg.status === 'ready') {
          setStatusSafe('ready');
          setSession({ host, port, username: form.username.trim() });
          toast.success(`SSH session established with ${host}`);
          onConnected?.();
          setTimeout(() => termRef.current?.focus(), 60);
          if (vmId && form.save && form.authMode === 'password' && form.password) {
            try {
              await api.post(`/api/vms/${vmId}/ssh-credentials`, {
                username: form.username.trim(),
                password: form.password,
              });
              setSavedPassword(true);
              toast.success('SSH password saved for this VM');
            } catch (err) {
              toast.error(`Could not save credentials: ${err.message}`);
            }
          }
        } else if (msg.status === 'error') {
          setStatusSafe('error');
          setError(msg.message || 'SSH connection failed');
        } else if (msg.status === 'closed') {
          if (statusRef.current !== 'error') setStatusSafe('closed');
        }
      } else if (msg.type === 'data') {
        termRef.current?.write(b64ToBytes(msg.data));
      } else if (msg.type === 'hostkey') {
        setFingerprint(msg);
        if (!msg.trusted) {
          setError('Host key mismatch. The server key changed since the last connection.');
        }
      }
    };

    ws.onerror = () => {
      if (wsRef.current !== ws) return;
      setStatusSafe('error');
      setError('Could not reach the emuman WebSocket bridge');
    };
    ws.onclose = () => {
      if (wsRef.current !== ws) return;
      wsRef.current = null;
      if (statusRef.current === 'connecting') {
        setStatusSafe('error');
        setError((prev) => prev || 'The SSH bridge closed the connection');
      } else if (statusRef.current === 'ready') {
        setStatusSafe('closed');
        termRef.current?.write('\r\n\x1b[90m[connection closed]\x1b[0m\r\n');
      }
    };
  }, [form, vmId, savedPassword, toast, onConnected]);

  const fullscreen = () => {
    const el = wrapperRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else el.requestFullscreen?.();
  };

  const statusPill =
    status === 'ready'
      ? { status: 'running', label: 'connected' }
      : status === 'connecting'
        ? { status: 'starting', label: 'connecting' }
        : status === 'error'
          ? { status: 'error', label: 'error' }
          : status === 'closed'
            ? { status: 'paused', label: 'closed' }
            : { status: 'stopped', label: 'idle' };

  const readKeyFile = async (file) => {
    if (!file) return;
    const text = await file.text();
    set({ privateKey: text });
    setKeyFileName(file.name);
  };

  return (
    <div className="console-connect">
      <div className="console-card" ref={wrapperRef} style={{ minWidth: 0 }}>
        <div className="console-toolbar">
          <span className="title">
            <TerminalSquare size={14} />
            SSH session
            <StatusPill status={statusPill.status} label={statusPill.label} pulse={status === 'ready'} />
          </span>
          {session && (
            <span className="badge" style={{ marginLeft: 2 }}>
              {session.username}@{session.host}:{session.port}
            </span>
          )}
          <span className="spacer" />
          <button className="btn btn-sm" onClick={connect} disabled={status === 'connecting'} title="Connect / reconnect">
            <RefreshCw size={13} /> <span className="hide-sm">Reconnect</span>
          </button>
          <button
            className="btn btn-sm"
            onClick={disconnect}
            disabled={status !== 'ready' && status !== 'connecting'}
          >
            <Unplug size={13} /> <span className="hide-sm">Disconnect</span>
          </button>
          <button
            className="btn btn-sm"
            onClick={() => {
              termRef.current?.clear();
              termRef.current?.focus();
            }}
          >
            Clear
          </button>
          <button className="btn btn-sm" onClick={fullscreen} title="Fullscreen">
            <Expand size={13} />
          </button>
        </div>
        <div className="console-surface terminal-surface" style={{ height: compact ? 460 : 'min(66vh, 680px)' }}>
          <div ref={containerRef} style={{ height: '100%', width: '100%' }} />
          {status !== 'ready' && (
            <div className="console-overlay" style={{ gap: 8, pointerEvents: 'none' }}>
              {status === 'connecting' ? (
                <>
                  <Spinner size={22} />
                  <h3>Opening secure shell</h3>
                  <p>Handshaking with the target and requesting a PTY…</p>
                </>
              ) : status === 'error' ? (
                <>
                  <Plug size={22} style={{ color: 'var(--danger)' }} />
                  <h3>Connection failed</h3>
                  <p>{error}</p>
                  <button
                    className="btn btn-sm"
                    style={{ pointerEvents: 'auto', marginTop: 6 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      connect();
                    }}
                  >
                    <RefreshCw size={13} /> Try again
                  </button>
                </>
              ) : (
                <>
                  <TerminalSquare size={22} style={{ color: 'var(--muted-2)' }} />
                  <h3>Not connected</h3>
                  <p>Fill in the target on the right, then start the session.</p>
                </>
              )}
            </div>
          )}
          {status === 'ready' && (
            <span className="console-badge" style={{ pointerEvents: 'none' }}>
              xterm · ssh2
            </span>
          )}
        </div>
      </div>

      <div className="console-connect-side">
        <div className="card">
          <div className="card-head">
            <span className="card-title-icon">
              <Lock size={14} />
            </span>
            <h3>Connection</h3>
            {savedPassword && <span className="badge accent">saved password</span>}
          </div>
          <div className="card-body">
            {error && (
              <div className="alert alert-error mb-16" style={{ fontSize: 11.5 }}>
                {error}
              </div>
            )}
            <div className="form-stack" style={{ gap: 12 }}>
              <div className="form-grid" style={{ gap: 10 }}>
                <Field label="Host">
                  <input
                    className="input mono"
                    value={form.host}
                    onChange={(e) => set({ host: e.target.value })}
                    placeholder="127.0.0.1"
                    disabled={status === 'ready'}
                  />
                </Field>
                <Field label="Port">
                  <input
                    className="input mono"
                    type="number"
                    min={1}
                    max={65535}
                    value={form.port}
                    onChange={(e) => set({ port: e.target.value })}
                    disabled={status === 'ready'}
                  />
                </Field>
              </div>
              <Field label="Username">
                <div style={{ position: 'relative' }}>
                  <input
                    className="input"
                    value={form.username}
                    onChange={(e) => set({ username: e.target.value })}
                    disabled={status === 'ready'}
                    style={{ paddingLeft: 32 }}
                  />
                  <User
                    size={14}
                    style={{ position: 'absolute', left: 10, top: 11, color: 'var(--muted-2)' }}
                  />
                </div>
              </Field>

              <div className="segmented" style={{ width: '100%' }}>
                <button
                  type="button"
                  className={form.authMode === 'password' ? 'active' : ''}
                  onClick={() => set({ authMode: 'password' })}
                  style={{ flex: 1, justifyContent: 'center' }}
                >
                  <Lock size={12} /> Password
                </button>
                <button
                  type="button"
                  className={form.authMode === 'key' ? 'active' : ''}
                  onClick={() => set({ authMode: 'key' })}
                  style={{ flex: 1, justifyContent: 'center' }}
                >
                  <KeyRound size={12} /> Private key
                </button>
              </div>

              {form.authMode === 'password' ? (
                <Field
                  label="Password"
                  hint={
                    vmId && savedPassword
                      ? 'Leave blank to use the password saved for this VM.'
                      : undefined
                  }
                >
                  <PasswordInput
                    value={form.password}
                    onChange={(e) => set({ password: e.target.value })}
                    autoComplete="off"
                    placeholder={savedPassword ? '•••••••• (saved)' : 'SSH password'}
                    disabled={status === 'ready'}
                  />
                </Field>
              ) : (
                <Field label="Private key" hint="OpenSSH format. The key is sent to the SSH client over the authenticated WebSocket.">
                  <textarea
                    className="input mono"
                    rows={5}
                    placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                    value={form.privateKey}
                    onChange={(e) => {
                      set({ privateKey: e.target.value });
                      setKeyFileName(null);
                    }}
                    disabled={status === 'ready'}
                    style={{ fontSize: 10.5 }}
                  />
                  <div className="flex items-center gap-8" style={{ marginTop: 4 }}>
                    <label className="btn btn-sm btn-ghost" style={{ cursor: 'pointer' }}>
                      <Upload size={12} /> {keyFileName || 'Load key file'}
                      <input
                        type="file"
                        hidden
                        onChange={(e) => readKeyFile(e.target.files?.[0])}
                        disabled={status === 'ready'}
                      />
                    </label>
                  </div>
                </Field>
              )}

              {vmId && form.authMode === 'password' && (
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={form.save}
                    onChange={(e) => set({ save: e.target.checked })}
                    disabled={status === 'ready'}
                  />
                  <span className="checkbox-box">{form.save && <ShieldCheck size={12} />}</span>
                  <span>Remember password for this VM</span>
                </label>
              )}

              <button
                className="btn btn-primary btn-block"
                onClick={status === 'ready' ? disconnect : connect}
                disabled={status === 'connecting'}
              >
                {status === 'connecting' ? (
                  <Spinner size={14} />
                ) : status === 'ready' ? (
                  <Unplug size={14} />
                ) : (
                  <Plug size={14} />
                )}
                {status === 'connecting' ? 'Connecting…' : status === 'ready' ? 'Disconnect' : 'Connect'}
              </button>

              {fingerprint && (
                <div className="tiny muted-2 mono" style={{ lineHeight: 1.5 }}>
                  Host key {fingerprint.trusted ? 'trusted' : 'MISMATCH'}: {fingerprint.fingerprint}
                  {fingerprint.firstSeen && ' (newly pinned)'}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="console-hint">
          <ShieldCheck size={14} />
          <span>
            The SSH connection originates from the emuman <strong>server</strong>, not your browser.
            Use an address reachable from the host — for guests with user-mode networking, the
            127.0.0.1 forwards work.
          </span>
        </div>
        {defaults.note && (
          <div className="console-hint">
            <TerminalSquare size={14} />
            <span>{defaults.note}</span>
          </div>
        )}
      </div>
    </div>
  );
}
