export function formatBytes(bytes, digits = 1) {
  if (bytes === null || bytes === undefined || Number.isNaN(Number(bytes))) return '—';
  const n = Number(bytes);
  if (n === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(Math.abs(n)) / Math.log(1024)));
  const value = n / 1024 ** i;
  const fixed = i === 0 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : digits;
  return `${value.toFixed(fixed)} ${units[i]}`;
}

export function formatGB(gb) {
  const n = Number(gb) || 0;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} TB`;
  return `${n} GB`;
}

export function formatUptime(seconds) {
  if (!seconds && seconds !== 0) return '—';
  const s = Math.floor(seconds);
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const mins = Math.floor((s % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0) return `${mins}m`;
  return `${s}s`;
}

export function formatDuration(ms) {
  if (!ms || ms < 0) return '0s';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export function timeAgo(ts) {
  if (!ts) return '—';
  const diff = Date.now() - Number(ts);
  if (diff < 5000) return 'just now';
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 7 * 86400000) return `${Math.floor(diff / 86400000)}d ago`;
  return formatDate(ts);
}

export function formatDate(ts) {
  if (!ts) return '—';
  const d = new Date(Number(ts));
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatClock(ts) {
  return new Date(Number(ts)).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function pct(value, digits = 0) {
  const n = Number(value) || 0;
  return `${n.toFixed(n < 10 ? Math.max(digits, 1) : digits)}%`;
}

export function isoName(path) {
  if (!path) return null;
  return String(path).split('/').pop();
}

export function osGuess(vm) {
  const name = `${vm?.name || ''} ${vm?.description || ''}`.toLowerCase();
  if (/win/.test(name)) return 'windows';
  if (/ubuntu/.test(name)) return 'ubuntu';
  if (/debian/.test(name)) return 'debian';
  if (/alpine/.test(name)) return 'alpine';
  if (/fedora|redhat|rhel|centos/.test(name)) return 'fedora';
  if (/arch/.test(name)) return 'arch';
  if (/bsd/.test(name)) return 'bsd';
  return 'linux';
}

export function shortId(id) {
  return String(id || '').slice(0, 8);
}

export function truncate(str, max = 80) {
  const s = String(str || '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const el = document.createElement('textarea');
  el.value = text;
  document.body.appendChild(el);
  el.select();
  document.execCommand('copy');
  el.remove();
  return Promise.resolve();
}
