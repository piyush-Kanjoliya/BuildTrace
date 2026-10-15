import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { cx } from '../../lib/format.js';
import { Button } from './Button.jsx';

function useDialogBehavior(open, onClose) {
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function onKeyDown(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Move focus into the dialog for keyboard/screen-reader users
    const t = setTimeout(() => {
      const el = ref.current?.querySelector('[data-autofocus]') || ref.current;
      el?.focus?.();
    }, 20);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      clearTimeout(t);
    };
  }, [open, onClose]);

  return ref;
}

/**
 * Centered modal dialog. Escape closes, backdrop click closes, body scroll is
 * locked while open, and the panel accepts focus.
 */
export function Modal({ open, onClose, title, subtitle, width = 'max-w-2xl', children, footer = null }) {
  const ref = useDialogBehavior(open, onClose);
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[900] flex items-start justify-center overflow-y-auto p-4 sm:p-8">
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-sm"
        aria-hidden="true"
        onClick={onClose}
      />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cx(
          'route-in relative z-10 my-auto w-full rounded-xl border border-edge bg-surface shadow-2xl shadow-black/60',
          width
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b border-edge px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-fg">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="cursor-pointer rounded-md p-1 text-faint transition-colors hover:bg-surface-2 hover:text-fg"
          >
            <X size={18} />
          </button>
        </header>
        <div className="px-5 py-4">{children}</div>
        {footer && (
          <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-edge px-5 py-4">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}

/**
 * Confirmation dialog for destructive actions. The destructive action is the
 * only danger-colored control and never the auto-focused default.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  loading = false,
  danger = true,
}) {
  const ref = useDialogBehavior(open, onClose);
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[950] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" aria-hidden="true" onClick={onClose} />
      <div
        ref={ref}
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="route-in relative z-10 w-full max-w-md rounded-xl border border-edge bg-surface p-5 shadow-2xl shadow-black/60"
      >
        <h2 className="text-base font-semibold text-fg">{title}</h2>
        <div className="mt-2 text-sm leading-relaxed text-muted">{message}</div>
        <div className="mt-5 flex items-center justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={loading} data-autofocus>
            Cancel
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            onClick={onConfirm}
            loading={loading}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
