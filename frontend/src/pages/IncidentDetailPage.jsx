import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  History,
  Lightbulb,
  MessageSquare,
  Pencil,
  Search,
  Send,
  Trash2,
  Undo2,
  Wrench,
} from 'lucide-react';
import { DeploymentDetailModal } from '../components/deployments/DeploymentDetailModal.jsx';
import { CandidateCard } from '../components/incidents/CandidateCard.jsx';
import { IncidentFormModal } from '../components/incidents/IncidentFormModal.jsx';
import { PageHeader } from '../components/layout/PageHeader.jsx';
import {
  Badge,
  DeploymentStatusBadge,
  IncidentStatusBadge,
  SeverityBadge,
} from '../components/ui/Badge.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Card, CardBody, CardHeader } from '../components/ui/Card.jsx';
import { EmptyState, ErrorState, PageLoader } from '../components/ui/Feedback.jsx';
import { Select, Textarea } from '../components/ui/Field.jsx';
import { ConfirmDialog, Modal } from '../components/ui/Modal.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useProjectRoom } from '../context/SocketContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { api } from '../lib/api.js';
import { INCIDENT_STATUS_META, INCIDENT_TRANSITIONS } from '../lib/constants.js';
import { cx, formatDateTime, formatFull, shortSha, timeAgo } from '../lib/format.js';

/* ------------------------------ presentation ----------------------------- */

const TRANSITION_META = {
  investigating: { label: 'Start investigating', icon: Search, variant: 'secondary' },
  monitoring: { label: 'Move to monitoring', icon: Clock3, variant: 'secondary' },
  resolved: { label: 'Resolve incident', icon: CheckCircle2, variant: 'primary' },
  open: { label: 'Reopen incident', icon: Undo2, variant: 'secondary' },
};

const KIND_META = {
  comment: { label: 'Comment', icon: MessageSquare, className: 'text-accent-300' },
  note: { label: 'Investigator note', icon: Wrench, className: 'text-primary-300' },
  status_change: { label: 'Status change', icon: History, className: 'text-warning' },
};

const AUDIT_LABEL = {
  'incident.created': 'Incident created',
  'incident.created_from_event': 'Incident created from event',
  'incident.updated': 'Incident updated',
  'incident.comment_added': 'Comment added',
  'incident.deployment_associated': 'Deployment associated',
  'incident.deployment_dismissed': 'Deployment dismissed',
  'incident.deleted': 'Incident deleted',
};

function clip(value) {
  if (value === null || value === undefined || value === '') return '—';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return text.length > 44 ? `${text.slice(0, 44)}…` : text;
}

/** Key-level before → after summary for an audit entry. */
function DiffList({ before, after }) {
  const keys = [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])];
  const changed = keys.filter(
    (k) => JSON.stringify(before?.[k] ?? null) !== JSON.stringify(after?.[k] ?? null)
  );
  if (!changed.length) return null;
  const visible = changed.slice(0, 4);

  return (
    <ul className="mt-1.5 space-y-1">
      {visible.map((key) => (
        <li key={key} className="flex flex-wrap items-baseline gap-1.5 text-xs">
          <span className="text-faint">{key.replace(/([A-Z])/g, ' $1').toLowerCase()}</span>
          <span className="text-muted line-through decoration-danger/50">{clip(before?.[key])}</span>
          <ArrowRight size={11} className="text-faint" aria-hidden="true" />
          <span className="text-success">{clip(after?.[key])}</span>
        </li>
      ))}
      {changed.length > visible.length && (
        <li className="text-xs text-faint">
          +{changed.length - visible.length} more field{changed.length - visible.length === 1 ? '' : 's'} changed
        </li>
      )}
    </ul>
  );
}

function MetaRow({ label, children }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <dt className="shrink-0 text-xs text-faint">{label}</dt>
      <dd className="min-w-0 text-right text-sm text-muted">{children}</dd>
    </div>
  );
}

function ActivityItem({ update }) {
  const meta = KIND_META[update.kind] || KIND_META.comment;
  const Icon = meta.icon;
  const author = update.authorId;

  return (
    <li className="flex gap-3 px-5 py-3.5">
      <span
        className={cx(
          'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-edge bg-surface-2',
          meta.className
        )}
      >
        <Icon size={13} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
          <span className="font-medium text-fg">{author?.name || 'System'}</span>
          <Badge tone={update.kind === 'status_change' ? 'warning' : 'neutral'}>{meta.label}</Badge>
          <span className="text-faint" title={formatFull(update.createdAt)}>
            {timeAgo(update.createdAt)}
          </span>
        </p>
        <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-muted">
          {update.content}
        </p>
      </div>
    </li>
  );
}

