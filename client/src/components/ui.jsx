import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Copy, Eye, EyeOff, Loader2, X } from 'lucide-react';
import { copyText } from '../lib/format.js';

const STATUS_META = {
  running: { label: 'Running', tone: 'ok' },
  paused: { label: 'Paused', tone: 'warn' },
  stopped: { label: 'Stopped', tone: 'off' },
  starting: { label: 'Starting', tone: 'info' },
  stopping: { label: 'Stopping', tone: 'warn' },
  error: { label: 'Error', tone: 'error' },
  unknown: { label: 'Unknown', tone: 'off' },
};

export function StatusPill({ status = 'stopped', label, pulse = true }) {
  const meta = STATUS_META[status] || STATUS_META.unknown;
  return (
    <span className={`status-pill tone-${meta.tone}`}>
      <span className={`status-dot ${pulse && status === 'running' ? 'pulse' : ''}`} />
      {label || meta.label}
    </span>
  );
}

export function PasswordInput({ value, onChange, autoComplete = 'current-password', name = 'password', ...rest }) {
  const [visible, setVisible] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <input
        className="input"
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        autoComplete={autoComplete}
        name={name}
        style={{ paddingRight: 38 }}
        {...rest}
      />
      <button
        type="button"
        className="icon-btn"
        style={{ position: 'absolute', right: 4, top: 4 }}
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        tabIndex={-1}
      >
        {visible ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
  );
}

export function Spinner({ size = 16, className = '' }) {
  return <Loader2 size={size} className={`spin ${className}`} />;
}

export function Modal({ title, subtitle, icon, onClose, children, footer, size = 'md', className = '' }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal modal-${size} ${className}`} role="dialog" aria-modal="true" aria-label={title}>
        {(title || onClose) && (
          <div className="modal-header">
            <div className="modal-title-wrap">
              {icon && <span className="modal-icon">{icon}</span>}
              <div>
                {title && <h2>{title}</h2>}
                {subtitle && <p className="modal-subtitle">{subtitle}</p>}
              </div>
            </div>
            {onClose && (
              <button className="icon-btn" onClick={onClose} aria-label="Close">
                <X size={18} />
              </button>
            )}
          </div>
        )}
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Dropdown({ trigger, items = [], align = 'end', className = '' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className={`dropdown ${className}`} ref={ref}>
      <span onClick={() => setOpen((v) => !v)}>{trigger}</span>
      {open && (
        <div className={`dropdown-menu align-${align}`} role="menu">
          {items.map((item, index) => {
            if (item.divider) return <div key={`div-${index}`} className="dropdown-divider" />;
            if (!item.label) return null;
            return (
              <button
                key={item.label}
                className={`dropdown-item ${item.danger ? 'danger' : ''}`}
                onClick={() => {
                  setOpen(false);
                  item.onClick?.();
                }}
                disabled={item.disabled}
                role="menuitem"
              >
                {item.icon && <span className="dropdown-icon">{item.icon}</span>}
                <span className="dropdown-label">{item.label}</span>
                {item.hint && <span className="dropdown-hint">{item.hint}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function Sparkline({ data = [], height = 46, stroke = 'var(--accent)', fill = true, max = null }) {
  const id = useId().replace(/:/g, '');
  const width = 240;
  let values = data
    .map((d) => (typeof d === 'number' ? d : Number(d?.cpu ?? d?.mem ?? d?.value ?? 0)))
    .filter((n) => Number.isFinite(n));
  if (values.length === 1) values = [values[0], values[0]];
  if (values.length < 2) {
    return (
      <div className="sparkline-empty" style={{ height }}>
        collecting…
      </div>
    );
  }
  const top = max ?? Math.max(...values, 1) * 1.15;
  const step = width / (values.length - 1);
  const points = values.map((v, i) => {
    const x = i * step;
    const y = height - Math.max(1, Math.min(height - 2, (v / top) * (height - 4) + 2));
    return [x, y];
  });
  const line = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${width},${height} L0,${height} Z`;
  return (
    <svg
      className="sparkline"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={{ height }}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <path d={area} fill={`url(#spark-${id})`} />}
      <path d={line} fill="none" stroke={stroke} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function Meter({ value, max = 100, tone = 'accent', label, right, thin = false }) {
  const ratio = Math.max(0, Math.min(1, max > 0 ? Number(value) / Number(max) : 0));
  return (
    <div className={`meter-wrap ${thin ? 'thin' : ''}`}>
      {(label || right) && (
        <div className="meter-head">
          <span>{label}</span>
          <span className="mono">{right}</span>
        </div>
      )}
      <div className="meter">
        <div className={`meter-fill tone-${tone}`} style={{ width: `${ratio * 100}%` }} />
      </div>
    </div>
  );
}

export function EmptyState({ icon, title, description, action, compact = false }) {
  return (
    <div className={`empty-state ${compact ? 'compact' : ''}`}>
      {icon && <div className="empty-icon">{icon}</div>}
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}

export function CopyButton({ value, label = 'Copy', className = '', size = 13 }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={`copy-btn ${className}`}
      onClick={async (e) => {
        e.stopPropagation();
        await copyText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }}
      title={`Copy ${label}`}
    >
      {copied ? <Check size={size} /> : <Copy size={size} />}
      <span>{copied ? 'Copied' : label}</span>
    </button>
  );
}

export function Toggle({ checked, onChange, label, description, disabled }) {
  return (
    <label className={`toggle-row ${disabled ? 'disabled' : ''}`}>
      <span className="toggle-text">
        <span className="toggle-label">{label}</span>
        {description && <span className="toggle-desc">{description}</span>}
      </span>
      <button
        type="button"
        className={`toggle ${checked ? 'on' : ''}`}
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange?.(!checked)}
      >
        <span className="toggle-knob" />
      </button>
    </label>
  );
}

