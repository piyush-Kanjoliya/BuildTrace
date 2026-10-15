import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ExternalLink, FolderKanban, Plus } from 'lucide-react';
import { PageHeader } from '../components/layout/PageHeader.jsx';
import { ProjectFormModal } from '../components/project/ProjectFormModal.jsx';
import { Badge } from '../components/ui/Badge.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Card, CardBody } from '../components/ui/Card.jsx';
import { EmptyState, ErrorState, Skeleton } from '../components/ui/Feedback.jsx';
import { Input } from '../components/ui/Field.jsx';
import { Pagination } from '../components/ui/Pagination.jsx';
import { api } from '../lib/api.js';
import { timeAgo } from '../lib/format.js';

const LIMIT = 9;

function ProjectCard({ project, onOpen }) {
  const openIncidents = project.summary?.openIncidents || 0;
  return (
    <Card className="flex flex-col transition-colors hover:border-edge-strong">
      <CardBody className="flex flex-1 flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Link
              to={`/projects/${project._id}`}
              className="cursor-pointer text-base font-semibold text-fg transition-colors hover:text-primary-300"
            >
              {project.name}
            </Link>
            <p className="mt-0.5 text-xs text-faint">Created {timeAgo(project.createdAt)}</p>
          </div>
          <Badge tone="neutral" className="shrink-0">
            {project.slug}
          </Badge>
        </div>

        {project.description && (
          <p className="line-clamp-2 text-sm leading-relaxed text-muted">{project.description}</p>
        )}

        {(project.environments || []).length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {project.environments.map((env) => (
              <Badge key={env} tone="primary">
                {env}
              </Badge>
            ))}
          </div>
        )}

        <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-edge pt-3 text-xs text-muted">
          <span className="tabular">
            {project.memberCount ?? project.members?.length ?? 0} member
            {(project.memberCount ?? project.members?.length) === 1 ? '' : 's'}
          </span>
          <span className={openIncidents > 0 ? 'tabular text-danger' : 'tabular'}>
            {openIncidents} open incident{openIncidents === 1 ? '' : 's'}
          </span>
          <span className="tabular">{project.summary?.deployments ?? 0} deployments</span>
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={onOpen}>
            Open project
          </Button>
          {project.repositoryUrl && (
            <a
              href={project.repositoryUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-muted transition-colors hover:text-fg"
            >
              Repository <ExternalLink size={12} aria-hidden="true" />
            </a>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

export default function ProjectsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const createOpen = searchParams.get('create') === '1';

  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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
      const result = await api.get('/projects', {
        params: { q: debouncedQ || undefined, page, limit: LIMIT },
      });
      setData(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [debouncedQ, page]);

  useEffect(() => {
    load();
  }, [load]);

  function closeCreate() {
    const next = new URLSearchParams(searchParams);
    next.delete('create');
    setSearchParams(next, { replace: true });
  }

  const items = data?.items || [];

  return (
    <div>
      <PageHeader
        title="Projects"
        description="Each project owns its deployments, incidents, events and team."
        actions={
          <Button icon={Plus} onClick={() => setSearchParams({ create: '1' })}>
            New project
          </Button>
        }
      />

      <div className="mb-5 max-w-md">
        <Input
          label="Search projects"
          placeholder="Name, slug or description…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {error && <ErrorState message={error} onRetry={load} />}

      {!error && loading && !data && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-56" />
          ))}
        </div>
      )}

      {!error && data && items.length === 0 && (
        <Card>
          <EmptyState
            icon={FolderKanban}
            title={debouncedQ ? 'No projects match your search' : 'No projects yet'}
            message={
              debouncedQ
                ? 'Try a different search term.'
                : 'Create your first project to start recording deployments and incidents.'
            }
            action={
              !debouncedQ ? (
                <Button icon={Plus} onClick={() => setSearchParams({ create: '1' })}>
                  Create project
                </Button>
              ) : null
            }
          />
        </Card>
      )}

      {!error && items.length > 0 && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((project) => (
              <ProjectCard
                key={project._id}
                project={project}
                onOpen={() => navigate(`/projects/${project._id}`)}
              />
            ))}
          </div>
          <div className="mt-4 rounded-xl border border-edge bg-surface">
            <Pagination
              page={data.page}
              limit={data.limit}
              total={data.total}
              onPageChange={setPage}
            />
          </div>
        </>
      )}

      <ProjectFormModal
        open={createOpen}
        onClose={closeCreate}
        onCreated={(project) => {
          load();
          navigate(`/projects/${project._id}`);
        }}
      />
    </div>
  );
}