/* -------------------------------- the page ------------------------------- */

export default function IncidentDetailPage() {
  const { incidentId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();

  const [detail, setDetail] = useState(null);
  const [updates, setUpdates] = useState([]);
  const [candidates, setCandidates] = useState(null);
  const [audit, setAudit] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [resolution, setResolution] = useState('');
  const [resolveError, setResolveError] = useState(null);
  const [reopenOpen, setReopenOpen] = useState(false);

  const [rootCauseDraft, setRootCauseDraft] = useState('');
  const [draft, setDraft] = useState('');
  const [draftKind, setDraftKind] = useState('comment');
  const [posting, setPosting] = useState(false);

  const [busyCandidate, setBusyCandidate] = useState(null);
  const [selectedDeployment, setSelectedDeployment] = useState(null);

  const reload = useCallback(async () => {
    try {
      const [next, updatesRes, candidatesRes, auditRes] = await Promise.all([
        api.get(`/incidents/${incidentId}`),
        api.get(`/incidents/${incidentId}/updates`, { params: { limit: 200 } }),
        api.get(`/incidents/${incidentId}/candidates`),
        api.get(`/incidents/${incidentId}/audit-logs`, { params: { limit: 50 } }),
      ]);
      setDetail(next);
      setUpdates(updatesRes.items || []);
      setCandidates(candidatesRes);
      setAudit(auditRes);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [incidentId]);

  useEffect(() => {
    setLoading(true);
    setDetail(null);
    reload();
  }, [reload]);

  // Keep the root-cause editor in sync with the authoritative document.
  useEffect(() => {
    setRootCauseDraft(detail?.rootCause || '');
  }, [detail?.rootCause]);

  // Realtime: project-room notifications refresh authoritative state.
  const roomId = detail?.project?.id;
  useProjectRoom(
    roomId,
    useMemo(
      () => ({
        'incident:updated': reload,
        'comment:added': reload,
        'deployment:created': reload,
        'deployment:updated': reload,
      }),
      [reload]
    )
  );

  const canWrite = Boolean(
    user && (user.role === 'admin' || ['admin', 'developer'].includes(detail?.yourProjectRole))
  );
  const isAdmin = Boolean(user && (user.role === 'admin' || detail?.yourProjectRole === 'admin'));

  /* ------------------------------ mutations ------------------------------ */

  const patch = useCallback(
    async (payload, message) => {
      if (!detail) return false;
      setSaving(true);
      try {
        await api.patch(`/incidents/${incidentId}`, { version: detail.version, ...payload });
        toast.success(message);
        await reload();
        return true;
      } catch (err) {
        if (err.status === 409) {
          toast.error(`${err.message} The newest version has been loaded.`);
          await reload();
        } else {
          toast.error(err.message);
        }
        return false;
      } finally {
        setSaving(false);
      }
    },
    [detail, incidentId, reload, toast]
  );

  function onTransition(target) {
    if (target === 'resolved') {
      setResolveError(null);
      setResolveOpen(true);
      return;
    }
    if (target === 'open') {
      setReopenOpen(true);
      return;
    }
    patch({ status: target }, `Status updated to "${INCIDENT_STATUS_META[target].label}"`);
  }

  async function submitResolve(e) {
    e.preventDefault();
    if (!resolution.trim()) {
      setResolveError('A resolution summary is required to resolve an incident.');
      return;
    }
    const ok = await patch(
      { status: 'resolved', resolution: resolution.trim() },
      'Incident resolved'
    );
    if (ok) {
      setResolveOpen(false);
      setResolution('');
      setResolveError(null);
    }
  }

  async function confirmReopen() {
    const ok = await patch({ status: 'open' }, 'Incident reopened');
    if (ok) setReopenOpen(false);
  }

  async function saveRootCause() {
    await patch(
      { rootCause: rootCauseDraft.trim() || null },
      rootCauseDraft.trim() ? 'Root cause recorded' : 'Root cause cleared'
    );
  }

  async function postUpdate(e) {
    e.preventDefault();
    if (!draft.trim()) return;
    setPosting(true);
    try {
      await api.post(`/incidents/${incidentId}/updates`, {
        content: draft.trim(),
        kind: draftKind,
      });
      setDraft('');
      setDraftKind('comment');
      toast.success('Update posted');
      await reload();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setPosting(false);
    }
  }

  async function candidateAction(kind, candidate) {
    const deploymentId = candidate.deployment?._id;
    setBusyCandidate(deploymentId);
    try {
      await api.post(`/incidents/${incidentId}/deployments/${kind}`, { deploymentId });
      toast.success(
        kind === 'associate'
          ? 'Deployment associated as the likely cause'
          : 'Candidate dismissed for this incident'
      );
      await reload();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyCandidate(null);
    }
  }

  async function confirmDelete() {
    setDeleting(true);
    try {
      await api.delete(`/incidents/${incidentId}`);
      toast.success('Incident deleted');
      navigate('/incidents', { replace: true });
    } catch (err) {
      toast.error(err.message);
      setDeleting(false);
      setDeleteOpen(false);
    }
  }

  /* -------------------------------- render ------------------------------- */

  if (loading && !detail) return <PageLoader label="Loading incident…" />;

  if (error || !detail) {
    return (
      <div>
        <PageHeader
          breadcrumbs={[{ label: 'Incidents', to: '/incidents' }, { label: 'Incident' }]}
          title="Incident unavailable"
        />
        <ErrorState
          message={error || 'This incident could not be loaded.'}
          onRetry={() => {
            setLoading(true);
            reload();
          }}
        />
      </div>
    );
  }

  const transitions = INCIDENT_TRANSITIONS[detail.status] || [];
  const candidateList = candidates?.candidates || [];
  const rootDirty = rootCauseDraft.trim() !== (detail.rootCause || '').trim();

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: 'Incidents', to: '/incidents' }, { label: detail.title }]}
        title={detail.title}
        actions={
          <>
            {canWrite && (
              <Button variant="secondary" size="sm" icon={Pencil} onClick={() => setEditOpen(true)}>
                Edit
              </Button>
            )}
            {isAdmin && (
              <Button variant="dangerGhost" size="sm" icon={Trash2} onClick={() => setDeleteOpen(true)}>
                Delete
              </Button>
            )}
          </>
        }
      >
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted">
          <SeverityBadge severity={detail.severity} />
          <IncidentStatusBadge status={detail.status} />
          <Link
            to={`/projects/${detail.project?.id}`}
            className="cursor-pointer transition-colors hover:text-fg"
          >
            {detail.project?.name}
          </Link>
          {detail.environment && <span>{detail.environment}</span>}
          {detail.affectedService && (
            <>
              <span aria-hidden="true">·</span>
              <span>{detail.affectedService}</span>
            </>
          )}
          <span aria-hidden="true">·</span>
          <span className="tabular">v{detail.version}</span>
        </div>
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ------------------------------ main column ----------------------- */}
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader
              title="What happened"
              subtitle={
                detail.createdBy?.name
                  ? `Reported by ${detail.createdBy.name} · ${formatDateTime(detail.createdAt)}`
                  : undefined
              }
            />
            <CardBody>
              {detail.description ? (
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted">
                  {detail.description}
                </p>
              ) : (
                <p className="text-sm text-faint">No description was provided.</p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Suggested root cause candidates"
              subtitle={
                candidates?.window?.description
                  ? `Correlation window: ${candidates.window.description}. Suggestions only — never confirmed automatically.`
                  : 'Ranked by the transparent correlation engine. These are suggestions, not conclusions.'
              }
            />
            <CardBody className="space-y-4">
              {candidates?.methodology && (
                <details className="rounded-lg border border-edge bg-surface-2/50 px-3 py-2 text-xs text-muted">
                  <summary className="cursor-pointer select-none font-medium text-faint transition-colors hover:text-fg">
                    How candidates are scored (weights &amp; factors)
                  </summary>
                  <p className="mt-2 leading-relaxed">{candidates.methodology}</p>
                </details>
              )}

              {candidates && candidateList.length === 0 ? (
                <EmptyState
                  icon={Lightbulb}
                  title="No matching deployments"
                  message={
                    candidates.noneFoundMessage ||
                    'No deployments fall inside the correlation window for this incident.'
                  }
                  className="py-8"
                />
              ) : (
                <div className="space-y-3">
                  {candidateList.map((candidate, index) => (
                    <CandidateCard
                      key={candidate.deployment?._id || index}
                      candidate={candidate}
                      rank={index + 1}
                      canWrite={canWrite}
                      busy={busyCandidate === candidate.deployment?._id}
                      onAssociate={(c) => candidateAction('associate', c)}
                      onDismiss={(c) => candidateAction('dismiss', c)}
                    />
                  ))}
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Associated deployments"
              subtitle="Linked by an investigator as the likely cause"
            />
            {detail.associatedDeployments?.length ? (
              <ul className="divide-y divide-edge/70">
                {detail.associatedDeployments.map((dep) => (
                  <li key={dep._id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3">
                    <span className="font-medium text-fg">
                      {dep.version && dep.version !== 'unknown' ? `v${dep.version}` : 'Deployment'}
                    </span>
                    {dep.environment && <Badge tone="neutral">{dep.environment}</Badge>}
                    <DeploymentStatusBadge status={dep.status} dot={false} />
                    <span className="text-xs text-faint tabular" title={formatFull(dep.occurredAt)}>
                      {formatDateTime(dep.occurredAt)}
                    </span>
                    {dep.commitSha && (
                      <code className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[11px] text-accent-300">
                        {shortSha(dep.commitSha)}
                      </code>
                    )}
                    {dep.actor?.name && <span className="text-xs text-muted">{dep.actor.name}</span>}
                    <Button
                      variant="ghost"
                      size="xs"
                      className="ml-auto"
                      onClick={() => setSelectedDeployment(dep._id)}
                    >
                      Details
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <CardBody>
                <p className="text-sm text-muted">
                  No deployment is linked yet. Review the suggested candidates above and associate
                  the cause once you are confident.
                </p>
              </CardBody>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Activity"
              subtitle="Comments, investigator notes and status changes in conversation order"
            />
            {updates.length ? (
              <ul className="divide-y divide-edge/70">
                {updates.map((update) => (
                  <ActivityItem key={update._id} update={update} />
                ))}
              </ul>
            ) : (
              <CardBody>
                <p className="text-sm text-faint">
                  Nothing has been posted yet. Add the first update to start the investigation
                  log.
                </p>
              </CardBody>
            )}

            {canWrite ? (
              <form onSubmit={postUpdate} className="border-t border-edge px-5 py-4">
                <Textarea
                  label="Add an update"
                  rows={3}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={
                    draftKind === 'note'
                      ? 'Investigator note — context, hypotheses, next steps…'
                      : 'Share what you know — visible to everyone in the project.'
                  }
                />
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <Select
                    label=""
                    aria-label="Update kind"
                    value={draftKind}
                    onChange={(e) => setDraftKind(e.target.value)}
                    className="w-44"
                  >
                    <option value="comment">Comment</option>
                    <option value="note">Investigator note</option>
                  </Select>
                  <Button type="submit" icon={Send} loading={posting} disabled={!draft.trim()}>
                    Post update
                  </Button>
                </div>
              </form>
            ) : (
              <p className="border-t border-edge px-5 py-3 text-xs text-faint">
                Viewers can read the activity feed but cannot post updates.
              </p>
            )}
          </Card>
        </div>

        {/* ------------------------------ side column ----------------------- */}
        <div className="space-y-6">
          <Card>
            <CardHeader title="Status workflow" subtitle="Transitions are validated server-side" />
            <CardBody className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <IncidentStatusBadge status={detail.status} />
                {detail.status === 'resolved' && detail.resolvedAt && (
                  <span className="text-xs text-faint">resolved {timeAgo(detail.resolvedAt)}</span>
                )}
              </div>

              {detail.status === 'resolved' && detail.resolution && (
                <div className="rounded-lg border border-success/30 bg-success/5 px-3 py-2">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-success">
                    Resolution
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-muted">
                    {detail.resolution}
                  </p>
                </div>
              )}

              {canWrite ? (
                <div className="flex flex-wrap gap-2">
                  {transitions.map((target) => {
                    const meta = TRANSITION_META[target];
                    return (
                      <Button
                        key={target}
                        variant={meta.variant}
                        size="sm"
                        icon={meta.icon}
                        disabled={saving}
                        onClick={() => onTransition(target)}
                      >
                        {meta.label}
                      </Button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-faint">
                  Only project admins and developers can change the status.
                </p>
              )}
              {canWrite && detail.status !== 'resolved' && (
                <p className="text-xs text-faint">
                  Resolving requires a resolution summary; reopening a resolved incident clears
                  its resolution timestamp.
                </p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <dl className="divide-y divide-edge/60">
                <MetaRow label="Project">
                  <Link
                    to={`/projects/${detail.project?.id}`}
                    className="cursor-pointer transition-colors hover:text-fg"
                  >
                    {detail.project?.name}
                  </Link>
                </MetaRow>
                <MetaRow label="Environment">
                  {detail.environment || <span className="text-faint">Not set</span>}
                </MetaRow>
                <MetaRow label="Affected service">
                  {detail.affectedService || <span className="text-faint">Not set</span>}
                </MetaRow>
                <MetaRow label="Severity">
                  <SeverityBadge severity={detail.severity} />
                </MetaRow>
                <MetaRow label="Assignee">
                  {detail.assigneeId?.name || <span className="text-faint">Unassigned</span>}
                </MetaRow>
                <MetaRow label="Reported by">
                  {detail.createdBy?.name || <span className="text-faint">Unknown</span>}
                </MetaRow>
                <MetaRow label="Created">
                  <span title={formatFull(detail.createdAt)}>{timeAgo(detail.createdAt)}</span>
                </MetaRow>
                <MetaRow label="Last updated">
                  <span title={formatFull(detail.updatedAt)}>{timeAgo(detail.updatedAt)}</span>
                </MetaRow>
                <MetaRow label="Version">
                  <span className="tabular" title="Optimistic concurrency version">
                    v{detail.version}
                  </span>
                </MetaRow>
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Root cause"
              subtitle="The investigator-confirmed cause — separate from the suggested candidates"
            />
            <CardBody className="space-y-3">
              {canWrite ? (
                <>
                  <Textarea
                    label=""
                    aria-label="Confirmed root cause"
                    rows={4}
                    value={rootCauseDraft}
                    onChange={(e) => setRootCauseDraft(e.target.value)}
                    placeholder="Describe the confirmed cause once the investigation concludes…"
                  />
                  <div className="flex items-center justify-end gap-2">
                    {rootDirty && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={saving}
                        onClick={() => setRootCauseDraft(detail.rootCause || '')}
                      >
                        Reset
                      </Button>
                    )}
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={saving && rootDirty}
                      disabled={!rootDirty}
                      onClick={saveRootCause}
                    >
                      Save root cause
                    </Button>
                  </div>
                </>
              ) : detail.rootCause ? (
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted">
                  {detail.rootCause}
                </p>
              ) : (
                <p className="text-sm text-faint">No confirmed root cause recorded yet.</p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Audit log" subtitle="Who changed what, immutable record" />
            {audit?.items?.length ? (
              <ul className="divide-y divide-edge/70">
                {audit.items.map((entry) => (
                  <li key={entry._id} className="px-5 py-3">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                      <span className="font-medium text-fg">
                        {AUDIT_LABEL[entry.action] || entry.action}
                      </span>
                      <span className="text-faint">by {entry.actorId?.name || 'system'}</span>
                      <span
                        className="ml-auto text-faint"
                        title={formatFull(entry.timestamp)}
                      >
                        {timeAgo(entry.timestamp)}
                      </span>
                    </div>
                    <DiffList before={entry.before} after={entry.after} />
                  </li>
                ))}
              </ul>
            ) : (
              <CardBody>
                <p className="text-sm text-faint">No audit entries yet.</p>
              </CardBody>
            )}
          </Card>
        </div>
      </div>

      {/* ------------------------------- dialogs ----------------------------- */}

      <IncidentFormModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        incident={detail}
        onSaved={(saved) => {
          if (saved) reload();
        }}
      />

      <Modal
        open={resolveOpen}
        onClose={() => setResolveOpen(false)}
        title="Resolve incident"
        subtitle="A resolution summary is required — it becomes part of the incident record."
        width="max-w-lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setResolveOpen(false)} disabled={saving} data-autofocus>
              Cancel
            </Button>
            <Button type="submit" form="resolve-form" loading={saving} icon={CheckCircle2}>
              Resolve incident
            </Button>
          </>
        }
      >
        <form id="resolve-form" onSubmit={submitResolve} className="space-y-3">
          <Textarea
            label="Resolution summary"
            rows={4}
            required
            value={resolution}
            onChange={(e) => {
              setResolution(e.target.value);
              if (resolveError) setResolveError(null);
            }}
            error={resolveError}
            placeholder="What fixed it? Was there a rollback, a hotfix, a config change?"
          />
          <p className="text-xs text-faint">
            Root cause can be recorded separately below — it is optional for resolving.
          </p>
        </form>
      </Modal>

      <ConfirmDialog
        open={reopenOpen}
        onClose={() => setReopenOpen(false)}
        onConfirm={confirmReopen}
        title="Reopen this incident?"
        message="The incident returns to the open state and its resolution timestamp is cleared. The resolution text is kept in the activity feed."
        confirmLabel="Reopen incident"
        danger={false}
        loading={saving}
      />

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={confirmDelete}
        title="Delete this incident?"
        message={`"${detail.title}" will be permanently deleted, along with its comments and audit trail. Associated deployments are not deleted.`}
        confirmLabel="Delete incident"
        loading={deleting}
      />

      <DeploymentDetailModal
        open={Boolean(selectedDeployment)}
        onClose={() => setSelectedDeployment(null)}
        deploymentId={selectedDeployment}
        canWrite={canWrite}
        onUpdated={reload}
      />
    </div>
  );
}
