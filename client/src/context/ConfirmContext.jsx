import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';

const ConfirmContext = createContext(null);

export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null);
  const resolver = useRef(null);

  const confirm = useCallback((options) => {
    const opts = typeof options === 'string' ? { message: options } : options || {};
    return new Promise((resolve) => {
      resolver.current = resolve;
      setState({
        title: opts.title || 'Please confirm',
        message: opts.message || '',
        confirmLabel: opts.confirmLabel || 'Confirm',
        cancelLabel: opts.cancelLabel || 'Cancel',
        danger: opts.danger !== false,
        details: opts.details || null,
      });
    });
  }, []);

  const close = (value) => {
    setState(null);
    const resolve = resolver.current;
    resolver.current = null;
    resolve?.(value);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close(false)}>
          <div className="modal modal-sm" role="dialog" aria-modal="true" aria-label={state.title}>
            <div className="modal-body">
              <div className="confirm-head">
                <span className={`confirm-icon ${state.danger ? 'danger' : ''}`}>
                  <AlertTriangle size={20} />
                </span>
                <div>
                  <h3>{state.title}</h3>
                  {state.message && <p className="confirm-message">{state.message}</p>}
                </div>
              </div>
              {state.details && <div className="confirm-details">{state.details}</div>}
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => close(false)}>
                {state.cancelLabel}
              </button>
              <button
                className={`btn ${state.danger ? 'btn-danger' : 'btn-primary'}`}
                autoFocus
                onClick={() => close(true)}
              >
                {state.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used inside ConfirmProvider');
  return ctx;
}
