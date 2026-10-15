import { GitCommit, Link2, XCircle } from 'lucide-react';
import { Badge, DeploymentStatusBadge } from '../ui/Badge.jsx';
import { Button } from '../ui/Button.jsx';
import { cx, formatFull, minutesLabel, shortSha } from '../../lib/format.js';

const FACTOR_LABELS = {
  proximity: 'Proximity',
  environment: 'Environment',
  service: 'Service match',
  change_signals: 'Change signals',
};

function ScoreBar({ value }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3" aria-hidden="true">
      <div className="h-full rounded-full bg-primary-500" style={{ width: `${pct}%` }} />
    </div>
  );
}

/**
 * One correlation-engine candidate. The score is deliberately transparent:
 * every factor shows its weight, value and a plain-language explanation, and
 * the card is labelled as a suggestion (never a confirmed cause).
 */
export function CandidateCard({ candidate, rank, canWrite = false, busy = false, onAssociate, onDismiss }) {
  const dep = candidate.deployment || {};
  const scorePct = Math.round((candidate.score || 0) * 100);
  const associated = Boolean(candidate.associatedByInvestigator);

  return (
    <article
      className={cx(
        'rounded-xl border p-4 transition-colors',
        associated ? 'border-success/40 bg-success/5' : 'border-edge bg-surface-2/40'
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-faint tabular">#{rank}</span>
            <span className="font-medium text-fg">
              {dep.version && dep.version !== 'unknown' ? `v${dep.version}` : 'Deployment'}
            </span>
            {dep.environment && <Badge tone="neutral">{dep.environment}</Badge>}
            {dep.status && <DeploymentStatusBadge status={dep.status} dot={false} />}
            {associated && <Badge tone="success" dot>Associated</Badge>}
            {candidate.lateArrival && (
              <Badge tone="warning" title="This deployment was ingested after the incident - it appeared in the candidate list late.">
                Late arrival
              </Badge>
            )}
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-faint">
            <span className="tabular" title={formatFull(dep.occurredAt)}>
              deployed {minutesLabel(candidate.timeDeltaMinutes)} before the incident
            </span>
            {dep.commitSha && (
              <>
                <span aria-hidden="true">·</span>
                <code className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[11px] text-accent-300">
                  {shortSha(dep.commitSha)}
                </code>
              </>
            )}
            {dep.actor?.name && (
              <>
                <span aria-hidden="true">·</span>
                <span>{dep.actor.name}</span>
              </>
            )}
          </p>
          {dep.commitMessage && (
            <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-muted">
              <GitCommit size={13} className="mt-0.5 shrink-0 text-faint" aria-hidden="true" />
              <span className="line-clamp-2">{dep.commitMessage}</span>
            </p>
          )}
        </div>

        <div className="w-28 shrink-0 text-right">
          <p className="text-lg font-semibold text-fg tabular">{scorePct}%</p>
          <p className="text-[10px] uppercase tracking-wide text-faint">match score</p>
          <div className="mt-1.5">
            <ScoreBar value={candidate.score || 0} />
          </div>
        </div>
      </header>

      <div className="mt-3 grid gap-2 border-t border-edge/70 pt-3 sm:grid-cols-2">
        {(candidate.factors || []).map((factor) => (
          <div key={factor.factor} className="rounded-lg bg-surface-2/70 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium uppercase tracking-wide text-faint">
                {FACTOR_LABELS[factor.factor] || factor.factor}
              </span>
              <span className="text-[11px] text-faint tabular">
                weight {Math.round((factor.weight || 0) * 100)}%
              </span>
            </div>
            <div className="mt-1.5">
              <ScoreBar value={factor.value || 0} />
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-muted">{factor.explanation}</p>
          </div>
        ))}
      </div>

      {canWrite && !associated && (
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
          <Button
            variant="dangerGhost"
            size="sm"
            icon={XCircle}
            disabled={busy}
            onClick={() => onDismiss(candidate)}
          >
            Dismiss
          </Button>
          <Button
            variant="primary"
            size="sm"
            icon={Link2}
            disabled={busy}
            onClick={() => onAssociate(candidate)}
          >
            Associate as cause
          </Button>
        </div>
      )}
      {canWrite && associated && (
        <p className="mt-3 text-right text-xs text-success">
          Linked to this incident by an investigator.
        </p>
      )}
    </article>
  );
}
