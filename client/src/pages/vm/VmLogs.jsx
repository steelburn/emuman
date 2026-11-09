import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, RefreshCw, ScrollText, TerminalSquare, Trash2 } from 'lucide-react';
import { api } from '../../lib/api.js';
import { Segmented, Spinner } from '../../components/ui.jsx';

const ANSI_RE = /\u001b\[[0-9;?]*[a-zA-Z]/g;

function cleanLog(text) {
  return String(text || '').replace(ANSI_RE, '').replace(/\r/g, '');
}

export default function VmLogs({ vm }) {
  const [type, setType] = useState('qemu');
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [auto, setAuto] = useState(true);
  const [error, setError] = useState(null);
  const viewerRef = useRef(null);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const data = await api.get(`/api/vms/${vm.id}/logs?type=${type}`);
        setText(data.text || '');
        setError(null);
        if (viewerRef.current) {
          const el = viewerRef.current;
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
          if (atBottom) requestAnimationFrame(() => (el.scrollTop = el.scrollHeight));
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    },
    [vm.id, type],
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!auto) return;
    const timer = setInterval(() => {
      if (!document.hidden) load(true);
    }, 3000);
    return () => clearInterval(timer);
  }, [auto, load]);

  const download = () => {
    const blob = new Blob([text], { type: 'text/plain' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${vm.name}-${type}.log`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 2000);
  };

  return (
    <div className="detail-side" style={{ gap: 14 }}>
      <div className="list-toolbar" style={{ marginBottom: 0 }}>
        <Segmented
          value={type}
          onChange={setType}
          options={[
            { value: 'qemu', label: 'QEMU process', icon: <ScrollText size={13} /> },
            { value: 'serial', label: 'Serial output', icon: <TerminalSquare size={13} /> },
          ]}
        />
        <div className="toolbar-right">
          <label className="checkbox">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
            <span className="checkbox-box">{auto && <RefreshCw size={11} />}</span>
            <span>Auto-refresh</span>
          </label>
          <button className="btn btn-sm" onClick={() => load()} disabled={loading}>
            {loading ? <Spinner size={13} /> : <RefreshCw size={13} />} Refresh
          </button>
          <button className="btn btn-sm" onClick={download} disabled={!text}>
            <Download size={13} /> Download
          </button>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="log-viewer" ref={viewerRef}>
        {text || (loading ? 'Loading log…' : 'This log is empty.')}
      </div>

      <div className="flex items-center gap-12 tiny muted-2">
        <span>{text ? `${text.split('\n').length} lines · ${(text.length / 1024).toFixed(1)} KB` : '0 bytes'}</span>
        <span>·</span>
        <span>tail is read from the emuman log directory, capped to the last 128 KB</span>
      </div>
    </div>
  );
}
