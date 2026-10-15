import { useId } from 'react';
import { cx } from '../../lib/format.js';

/**
 * Form primitives with accessible labelling:
 * label always visible, error rendered below the field (never placeholder-only),
 * helper text persists under complex inputs.
 */

const CONTROL_BASE =
  'w-full rounded-lg border bg-surface-2 px-3 text-sm text-fg placeholder:text-faint transition-colors ' +
  'focus:border-primary-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-45';

export function Field({ label, htmlFor, error, hint, required = false, className = '', children }) {
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      {label && (
        <label htmlFor={htmlFor} className="text-xs font-medium tracking-wide text-muted">
          {label}
          {required && (
            <span aria-hidden="true" className="ml-0.5 text-danger">
              *
            </span>
          )}
        </label>
      )}
      {children}
      {hint && !error && <p className="text-xs text-faint">{hint}</p>}
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export function Input({ label, error, hint, required, className = '', id, ...rest }) {
  const autoId = useId();
  const fieldId = id || autoId;
  return (
    <Field label={label} htmlFor={fieldId} error={error} hint={hint} required={required} className={className}>
      <input
        id={fieldId}
        aria-invalid={error ? 'true' : undefined}
        className={cx(CONTROL_BASE, 'h-10', error ? 'border-danger/60' : 'border-edge')}
        {...rest}
      />
    </Field>
  );
}

export function Textarea({ label, error, hint, required, className = '', id, rows = 4, ...rest }) {
  const autoId = useId();
  const fieldId = id || autoId;
  return (
    <Field label={label} htmlFor={fieldId} error={error} hint={hint} required={required} className={className}>
      <textarea
        id={fieldId}
        rows={rows}
        aria-invalid={error ? 'true' : undefined}
        className={cx(CONTROL_BASE, 'py-2 leading-relaxed', error ? 'border-danger/60' : 'border-edge')}
        {...rest}
      />
    </Field>
  );
}

export function Select({ label, error, hint, required, className = '', id, children, ...rest }) {
  const autoId = useId();
  const fieldId = id || autoId;
  return (
    <Field label={label} htmlFor={fieldId} error={error} hint={hint} required={required} className={className}>
      <select
        id={fieldId}
        aria-invalid={error ? 'true' : undefined}
        className={cx(CONTROL_BASE, 'h-10 cursor-pointer appearance-none pr-8', error ? 'border-danger/60' : 'border-edge')}
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%23a2a8c8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 10px center',
        }}
        {...rest}
      >
        {children}
      </select>
    </Field>
  );
}

/** Horizontal checkbox + label row (e.g. "only show active"). */
export function CheckboxRow({ id, checked, onChange, label, className = '' }) {
  const autoId = useId();
  const fieldId = id || autoId;
  return (
    <label
      htmlFor={fieldId}
      className={cx('inline-flex cursor-pointer select-none items-center gap-2 text-sm text-muted', className)}
    >
      <input
        id={fieldId}
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="h-4 w-4 cursor-pointer accent-[var(--color-primary-500)]"
      />
      {label}
    </label>
  );
}
