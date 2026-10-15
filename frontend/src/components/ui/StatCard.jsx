import { cx } from '../../lib/format.js';
import { Skeleton } from './Feedback.jsx';

const TONE_CLASSES = {
  default: 'text-muted border-edge bg-surface-2',
  primary: 'text-primary-300 border-primary-500/35 bg-primary-500/12',
  accent: 'text-accent-300 border-accent-500/35 bg-accent-500/12',
  success: 'text-success border-success/35 bg-success/12',
  warning: 'text-warning border-warning/35 bg-warning/12',
  danger: 'text-danger border-danger/35 bg-danger/12',
};

/**
 * KPI tile. Values use tabular numerals so numbers never shift width while
 * live updates arrive.
 */
export function StatCard({ label, value, hint = null, icon: Icon = null, tone = 'default', loading = false }) {
  return (
    <div className="rounded-xl border border-edge bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-faint">{label}</p>
        {Icon && (
          <span
            className={cx(
              'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border',
              TONE_CLASSES[tone] || TONE_CLASSES.default
            )}
          >
            <Icon size={16} aria-hidden="true" />
          </span>
        )}
      </div>
      {loading ? (
        <Skeleton className="mt-3 h-8 w-16" />
      ) : (
        <p className="tabular mt-2 text-2xl font-semibold text-fg">{value}</p>
      )}
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}
