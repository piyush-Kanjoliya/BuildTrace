import {
  Activity,
  AlertTriangle,
  CircleDot,
  GitCommit,
  MessageSquare,
  PenLine,
  Rocket,
  Search,
  Undo2,
  Wrench,
} from 'lucide-react';
import { cx } from '../lib/format.js';

/**
 * Icon + tone per event type. Tones map to the semantic token palette so the
 * timeline reads consistently with badges elsewhere.
 */
export const EVENT_META = {
  deployment: { icon: Rocket, classes: 'text-primary-300 border-primary-500/35 bg-primary-500/10' },
  deployment_status: { icon: Activity, classes: 'text-primary-300 border-primary-500/35 bg-primary-500/10' },
  rollback: { icon: Undo2, classes: 'text-warning border-warning/40 bg-warning/10' },
  commit: { icon: GitCommit, classes: 'text-accent-300 border-accent-500/35 bg-accent-500/10' },
  incident: { icon: AlertTriangle, classes: 'text-danger border-danger/40 bg-danger/10' },
  incident_update: { icon: PenLine, classes: 'text-warning border-warning/40 bg-warning/10' },
  comment: { icon: MessageSquare, classes: 'text-muted border-edge-strong bg-surface-2' },
  investigation: { icon: Search, classes: 'text-accent-300 border-accent-500/35 bg-accent-500/10' },
  config_change: { icon: Wrench, classes: 'text-muted border-edge-strong bg-surface-2' },
  other: { icon: CircleDot, classes: 'text-faint border-edge bg-surface-2' },
};

export function EventIcon({ type, size = 15, className = '' }) {
  const meta = EVENT_META[type] || EVENT_META.other;
  const Icon = meta.icon;
  return (
    <span
      className={cx(
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border',
        meta.classes,
        className
      )}
    >
      <Icon size={size} aria-hidden="true" />
    </span>
  );
}
