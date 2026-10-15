import { cx } from '../../lib/format.js';
import {
  DEPLOYMENT_STATUS_META,
  INCIDENT_STATUS_META,
  ROLE_META,
  SEVERITY_META,
} from '../../lib/constants.js';

/** Tone map: text + border + soft background, all on the dark canvas. */
const TONES = {
  neutral: 'bg-surface-3/60 text-muted border-edge-strong',
  primary: 'bg-primary-500/12 text-primary-300 border-primary-500/35',
  accent: 'bg-accent-500/12 text-accent-300 border-accent-500/35',
  success: 'bg-success/12 text-success border-success/35',
  warning: 'bg-warning/12 text-warning border-warning/35',
  danger: 'bg-danger/12 text-danger border-danger/35',
  sev1: 'bg-sev1/15 text-sev1 border-sev1/40',
  sev2: 'bg-sev2/15 text-sev2 border-sev2/40',
  sev3: 'bg-sev3/15 text-sev3 border-sev3/40',
  sev4: 'bg-sev4/12 text-sev4 border-sev4/35',
};

const DOT_TONES = {
  neutral: 'bg-muted',
  primary: 'bg-primary-400',
  accent: 'bg-accent-400',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  sev1: 'bg-sev1',
  sev2: 'bg-sev2',
  sev3: 'bg-sev3',
  sev4: 'bg-sev4',
};

/**
 * Generic badge. Status colors always pair with text (never color-only), and
 * a dot reinforces meaning for sighted users.
 */
export function Badge({ tone = 'neutral', dot = false, className = '', children }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide',
        TONES[tone] || TONES.neutral,
        className
      )}
    >
      {dot && <span className={cx('h-1.5 w-1.5 rounded-full', DOT_TONES[tone] || DOT_TONES.neutral)} />}
      {children}
    </span>
  );
}

export function SeverityBadge({ severity, className = '' }) {
  const meta = SEVERITY_META[severity] || { label: severity || 'SEV?', tone: 'neutral' };
  return (
    <Badge tone={meta.tone} className={className} title={meta.description}>
      {meta.label}
    </Badge>
  );
}

export function IncidentStatusBadge({ status, dot = true, className = '' }) {
  const meta = INCIDENT_STATUS_META[status] || { label: status || 'unknown', tone: 'neutral' };
  return (
    <Badge tone={meta.tone} dot={dot} className={className}>
      {meta.label}
    </Badge>
  );
}

export function DeploymentStatusBadge({ status, dot = true, className = '' }) {
  const meta = DEPLOYMENT_STATUS_META[status] || { label: status || 'unknown', tone: 'neutral' };
  return (
    <Badge tone={meta.tone} dot={dot} className={className}>
      {meta.label}
    </Badge>
  );
}

export function RoleBadge({ role, className = '' }) {
  const meta = ROLE_META[role] || { label: role || 'unknown', tone: 'neutral' };
  return (
    <Badge tone={meta.tone} className={className}>
      {meta.label}
    </Badge>
  );
}
