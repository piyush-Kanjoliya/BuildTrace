import { Link } from 'react-router-dom';
import { Clock3 } from 'lucide-react';
import { EventIcon } from './EventIcon.jsx';
import { Badge, DeploymentStatusBadge, SeverityBadge } from './ui/Badge.jsx';
import { EmptyState, Skeleton } from './ui/Feedback.jsx';
import { EVENT_TYPE_LABEL } from '../lib/constants.js';
import { formatFull, minutesLabel, shortSha } from '../lib/format.js';

/** A populated subdocument (object) vs a raw ObjectId (string). */
function linkedDoc(value) {
  return value && typeof value === 'object' ? value : null;
}

function DeploymentBody({ event }) {
  const doc = linkedDoc(event.deploymentId);
  const p = (event.payload && event.payload.deployment) || {};
  const version = doc?.version || p.version || null;
  const environment = doc?.environment || p.environment || null;
  const status = doc?.status || p.status || null;
  const sha = doc?.commitSha || p.commitSha || null;
  const message = p.commitMessage || null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {version && version !== 'unknown' && <span className="font-medium text-fg">v{version}</span>}
        {environment && <Badge tone="neutral">{environment}</Badge>}
        {status && <DeploymentStatusBadge status={status} />}
        {sha && (
          <code className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[11px] text-accent-300">
            {shortSha(sha)}
          </code>
        )}
      </div>
      {message && <p className="mt-1 line-clamp-2 text-xs leading-relaxed">{message}</p>}
    </>
  );
}

function IncidentBody({ event }) {
  const doc = linkedDoc(event.incidentId);
  const p = (event.payload && event.payload.incident) || {};
  const id = doc?._id || (typeof event.incidentId === 'string' ? event.incidentId : null);
  const title = doc?.title || p.title || 'Incident';
  const severity = doc?.severity || p.severity || null;

  return (
    <span className="flex flex-wrap items-center gap-2">
      {severity && <SeverityBadge severity={severity} />}
      {id ? (
        <Link
          to={`/incidents/${id}`}
          className="cursor-pointer font-medium text-fg transition-colors hover:text-primary-300"
        >
          {title}
        </Link>
      ) : (
        <span className="font-medium text-fg">{title}</span>
      )}
    </span>
  );
}

function TextBody({ event }) {
  const p = event.payload || {};
  const text = p.content || p.note || p.message || p.summary || p.text || null;
  if (!text) return <span className="text-faint">{EVENT_TYPE_LABEL[event.eventType] || 'Event'}</span>;
  return <p className="line-clamp-3 whitespace-pre-line text-xs leading-relaxed">{text}</p>;
}

function EventBody({ event }) {
  if (['deployment', 'deployment_status', 'rollback'].includes(event.eventType)) {
    return <DeploymentBody event={event} />;
  }
  if (['incident', 'incident_update'].includes(event.eventType) && (linkedDoc(event.incidentId) || event.payload?.incident)) {
    return <IncidentBody event={event} />;
  }
  return <TextBody event={event} />;
}

/**
 * Chronological event stream. Every row shows both the occurrence time and
 * the cues that explain event ordering: late arrivals (ingested after the
 * fact) and uncertain timestamps (no reliable occurrence time was supplied,
 * so receipt time is used and flagged).
 */
export function TimelineList({
  items = [],
  loading = false,
  emptyTitle = 'No events yet',
  emptyMessage = 'Deployments, commits and incidents will stream in here as they are ingested.',
  emptyAction = null,
}) {
  if (loading) {
    return (
      <div className="space-y-4 p-5" role="status" aria-label="Loading timeline">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex gap-4">
            <Skeleton className="h-8 w-8 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-40" />
              <Skeleton className="h-3 w-full" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!items.length) {
    return <EmptyState icon={Clock3} title={emptyTitle} message={emptyMessage} action={emptyAction} />;
  }

  return (
    <ol className="divide-y divide-edge/60">
      {items.map((event) => {
        const actorName = event.actor?.name || event.actor?.userId?.name || null;
        const delay = event.receiptDelayMinutes;
        return (
          <li key={event._id} className="flex gap-4 px-5 py-4">
            <EventIcon type={event.eventType} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-medium uppercase tracking-wide text-faint">
                  {EVENT_TYPE_LABEL[event.eventType] || event.eventType}
                </span>
                {event.lateArrival && (
                  <Badge
                    tone="warning"
                    title="This event was received well after it occurred - it keeps its true chronological position."
                  >
                    Late arrival
                  </Badge>
                )}
                {event.timestampUncertain && (
                  <Badge
                    tone="neutral"
                    title="The source supplied no reliable occurrence timestamp. Receipt time is used and flagged."
                  >
                    Estimated time
                  </Badge>
                )}
              </div>
              <div className="mt-1.5 text-sm text-muted">
                <EventBody event={event} />
              </div>
              <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-faint">
                <span className="tabular" title="Occurrence time">
                  {formatFull(event.occurredAt)}
                </span>
                {actorName && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{actorName}</span>
                  </>
                )}
                {typeof delay === 'number' && delay >= 0.5 && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>received {minutesLabel(delay)} later</span>
                  </>
                )}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
