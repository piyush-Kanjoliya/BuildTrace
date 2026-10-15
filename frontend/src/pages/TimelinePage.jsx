import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowDownUp, FolderKanban } from 'lucide-react';
import { PageHeader } from '../components/layout/PageHeader.jsx';
import { TimelineList } from '../components/TimelineList.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Card, CardHeader } from '../components/ui/Card.jsx';
import { EmptyState, ErrorState, PageLoader } from '../components/ui/Feedback.jsx';
import { Select } from '../components/ui/Field.jsx';
import { Pagination } from '../components/ui/Pagination.jsx';
import { useProjectRoom } from '../context/SocketContext.jsx';
import { api } from '../lib/api.js';
import { EVENT_TYPE_LABEL } from '../lib/constants.js';

/**
 * Global event timeline. Like every list in BuildTrace it is ordered by when
 * events actually occurred (with a stable tie-break), not when they arrived -
 * so late-ingested events keep their true position in history.
 */
export default function TimelinePage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const projectId = searchParams.get('project') || '';

  const [projects, setProjects] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [order, setOrder] = useState('desc');
  const [type, setType] = useState('');

  useEffect(() => {
    api
      .get('/projects', { params: { limit: 100 } })
      .then((result) => {
        const items = result.items || [];
        setProjects(items);
        if (!projectId && items.length) {
          setSearchParams({ project: items[0]._id }, { replace: true });
        }
      })
      .catch(() => setProjects([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reset view state whenever the selected project changes.
  useEffect(() => {
    setPage(1);
    setType('');
    setData(null);
  }, [projectId]);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      setData(
        await api.get(`/projects/${projectId}/timeline`, {
          params: { page, limit: 30, order, types: type || undefined },
        })
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [projectId, page, order, type]);

  useEffect(() => {
    load();
  }, [load]);

  // Realtime: any event or record change refetches the project timeline.
  useProjectRoom(
    projectId,
    useMemo(
      () => ({
        'event:processed': load,
        'deployment:created': load,
        'deployment:updated': load,
        'incident:created': load,
        'incident:updated': load,
        'comment:added': load,
      }),
      [load]
    )
  );

  if (projects === null) return <PageLoader label="Loading projects…" />;

  if (!projects.length) {
    return (
      <div>
        <PageHeader title="Timeline" description="Everything that happened, in order." />
        <EmptyState
          icon={FolderKanban}
          title="No projects yet"
          message="A timeline is scoped to a project. Create your first project to start collecting events."
          action={
            <Button onClick={() => navigate('/projects?create=1')}>Create a project</Button>
          }
        />
      </div>
    );
  }

  const typeOptions = (data?.availableTypes || Object.keys(EVENT_TYPE_LABEL)).filter(Boolean);
  const activeProject = projects.find((p) => p._id === projectId);

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: 'Timeline' }]}
        title="Timeline"
        description="Ordered by occurrence time with a stable tie-break - late arrivals keep their true position in history."
      />

      <Card>
        <CardHeader
          title={activeProject ? `${activeProject.name} events` : 'Events'}
          subtitle="Deployments, incidents, commits, rollbacks and investigations"
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Select
                label=""
                aria-label="Project"
                value={projectId}
                onChange={(e) => setSearchParams({ project: e.target.value })}
                className="w-48"
              >
                {projects.map((p) => (
                  <option key={p._id} value={p._id}>
                    {p.name}
                  </option>
                ))}
              </Select>
              <Select
                label=""
                aria-label="Filter by event type"
                value={type}
                onChange={(e) => {
                  setType(e.target.value);
                  setPage(1);
                }}
                className="w-48"
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
                aria-label="Toggle chronological order"
              >
                {order === 'desc' ? 'Newest first' : 'Oldest first'}
              </Button>
            </div>
          }
        />

        {error ? (
          <ErrorState message={error} onRetry={load} />
        ) : (
          <>
            <TimelineList
              items={data?.items || []}
              loading={loading && !data}
              emptyMessage={
                type
                  ? 'No events of this type in the current view. Try another type.'
                  : 'No events yet. Deployments, incidents and webhook activity will appear here.'
              }
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
          </>
        )}
      </Card>
    </div>
  );
}