export function Segmented({ options, value, onChange, size = 'md' }) {
  return (
    <div className={`segmented ${size}`}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={value === opt.value ? 'active' : ''}
          onClick={() => onChange?.(opt.value)}
        >
          {opt.icon}
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function Select({ value, onChange, options, placeholder, disabled, className = '', name }) {
  return (
    <div className={`select-wrap ${className}`}>
      <select
        className="input select"
        value={value ?? ''}
        onChange={(e) => onChange?.(e.target.value)}
        disabled={disabled}
        name={name}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <ChevronDown size={15} className="select-caret" />
    </div>
  );
}

export function Field({ label, hint, error, children, required, className = '' }) {
  return (
    <div className={`field ${error ? 'has-error' : ''} ${className}`}>
      {label && (
        <label className="field-label">
          {label}
          {required && <span className="req">*</span>}
        </label>
      )}
      {children}
      {hint && !error && <p className="field-hint">{hint}</p>}
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}

export function LiveDot({ connected }) {
  return (
    <span className={`live-dot ${connected ? 'on' : 'off'}`} title={connected ? 'Live updates' : 'Reconnecting…'}>
      <span />
    </span>
  );
}

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function useDebounced(value, delay = 200) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function DataRow({ label, children, mono = false }) {
  return (
    <div className="data-row">
      <span className="data-label">{label}</span>
      <span className={`data-value ${mono ? 'mono' : ''}`}>{children}</span>
    </div>
  );
}

export function Checkbox({ checked, onChange, label, disabled }) {
  return (
    <label className={`checkbox ${disabled ? 'disabled' : ''}`}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} />
      <span className="checkbox-box">{checked && <Check size={12} />}</span>
      <span>{label}</span>
    </label>
  );
}

export function useOutsideClose(ref, onClose, active = true) {
  useEffect(() => {
    if (!active) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [ref, onClose, active]);
}

export function splitPath(path) {
  return useMemo(() => (path ? String(path).split('/').filter(Boolean) : []), [path]);
}
