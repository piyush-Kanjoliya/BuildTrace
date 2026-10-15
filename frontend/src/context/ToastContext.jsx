import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { cx } from '../lib/format.js';

const ToastContext = createContext(null);

const TONE = {
  success: { icon: CheckCircle2, classes: 'border-success/40 bg-surface text-fg' },
  error: { icon: AlertTriangle, classes: 'border-danger/50 bg-surface text-fg' },
  info: { icon: Info, classes: 'border-accent-500/40 bg-surface text-fg' },
};

/**
 * Lightweight toast notifications. Auto-dismiss in 4.5s, manual dismiss with
 * the close button, polite aria-live region so screen readers announce them
 * without stealing focus.
 */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (type, message, { duration = 4500 } = {}) => {
      const id = nextId.current;
      nextId.current += 1;
      setToasts((list) => [...list, { id, type, message }]);
      if (duration > 0) setTimeout(() => dismiss(id), duration);
      return id;
    },
    [dismiss]
  );

  const value = useMemo(
    () => ({
      toast: push,
      success: (msg) => push('success', msg),
      error: (msg) => push('error', msg, { duration: 6500 }),
      info: (msg) => push('info', msg),
      dismiss,
    }),
    [push, dismiss]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-[1000] flex flex-col items-center gap-2 px-4 sm:items-end sm:pr-6"
      >
        {toasts.map((t) => {
          const meta = TONE[t.type] || TONE.info;
          const Icon = meta.icon;
          return (
            <div
              key={t.id}
              role="status"
              className={cx(
                'pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-lg border px-4 py-3 shadow-xl shadow-black/40',
                meta.classes
              )}
            >
              <Icon
                size={18}
                className={cx(
                  'mt-0.5 shrink-0',
                  t.type === 'success' && 'text-success',
                  t.type === 'error' && 'text-danger',
                  t.type === 'info' && 'text-accent-400'
                )}
                aria-hidden="true"
              />
              <p className="flex-1 text-sm leading-snug">{t.message}</p>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                className="rounded p-0.5 text-faint transition-colors hover:text-fg"
                aria-label="Dismiss notification"
              >
                <X size={16} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
