import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { cx } from '../../lib/format.js';
import { Button } from './Button.jsx';

export function Spinner({ size = 20, className = '' }) {
  return (
    <Loader2
      size={size}
      aria-label="Loading"
      className={cx('animate-spin text-primary-400', className)}
    />
  );
}

export function PageLoader({ label = 'Loading…' }) {
  return (
    <div className="flex items-center justify-center gap-3 py-20 text-muted" role="status">
      <Spinner />
      <span className="text-sm">{label}</span>
    </div>
  );
}

/** Skeleton block for content that reserves space while loading. */
export function Skeleton({ className = '', lines = 1 }) {
  if (lines > 1) {
    return (
      <div className="space-y-2" aria-hidden="true">
        {Array.from({ length: lines }).map((_, i) => (
          <div key={i} className={cx('skeleton h-4', i === lines - 1 ? 'w-2/3' : 'w-full', className)} />
        ))}
      </div>
    );
  }
  return <div className={cx('skeleton', className)} aria-hidden="true" />;
}

/** Loading placeholder shaped like a table. */
export function TableSkeleton({ rows = 5, cols = 4 }) {
  return (
    <div className="space-y-2 p-5" role="status" aria-label="Loading table">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
          {Array.from({ length: cols }).map((__, c) => (
            <div key={c} className="skeleton h-5" />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * Empty state: explains why the area is empty and offers the next action.
 */
export function EmptyState({ icon: Icon, title, message, action = null, className = '' }) {
  return (
    <div className={cx('flex flex-col items-center justify-center gap-3 px-6 py-14 text-center', className)}>
      {Icon && (
        <div className="flex h-12 w-12 items-center justify-center rounded-full border border-edge bg-surface-2">
          <Icon size={22} className="text-faint" aria-hidden="true" />
        </div>
      )}
      <div>
        <h3 className="text-sm font-semibold text-fg">{title}</h3>
        {message && <p className="mx-auto mt-1 max-w-md text-sm text-muted">{message}</p>}
      </div>
      {action}
    </div>
  );
}

/** Error state with a retry path (never a dead end). */
export function ErrorState({ message = 'Something went wrong.', onRetry = null, className = '' }) {
  return (
    <div className={cx('flex flex-col items-center justify-center gap-3 px-6 py-14 text-center', className)} role="alert">
      <div className="flex h-12 w-12 items-center justify-center rounded-full border border-danger/40 bg-danger/10">
        <AlertTriangle size={22} className="text-danger" aria-hidden="true" />
      </div>
      <div>
        <h3 className="text-sm font-semibold text-fg">Could not load this view</h3>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted">{message}</p>
      </div>
      {onRetry && (
        <Button variant="secondary" size="sm" icon={RefreshCw} onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}
