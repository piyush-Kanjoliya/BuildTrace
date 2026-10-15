import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowDownUp,
  Clock3,
  ExternalLink,
  LayoutDashboard,
  Plus,
  Rocket,
  Settings as SettingsIcon,
  ShieldAlert,
} from 'lucide-react';
import { DashboardContent } from '../components/dashboard/DashboardContent.jsx';
import { DeploymentDetailModal } from '../components/deployments/DeploymentDetailModal.jsx';
import { DeploymentFormModal } from '../components/deployments/DeploymentFormModal.jsx';
import { DeploymentsTable } from '../components/deployments/DeploymentsTable.jsx';
import { IncidentFormModal } from '../components/incidents/IncidentFormModal.jsx';
import { IncidentsTable } from '../components/incidents/IncidentsTable.jsx';
import { PageHeader } from '../components/layout/PageHeader.jsx';
import { IntegrationsPanel } from '../components/project/IntegrationsPanel.jsx';
import { MembersPanel } from '../components/project/MembersPanel.jsx';
import { ProjectSettingsForm } from '../components/project/ProjectSettingsForm.jsx';
import { TimelineList } from '../components/TimelineList.jsx';
import { Badge } from '../components/ui/Badge.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Card, CardBody, CardHeader } from '../components/ui/Card.jsx';
import { ErrorState, PageLoader } from '../components/ui/Feedback.jsx';
import { Input, Select } from '../components/ui/Field.jsx';
import { Pagination } from '../components/ui/Pagination.jsx';
import { Tabs } from '../components/ui/Tabs.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useProjectRoom } from '../context/SocketContext.jsx';
import { api } from '../lib/api.js';
import { EVENT_TYPE_LABEL, INCIDENT_STATUS_META } from '../lib/constants.js';
import { timeAgo } from '../lib/format.js';

/* ------------------------------ tab panels ------------------------------- */

function ScopedDeployments({ project, canWrite, nonce }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(
        await api.get(`/projects/${project._id}/deployments`, { params: { page, limit: 15 } })
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [project._id, page]);

  useEffect(() => {
    load();
  }, [load, nonce]);

  if (error) return <ErrorState message={error} onRetry={load} />;

  return (
    <Card>
      <CardHeader
        title="Deployments"
        subtitle="Manual entries, CI and GitHub ingestion. A push is never treated as a deployment."
      />
      <DeploymentsTable
        items={data?.items || []}
        loading={loading && !data}
        onSelect={setSelected}
        emptyTitle="No deployments in this project"
        emptyMessage="Record one manually or connect a GitHub webhook to stream them automatically."
      />
      {data && (
        <Pagination
          page={data.page}
          limit={data.limit}
          total={data.total}
          onPageChange={setPage}
          className="border-t border-edge"
        />
      )}
      <DeploymentDetailModal
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        deploymentId={selected?._id}
        canWrite={canWrite}
        onUpdated={load}
      />
    </Card>
  );
}

function ScopedIncidents({ project, nonce }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQ(q.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [q]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(
        await api.get(`/projects/${project._id}/incidents`, {
          params: {
            q: debouncedQ || undefined,
            status: status || undefined,
            page,
            limit: 15,
          },
        })
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [project._id, debouncedQ, status, page]);

  useEffect(() => {
    load();
  }, [load, nonce]);

  if (error) return <ErrorState message={error} onRetry={load} />;

  return (
    <Card>
      <CardHeader
        title="Incidents"
        subtitle="Search and filter this project's incidents"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Input
              label=""
              aria-label="Search incidents"
              placeholder="Search…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="w-44"
            />
            <Select
              label=""
              aria-label="Filter by status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
              className="w-40"
            >
              <option value="">All statuses</option>
              {Object.entries(INCIDENT_STATUS_META).map(([value, meta]) => (
                <option key={value} value={value}>
                  {meta.label}
                </option>
              ))}
            </Select>
          </div>
        }
      />
      <IncidentsTable items={data?.items || []} loading={loading && !data} />
      {data && (
        <Pagination
          page={data.page}
          limit={data.limit}
          total={data.total}
          onPageChange={setPage}
          className="border-t border-edge"
        />
      )}
    </Card>
  );
}

function ScopedTimeline({ project, nonce }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [order, setOrder] = useState('desc');
  const [type, setType] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(
        await api.get(`/projects/${project._id}/timeline`, {
          params: { page, limit: 30, order, types: type || undefined },
        })
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [project._id, page, order, type]);

  useEffect(() => {
    load();
  }, [load, nonce]);

  if (error) return <ErrorState message={error} onRetry={load} />;

  const typeOptions = (data?.availableTypes || Object.keys(EVENT_TYPE_LABEL)).filter(Boolean);

  return (
    <Card>
      <CardHeader
        title="Event timeline"
        subtitle="Ordered by occurrence time with a stable tie-break; late arrivals keep their true position"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Select
              label=""
              aria-label="Filter by event type"
              value={type}
              onChange={(e) => {
                setType(e.target.value);
                setPage(1);
              }}
              className="w-44"
            >
              <option value="">All event types</option>
              {typeOptions.map((t) => (
                <option key={t} value={t}>
                  {EVENT_TYPE_LABEL[t] || t}
                  {data?.typeCounts?.[t] !== undefined ? ` (${data.typeCounts[t]})` : ''}
                </option>
              ))}
            </Select>
            <Button
              variant="secondary"
              size="sm"
              icon={ArrowDownUp}
              onClick={() => setOrder((o) => (o === 'desc' ? 'asc' : 'desc'))}
            >
              {order === 'desc' ? 'Newest first' : 'Oldest first'}
            </Button>
          </div>
        }
      />
      <TimelineList items={data?.items || []} loading={loading && !data} />
      {data && (
        <Pagination
          page={data.page}
          limit={data.limit}
          total={data.total}
          onPageChange={setPage}
          className="border-t border-edge"
        />
      )}
    </Card>
  );
}

