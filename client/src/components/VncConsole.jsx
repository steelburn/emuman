import { useCallback, useEffect, useRef, useState } from 'react';
import RFB from '@novnc/novnc';
import {
  Camera,
  Download,
  Expand,
  Keyboard,
  Play,
  Power,
  RefreshCw,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { wsUrl } from '../lib/api.js';
import { Spinner } from './ui.jsx';

export default function VncConsole({ vmId, vm, running, onStart, viewOnly = false }) {
  const containerRef = useRef(null);
  const cardRef = useRef(null);
  const rfbRef = useRef(null);
  const [state, setState] = useState('idle');
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);

  const disconnect = useCallback(() => {
    const rfb = rfbRef.current;
    rfbRef.current = null;
    if (rfb) {
      try {
        rfb.disconnect();
      } catch {
        /* ignore */
      }
    }
  }, []);

  const connect = useCallback(() => {
    if (!containerRef.current) return;
    disconnect();
    setError(null);
    setInfo(null);
    setState('connecting');
    const rfb = new RFB(containerRef.current, wsUrl(`/ws/vnc/${vmId}`), {
      wsProtocols: ['binary'],
    });
    rfb.scaleViewport = true;
    rfb.resizeSession = false;
    rfb.clipViewport = false;
    rfb.showDotCursor = !viewOnly;
    rfb.viewOnly = viewOnly;
    rfb.background = '#05080f';
    rfb.qualityLevel = 6;
    rfb.compressionLevel = 2;

    rfb.addEventListener('connect', (e) => {
      setState('connected');
      setInfo(e.detail);
    });
    rfb.addEventListener('disconnect', (e) => {
      setState('disconnected');
      if (!e.detail?.clean) setError('The VNC session was closed unexpectedly.');
    });
    rfb.addEventListener('securityfailure', (e) => {
      setState('error');
      setError(e.detail?.reason || 'VNC security handshake failed');
    });
    rfb.addEventListener('credentialsrequired', () => {
      setState('error');
      setError('The console requested credentials that are not configured.');
    });
    rfbRef.current = rfb;
  }, [vmId, disconnect, viewOnly]);

  useEffect(() => {
    if (running) connect();
    return disconnect;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vmId, running]);

  useEffect(() => {
    return () => disconnect();
  }, [disconnect]);

  const fullscreen = () => {
    const el = cardRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else el.requestFullscreen?.();
  };

  const screenshot = () => {
    const canvas = containerRef.current?.querySelector('canvas');
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `${(vm?.name || 'vm').replace(/\s+/g, '-')}-console.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  return (
    <div className="console-card" ref={cardRef}>
      <div className="console-toolbar">
        <span className="title">
          {state === 'connected' ? <Wifi size={14} style={{ color: 'var(--accent)' }} /> : <WifiOff size={14} />}
          VNC console
          <span className="badge" style={{ marginLeft: 4 }}>
            {vm?.vncPort ? `127.0.0.1:${vm.vncPort}` : '—'}
          </span>
          {viewOnly && <span className="badge warn">view-only</span>}
        </span>
        <span className="spacer" />
        <span className="muted-2 tiny hide-sm" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <Keyboard size={12} /> {viewOnly ? 'read-only role — input is disabled' : 'click the screen to capture input'}
        </span>
        <button
          className="btn btn-sm"
          onClick={() => rfbRef.current?.sendCtrlAltDel()}
          disabled={state !== 'connected' || viewOnly}
          title={viewOnly ? 'Your role does not allow console input' : 'Send Ctrl+Alt+Delete'}
        >
          <Power size={13} /> Ctrl+Alt+Del
        </button>
        <button className="btn btn-sm" onClick={screenshot} disabled={state !== 'connected'} title="Save screenshot">
          <Camera size={13} /> <span className="hide-sm">Screenshot</span>
        </button>
        <button className="btn btn-sm" onClick={connect} disabled={!running} title="Reconnect">
          <RefreshCw size={13} />
        </button>
        <button className="btn btn-sm" onClick={fullscreen} title="Fullscreen">
          <Expand size={13} />
        </button>
      </div>

      <div className="console-surface">
        <div className="vnc-container" ref={containerRef} />
        {state === 'connected' && <span className="console-badge">RFB · {info?.name || 'connected'}</span>}

        {!running && (
          <div className="console-overlay">
            <span className="stat-icon" style={{ width: 44, height: 44 }}>
              <Power size={20} />
            </span>
            <h3>Console offline</h3>
            <p>Start the machine to attach a VNC session to its virtual display.</p>
            {onStart && (
              <button className="btn btn-primary" onClick={onStart}>
                <Play size={14} /> Start machine
              </button>
            )}
          </div>
        )}

        {running && state === 'connecting' && (
          <div className="console-overlay">
            <Spinner size={26} />
            <h3>Attaching console</h3>
            <p>Negotiating the VNC session with QEMU…</p>
          </div>
        )}

        {running && state === 'disconnected' && (
          <div className="console-overlay">
            <WifiOff size={26} style={{ color: 'var(--warn)' }} />
            <h3>Session disconnected</h3>
            <p>{error || 'Reconnect to resume the console.'}</p>
            <button className="btn btn-primary" onClick={connect}>
              <RefreshCw size={14} /> Reconnect
            </button>
          </div>
        )}

        {running && state === 'error' && (
          <div className="console-overlay">
            <WifiOff size={26} style={{ color: 'var(--danger)' }} />
            <h3>Console error</h3>
            <p>{error}</p>
            <button className="btn btn-primary" onClick={connect}>
              <RefreshCw size={14} /> Try again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
