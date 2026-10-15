import { cx } from '../../lib/format.js';

/** Raised surface container. */
export function Card({ className = '', children, ...rest }) {
  return (
    <section
      className={cx(
        'rounded-xl border border-edge bg-surface shadow-sm shadow-black/20',
        className
      )}
      {...rest}
    >
      {children}
    </section>
  );
}

export function CardHeader({ title, subtitle, actions = null, className = '' }) {
  return (
    <div
      className={cx(
        'flex flex-wrap items-start justify-between gap-3 border-b border-edge px-5 py-4',
        className
      )}
    >
      <div className="min-w-0">
        <h2 className="text-sm font-semibold tracking-wide text-fg">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function CardBody({ className = '', children }) {
  return <div className={cx('px-5 py-4', className)}>{children}</div>;
}

export function CardFooter({ className = '', children }) {
  return (
    <div className={cx('flex items-center gap-2 border-t border-edge px-5 py-3', className)}>
      {children}
    </div>
  );
}
