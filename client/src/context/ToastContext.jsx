import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';

const ToastContext = createContext(null);

let seq = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  const remove = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  const push = useCallback(
    (message, type = 'info', options = {}) => {
      const id = ++seq;
      const toast = { id, message, type, title: options.title || null };
      setToasts((list) => [...list.slice(-4), toast]);
      const timeout = options.timeout ?? (type === 'error' ? 7000 : 4200);
      if (timeout > 0) {
        const timer = setTimeout(() => remove(id), timeout);
        timers.current.set(id, timer);
      }
      return id;
    },
    [remove],
  );

  const toast = useMemo(
    () => ({
      push,
      success: (message, options) => push(message, 'success', options),
      error: (message, options) => push(message, 'error', options),
      info: (message, options) => push(message, 'info', options),
      warn: (message, options) => push(message, 'warn', options),
      dismiss: remove,
    }),
    [push, remove],
  );

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.type}`}>
            <span className="toast-icon">
              {t.type === 'error' ? (
                <AlertTriangle size={16} />
              ) : t.type === 'success' ? (
                <CheckCircle2 size={16} />
              ) : t.type === 'warn' ? (
                <AlertTriangle size={16} />
              ) : (
                <Info size={16} />
              )}
            </span>
            <div className="toast-body">
              {t.title && <strong>{t.title}</strong>}
              <span>{t.message}</span>
            </div>
            <button className="icon-btn toast-close" onClick={() => remove(t.id)} aria-label="Dismiss">
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
