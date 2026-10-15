import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ExternalLink, Info } from 'lucide-react';
import { Badge, DeploymentStatusBadge, IncidentStatusBadge, SeverityBadge } from '../ui/Badge.jsx';
import { Modal } from '../ui/Modal.jsx';
import { Select } from '../ui/Field.jsx';
import { Spinner } from '../ui/Feedback.jsx';
import { api } from '../../lib/api.js';
import { DEPLOYMENT_STATUSES, DEPLOYMENT_STATUS_META } from '../../lib/constants.js';
import { formatFull, minutesLabel, orDash, shortSha } from '../../lib/format.js';
import { useToast } from '../../context/ToastContext.jsx';

function Detail({ label, children }) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-faint">{label}</p>
      <div className="mt-1 text-sm text-fg">{children}</div>
    </div>
  );
}

function IncidentLinks({ items, empty }) {
  if (!items?.length) return <p className="text-sm text-faint">{empty}</p>;
  return (
    <ul className="space-y-2">
      {items.map((inc) => (
        <li key={inc._id} className="flex flex-wrap items-center gap-2">
          <SeverityBadge severity={inc.severity} />
          <IncidentStatusBadge status={inc.status} dot={false} />
          <Link
            to={`/incidents/${inc._id}`}
            className="cursor-pointer text-sm font-medium text-fg transition-colors hover:text-primary-300"
          >
            {inc.title}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * Deployment detail: metadata plus the incidents this deployment is linked
 * to (associated = investigator-confirmed link) or temporally near
 * (potential = overlap only, explicitly labelled as unconfirmed).
 */
export function DeploymentDetailModal({ open, onClose, deploymentId, canWrite = false, onUpdated = null }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [updating, setUpdating] = useState(false);

  const load = useCallback(async () => {
    if (!open || !deploymentId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.get(`/deployments/${deploymentId}`);
      setData(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [open, deploymentId]);

  useEffect(() => {
    load();
  }, [load]);

  async function changeStatus(e) {
    const status = e.target.value;
    setUpdating(true);
    try {
      await api.patch(`/deployments/${deploymentId}`, { status });
      toast.success('Deployment status updated');
      await load();
      if (onUpdated) onUpdated();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setUpdating(false);
    }
  }

  const dep = data?.deployment || null;
  const delayMinutes =
    dep && dep.receivedAt && dep.occurredAt
      ? Math.round(((new Date(dep.receivedAt) - new Date(dep.occurredAt)) / 60000) * 10) / 10
      : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={dep ? `Deployment ${dep.version && dep.version !== 'unknown' ? `v${dep.version}` : ''}`.trim() : 'Deployment'}
      subtitle={data?.project?.name ? `Project: ${data.project.name}` : undefined}
      width="max-w-3xl"
    >
      {loading && (
        <div className="flex items-center justify-center py-10" role="status">
          <Spinner size={22} />
        </div>
      )}
      {error && !loading && (
        <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}

      {dep && !loading && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <DeploymentStatusBadge status={dep.status} />
            <Badge tone="neutral">{dep.environment}</Badge>
            <Badge tone="neutral">{dep.source}</Badge>
            {!dep.occurredAtTrusted && (
              <Badge tone="warning" title="The source supplied no reliable occurrence timestamp; receipt time is used.">
                Estimated time
              </Badge>
            )}
            {typeof delayMinutes === 'number' && delayMinutes >= 30 && (
              <Badge tone="warning" title="Ingested well after it occurred - it kept its true position in the timeline.">
                Late arrival ({minutesLabel(delayMinutes)})
              </Badge>
            )}
          </div>

          {canWrite && (
            <div className="rounded-lg border border-edge bg-surface-2/60 p-3">
              <Select
                label="Update status"
                value={dep.status}
                onChange={changeStatus}
                disabled={updating}
                className="max-w-xs"
              >
                {DEPLOYMENT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {DEPLOYMENT_STATUS_META[s].label}
                  </option>
                ))}
              </Select>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-3">
            <Detail label="Service">{orDash(dep.service)}</Detail>
            <Detail label="Commit">
              {dep.commitSha ? (
                <code className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-xs text-accent-300">
                  {shortSha(dep.commitSha)}
                </code>
              ) : (
                '—'
              )}
            </Detail>
            <Detail label="Author">{dep.actor?.name || orDash(dep.actor?.type)}</Detail>
            <Detail label="Occurred at">
              <span className="tabular">{formatFull(dep.occurredAt)}</span>
            </Detail>
            <Detail label="Received at">
              <span className="tabular">{formatFull(dep.receivedAt)}</span>
            </Detail>
            <Detail label="URL">
              {dep.url ? (
                <a
                  href={dep.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-primary-300 transition-colors hover:text-primary-400"
                >
                  Open <ExternalLink size={12} aria-hidden="true" />
                </a>
              ) : (
                '—'
              )}
            </Detail>
          </div>

          {dep.commitMessage && (
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-faint">Commit message</p>
              <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-muted">{dep.commitMessage}</p>
            </div>
          )}

          {dep.changedFiles?.length > 0 && (
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-faint">
                Changed files ({dep.filesChangedCount || dep.changedFiles.length})
              </p>
              <ul className="mt-1.5 space-y-1">
                {dep.changedFiles.slice(0, 12).map((f) => (
                  <li key={f} className="font-mono text-xs text-muted">
                    {f}
                  </li>
                ))}
                {dep.changedFiles.length > 12 && (
                  <li className="text-xs text-faint">+{dep.changedFiles.length - 12} more</li>
                )}
              </ul>
            </div>
          )}

          <div className="space-y-4 border-t border-edge pt-4">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-semibold text-fg">
                Linked incidents
                <Badge tone="success" dot={false}>
                  investigator confirmed
                </Badge>
              </h3>
              <div className="mt-2">
                <IncidentLinks
                  items={data.relatedIncidents?.associated}
                  empty="No incident is explicitly linked to this deployment."
                />
              </div>
            </div>
            <div>
              <h3 className="flex items-center gap-2 text-sm font-semibold text-fg">
                <AlertTriangle size={14} className="text-warning" aria-hidden="true" />
                Potential incidents
              </h3>
              <p className="mt-1 flex items-center gap-1.5 text-xs text-faint">
                <Info size={12} aria-hidden="true" />
                Temporal overlap only (incident opened within the correlation window after this deployment) - not a
                confirmed cause.
              </p>
              <div className="mt-2">
                <IncidentLinks
                  items={data.relatedIncidents?.potential}
                  empty="No nearby unresolved incidents."
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
