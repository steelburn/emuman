import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { Download, Expand, RefreshCw, TerminalSquare, Wifi, WifiOff } from 'lucide-react';
import { wsUrl } from '../lib/api.js';
import { Spinner } from './ui.jsx';

const THEME = {
  background: '#05080f',
  foreground: '#bff3db',
  cursor: '#2ee6b0',
  cursorAccent: '#04120e',
  selectionBackground: 'rgba(46, 230, 176, 0.25)',
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

export default function SerialConsole({ vmId, running, compact = false, height = 560, readOnly = false }) {
  const [state, setState] = useState('idle');
  const [error, setError] = useState(null);
  const [buffered, setBuffered] = useState('');
  const termRef = useRef(null);
  const fitRef = useRef(null);
  const containerRef = useRef(null);
  const cardRef = useRef(null);
  const wsRef = useRef(null);
  const bufferRef = useRef('');
  const stateRef = useRef('idle');
  const readOnlyRef = useRef(readOnly);

  useEffect(() => {
    readOnlyRef.current = readOnly;
    if (termRef.current) termRef.current.options.disableStdin = readOnly;
  }, [readOnly]);

  const setStateSafe = (next) => {
    stateRef.current = next;
    setState(next);
  };

  useEffect(() => {
    const term = new Terminal({
      theme: THEME,
      fontFamily: 'ui-monospace, "JetBrains Mono", "SF Mono", Menlo, Consolas, monospace',
      fontSize: compact ? 12 : 12.5,
      lineHeight: 1.25,
      cursorBlink: true,
      scrollback: 8000,
      convertEol: false,
      allowTransparency: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    termRef.current = term;
    fitRef.current = fit;
    fit.fit();
    term.onData((data) => {
      if (readOnlyRef.current) return;
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        // Serial terminals use CR for Enter; send the raw key stream.
        ws.send(new TextEncoder().encode(data));
      }
    });
    const observer = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        /* ignore */
      }
    });
    if (containerRef.current) observer.observe(containerRef.current);
    return () => {
      observer.disconnect();
      wsRef.current?.close();
      wsRef.current = null;
      term.dispose();
      termRef.current = null;
    };
  }, []);

  const connect = useCallback(() => {
    if (!running) {
      setStateSafe('idle');
      return;
    }
    try {
      wsRef.current?.close();
    } catch {
      /* ignore */
    }
    setError(null);
    setStateSafe('connecting');
    termRef.current?.reset();
    const ws = new WebSocket(wsUrl(`/ws/serial/${vmId}`));
    wsRef.current = ws;
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      if (wsRef.current === ws) setStateSafe('connected');
    };
    ws.onmessage = (event) => {
      if (wsRef.current !== ws) return;
      if (typeof event.data === 'string') {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        if (msg.type === 'history') {
          termRef.current?.write(msg.data);
          bufferRef.current = (bufferRef.current + msg.data).slice(-200000);
        } else if (msg.type === 'status') {
          if (msg.status === 'connected') setStateSafe('connected');
          if (msg.status === 'offline') {
            setStateSafe('offline');
            setError(msg.message || 'Serial console is not available');
          }
          if (msg.status === 'error') {
            setStateSafe('error');
            setError(msg.message || 'Serial connection failed');
          }
        } else if (msg.type === 'error') {
          setStateSafe('error');
          setError(msg.message);
        }
        return;
      }
      const bytes = new Uint8Array(event.data);
      termRef.current?.write(bytes);
      const text = new TextDecoder().decode(bytes);
      bufferRef.current = (bufferRef.current + text).slice(-200000);
      setBuffered(bufferRef.current);
    };
    ws.onerror = () => {
      if (wsRef.current !== ws) return;
      setStateSafe('error');
      setError('Could not connect to the serial console socket');
    };
    ws.onclose = () => {
      if (wsRef.current !== ws) return;
      wsRef.current = null;
      if (stateRef.current === 'connected' || stateRef.current === 'connecting') {
        setStateSafe('closed');
      }
    };
  }, [vmId, running]);

  useEffect(() => {
    if (running) connect();
    else {
      try {
        wsRef.current?.close();
      } catch {
        /* ignore */
      }
      wsRef.current = null;
      setStateSafe('idle');
    }
    return () => {
      try {
        wsRef.current?.close();
      } catch {
        /* ignore */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, vmId]);

  const fullscreen = () => {
    const el = cardRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else el.requestFullscreen?.();
  };

  const download = () => {
    const blob = new Blob([bufferRef.current || ''], { type: 'text/plain' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'serial-console.log';
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 2000);
  };

  const online = state === 'connected';

  return (
    <div className="console-card" ref={cardRef}>
      <div className="console-toolbar">
        <span className="title">
          {online ? <Wifi size={14} style={{ color: 'var(--accent)' }} /> : <WifiOff size={14} />}
          Serial console
          <span className={`status-pill ${online ? 'tone-ok' : state === 'error' ? 'tone-error' : 'tone-off'}`}>
            <span className="status-dot" />
            {state === 'connected'
              ? 'connected'
              : state === 'connecting'
                ? 'connecting'
                : state === 'closed'
                  ? 'closed'
                  : state === 'error'
                    ? 'error'
                    : state === 'offline'
                      ? 'offline'
                      : 'idle'}
          </span>
          {readOnly && <span className="badge warn">view-only</span>}
        </span>
        <span className="spacer" />
        <button className="btn btn-sm" onClick={connect} disabled={!running || state === 'connecting'}>
          <RefreshCw size={13} /> <span className="hide-sm">Reconnect</span>
        </button>
        <button
          className="btn btn-sm"
          onClick={() => {
            termRef.current?.clear();
            bufferRef.current = '';
            setBuffered('');
          }}
        >
          Clear
        </button>
        <button className="btn btn-sm" onClick={download} title="Download serial log">
          <Download size={13} />
        </button>
        <button className="btn btn-sm" onClick={fullscreen} title="Fullscreen">
          <Expand size={13} />
        </button>
      </div>
      <div className="console-surface terminal-surface" style={{ height }}>
        <div ref={containerRef} style={{ height: '100%', width: '100%' }} />
        {!running && (
          <div className="console-overlay">
            <TerminalSquare size={24} style={{ color: 'var(--muted-2)' }} />
            <h3>Serial console offline</h3>
            <p>
              Serial I/O is captured to a log file while the machine runs. Start the VM to attach
              interactively to its emulated UART.
            </p>
          </div>
        )}
        {running && state === 'connecting' && (
          <div className="console-overlay">
            <Spinner size={22} />
            <h3>Attaching to serial port</h3>
            <p>Replaying buffered output and opening the chardev socket…</p>
          </div>
        )}
        {running && (state === 'error' || state === 'offline') && (
          <div className="console-overlay" style={{ pointerEvents: 'none' }}>
            <WifiOff size={22} style={{ color: 'var(--warn)' }} />
            <h3>Serial unavailable</h3>
            <p>{error || 'The serial socket is not ready yet.'}</p>
          </div>
        )}
        {running && state === 'closed' && (
          <div className="console-overlay" style={{ pointerEvents: 'none' }}>
            <WifiOff size={22} style={{ color: 'var(--warn)' }} />
            <h3>Serial session closed</h3>
            <p>The socket was closed by the host or another client. Reconnect from the toolbar.</p>
          </div>
        )}
        {online && buffered && <span className="console-badge">ttyS0 · {buffered.split('\n').length} lines</span>}
      </div>
    </div>
  );
}