function SettingsTab({ project, isAdmin, onChanged, onDeleted }) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Project settings"
          subtitle={
            isAdmin
              ? 'Name, description, repository and environments'
              : 'Only project admins can change these values.'
          }
        />
        <CardBody>
          <ProjectSettingsForm
            project={project}
            canEdit={isAdmin}
            onSaved={() => onChanged()}
            onDeleted={onDeleted}
          />
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <MembersPanel project={project} canManage={isAdmin} onChanged={() => onChanged()} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Integrations"
          subtitle={
            isAdmin
              ? 'GitHub webhook and event ingestion credentials'
              : 'Secrets can only be managed by project admins.'
          }
        />
        <CardBody>
          <IntegrationsPanel projectId={project._id} canManage={isAdmin} />
        </CardBody>
      </Card>
    </div>
  );
}

/* -------------------------------- the page ------------------------------- */

export default function ProjectDetailPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') || 'overview';

  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [nonce, setNonce] = useState(0);
  const [deploymentOpen, setDeploymentOpen] = useState(false);
  const [incidentOpen, setIncidentOpen] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setProject(await api.get(`/projects/${projectId}`));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    setLoading(true);
    setProject(null);
    load();
  }, [load]);

  const bump = useCallback(() => {
    setNonce((n) => n + 1);
    load();
  }, [load]);

  // Realtime: every project room notification refreshes authoritative state.
  useProjectRoom(
    projectId,
    useMemo(
      () => ({
        'incident:created': bump,
        'incident:updated': bump,
        'incident:deleted': bump,
        'comment:added': bump,
        'deployment:created': bump,
        'deployment:updated': bump,
        'event:processed': bump,
      }),
      [bump]
    )
  );

  const role = useMemo(() => {
    if (!project || !user) return null;
    if (user.role === 'admin') return 'admin';
    const membership = (project.members || []).find(
      (m) => String(m.user?._id || m.user) === String(user._id)
    );
    return membership?.role || null;
  }, [project, user]);

  const isAdmin = role === 'admin';
  const canWrite = role === 'admin' || role === 'developer';

  function setTab(next) {
    const params = new URLSearchParams(searchParams);
    params.set('tab', next);
    setSearchParams(params, { replace: true });
  }

  if (loading) return <PageLoader label="Loading project…" />;

  if (error) {
    return (
      <div>
        <PageHeader
          breadcrumbs={[{ label: 'Projects', to: '/projects' }, { label: 'Project' }]}
          title="Project unavailable"
        />
        <ErrorState
          message={error}
          onRetry={() => {
            setLoading(true);
            load();
          }}
        />
      </div>
    );
  }

  if (!project) return null;

  const tabs = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'deployments', label: 'Deployments', icon: Rocket },
    { id: 'incidents', label: 'Incidents', icon: ShieldAlert },
    { id: 'timeline', label: 'Timeline', icon: Clock3 },
    { id: 'settings', label: 'Settings', icon: SettingsIcon },
  ];

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: 'Projects', to: '/projects' }, { label: project.name }]}
        title={project.name}
        description={project.description || undefined}
        actions={
          canWrite ? (
            <>
              <Button variant="secondary" size="sm" icon={Rocket} onClick={() => setDeploymentOpen(true)}>
                Record deployment
              </Button>
              <Button size="sm" icon={Plus} onClick={() => setIncidentOpen(true)}>
                New incident
              </Button>
            </>
          ) : null
        }
      >
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted">
          {(project.environments || []).map((env) => (
            <Badge key={env} tone="primary">
              {env}
            </Badge>
          ))}
          {project.repositoryUrl && (
            <a
              href={project.repositoryUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex cursor-pointer items-center gap-1 transition-colors hover:text-fg"
            >
              Repository <ExternalLink size={11} aria-hidden="true" />
            </a>
          )}
          <span className="tabular">{project.summary?.openIncidents ?? 0} open incidents</span>
          <span aria-hidden="true">·</span>
          <span className="tabular">{project.summary?.totalDeployments ?? 0} deployments</span>
          <span aria-hidden="true">·</span>
          <span className="tabular">{project.summary?.memberCount ?? 0} members</span>
          {project.summary?.lastDeployedAt && (
            <>
              <span aria-hidden="true">·</span>
              <span>last deployed {timeAgo(project.summary.lastDeployedAt)}</span>
            </>
          )}
        </div>
      </PageHeader>

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      <div key={tab} className="route-in mt-5">
        {tab === 'overview' && <DashboardContent projectId={project._id} nonce={nonce} />}
        {tab === 'deployments' && (
          <ScopedDeployments project={project} canWrite={canWrite} nonce={nonce} />
        )}
        {tab === 'incidents' && <ScopedIncidents project={project} nonce={nonce} />}
        {tab === 'timeline' && <ScopedTimeline project={project} nonce={nonce} />}
        {tab === 'settings' && (
          <SettingsTab
            project={project}
            isAdmin={isAdmin}
            onChanged={bump}
            onDeleted={() => navigate('/projects', { replace: true })}
          />
        )}
      </div>

      <DeploymentFormModal
        open={deploymentOpen}
        onClose={() => setDeploymentOpen(false)}
        onSaved={bump}
        fixedProjectId={project._id}
        projects={[project]}
      />
      <IncidentFormModal
        open={incidentOpen}
        onClose={() => setIncidentOpen(false)}
        projectId={project._id}
        environments={project.environments || []}
        members={project.members || []}
        onSaved={(created) => {
          bump();
          if (created?._id) navigate(`/incidents/${created._id}`);
        }}
      />
    </div>
  );
}
