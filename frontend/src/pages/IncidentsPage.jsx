import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { IncidentFormModal } from '../components/incidents/IncidentFormModal.jsx';
import { IncidentsTable } from '../components/incidents/IncidentsTable.jsx';
import { PageHeader } from '../components/layout/PageHeader.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Card, CardBody, CardHeader } from '../components/ui/Card.jsx';
import { ErrorState } from '../components/ui/Feedback.jsx';
import { Input, Select } from '../components/ui/Field.jsx';
import { Pagination } from '../components/ui/Pagination.jsx';
import { api } from '../lib/api.js';
import { INCIDENT_STATUS_META, SEVERITIES } from '../lib/constants.js';

const EMPTY_FILTERS = { q: '', status: '', severity: '', environment: '', sort: '' };

export default function IncidentsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const createOpen = searchParams.get('create') === '1';

  const [projects, setProjects] = useState([]);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [applied, setApplied] = useState(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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
        await api.get('/incidents', {
          params: {
            q: applied.q.trim() || undefined,
            status: applied.status || undefined,
            severity: applied.severity || undefined,
            environment: applied.environment.trim() || undefined,
            sort: applied.sort || undefined,
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
        title="Incidents"
        description="Searchable incident register across every project you belong to."
        actions={
          <Button icon={ShieldAlert} onClick={() => setSearchParams({ create: '1' })}>
            Report incident
          </Button>
        }
      />

      <Card>
        <CardHeader
          title="Filters"
          subtitle="Search matches title, description and affected service"
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
        <CardBody className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <Input
            label="Search"
            value={filters.q}
            onChange={set('q')}
            placeholder="Title, description, service…"
          />
          <Select label="Status" value={filters.status} onChange={set('status')}>
            <option value="">All statuses</option>
            {Object.entries(INCIDENT_STATUS_META).map(([value, meta]) => (
              <option key={value} value={value}>
                {meta.label}
              </option>
            ))}
          </Select>
          <Select label="Severity" value={filters.severity} onChange={set('severity')}>
            <option value="">All severities</option>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
          <Input
            label="Environment"
            value={filters.environment}
            onChange={set('environment')}
            placeholder="production"
          />
          <Select label="Sort" value={filters.sort} onChange={set('sort')}>
            <option value="">Newest first</option>
            <option value="createdAt">Oldest first</option>
            <option value="-updatedAt">Recently updated</option>
            <option value="severity">Most severe first</option>
          </Select>
        </CardBody>
      </Card>

      <div className="mt-5">
        {error ? (
          <ErrorState message={error} onRetry={load} />
        ) : (
          <Card>
            <IncidentsTable
              items={data?.items || []}
              loading={loading && !data}
              showProject
              emptyMessage={
                hasFilters
                  ? 'Nothing matches the current filters. Adjust or clear them.'
                  : 'No incidents yet. Report one when something breaks.'
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

      <IncidentFormModal
        open={createOpen}
        onClose={closeCreate}
        projects={projects}
        onSaved={(created) => {
          load();
          if (created?._id) navigate(`/incidents/${created._id}`);
        }}
      />
    </div>
  );
}
