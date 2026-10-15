import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Rocket } from 'lucide-react';
import { DeploymentDetailModal } from '../components/deployments/DeploymentDetailModal.jsx';
import { DeploymentFormModal } from '../components/deployments/DeploymentFormModal.jsx';
import { DeploymentsTable } from '../components/deployments/DeploymentsTable.jsx';
import { PageHeader } from '../components/layout/PageHeader.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Card, CardBody, CardHeader } from '../components/ui/Card.jsx';
import { ErrorState } from '../components/ui/Feedback.jsx';
import { Input, Select } from '../components/ui/Field.jsx';
import { Pagination } from '../components/ui/Pagination.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../lib/api.js';
import { DEPLOYMENT_STATUSES, DEPLOYMENT_STATUS_META } from '../lib/constants.js';

const EMPTY_FILTERS = {
  projectId: '',
  environment: '',
  status: '',
  author: '',
  from: '',
  to: '',
};

/** Role of the user on the project a deployment belongs to. */
function canEditDeployment(user, projects, dep) {
  if (!user || !dep) return false;
  if (user.role === 'admin') return true;
  const projectId = typeof dep.projectId === 'object' ? dep.projectId?._id : dep.projectId;
  const project = projects.find((p) => p._id === projectId);
  const membership = project?.members?.find(
    (m) => String(m.user?._id || m.user) === String(user._id)
  );
  return membership?.role === 'admin' || membership?.role === 'developer';
}

export default function DeploymentsPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const createOpen = searchParams.get('create') === '1';

  const [projects, setProjects] = useState([]);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [applied, setApplied] = useState(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    api
      .get('/projects', { params: { limit: 100 } })
      .then((result) => setProjects(result.items || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setApplied(filters);
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [filters]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(
        await api.get('/deployments', {
          params: {
            projectId: applied.projectId || undefined,
            environment: applied.environment.trim() || undefined,
            status: applied.status || undefined,
            author: applied.author.trim() || undefined,
            from: applied.from ? new Date(applied.from).toISOString() : undefined,
            to: applied.to ? new Date(applied.to).toISOString() : undefined,
            page,
            limit: 20,
          },
        })
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [applied, page]);

  useEffect(() => {
    load();
  }, [load]);

  const set = (field) => (e) => setFilters((f) => ({ ...f, [field]: e.target.value }));

  function closeCreate() {
    const next = new URLSearchParams(searchParams);
    next.delete('create');
    setSearchParams(next, { replace: true });
  }

  const hasFilters = Object.values(applied).some(Boolean);

  return (
    <div>
      <PageHeader
        title="Deployments"
        description="Every deployment across your projects, with occurrence and receipt timestamps."
        actions={
          <Button icon={Rocket} onClick={() => setSearchParams({ create: '1' })}>
            Record deployment
          </Button>
        }
      />

      <Card>
        <CardHeader
          title="Filters"
          actions={
            hasFilters ? (
              <Button
                variant="ghost"
                size="xs"
                onClick={() => {
                  setFilters(EMPTY_FILTERS);
                  setApplied(EMPTY_FILTERS);
                  setPage(1);
                }}
              >
                Clear filters
              </Button>
            ) : null
          }
        />
        <CardBody className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <Select label="Project" value={filters.projectId} onChange={set('projectId')}>
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p._id} value={p._id}>
                {p.name}
              </option>
            ))}
          </Select>
          <Select label="Status" value={filters.status} onChange={set('status')}>
            <option value="">All statuses</option>
            {DEPLOYMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {DEPLOYMENT_STATUS_META[s].label}
              </option>
            ))}
          </Select>
          <Input
            label="Environment"
            value={filters.environment}
            onChange={set('environment')}
            placeholder="production"
          />
          <Input
            label="Author"
            value={filters.author}
            onChange={set('author')}
            placeholder="Name or automation"
          />
          <Input label="From" type="date" value={filters.from} onChange={set('from')} />
          <Input label="To" type="date" value={filters.to} onChange={set('to')} />
        </CardBody>
      </Card>

      <div className="mt-5">
        {error ? (
          <ErrorState message={error} onRetry={load} />
        ) : (
          <Card>
            <DeploymentsTable
              items={data?.items || []}
              loading={loading && !data}
              showProject
              onSelect={setSelected}
              emptyMessage={
                hasFilters
                  ? 'Nothing matches the current filters. Adjust or clear them.'
                  : 'No deployments yet. Record one or ingest events.'
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
          </Card>
        )}
      </div>

      <DeploymentFormModal
        open={createOpen}
        onClose={closeCreate}
        onSaved={load}
        projects={projects}
      />
      <DeploymentDetailModal
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        deploymentId={selected?._id}
        canWrite={canEditDeployment(user, projects, selected)}
        onUpdated={load}
      />
    </div>
  );
}
