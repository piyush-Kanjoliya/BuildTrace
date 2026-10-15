import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, FolderKanban, Info, Users } from 'lucide-react';
import { PageHeader } from '../components/layout/PageHeader.jsx';
import { RoleBadge } from '../components/ui/Badge.jsx';
import { Card, CardBody, CardHeader } from '../components/ui/Card.jsx';
import { EmptyState, ErrorState, Skeleton } from '../components/ui/Feedback.jsx';
import { Input } from '../components/ui/Field.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../lib/api.js';
import { formatDateTime, initials, timeAgo } from '../lib/format.js';

function Avatar({ name, size = 'md' }) {
  const dims = size === 'lg' ? 'h-14 w-14 text-lg' : 'h-9 w-9 text-xs';
  return (
    <span
      className={`flex ${dims} shrink-0 items-center justify-center rounded-full border border-edge bg-surface-2 font-semibold text-primary-300`}
      aria-hidden="true"
    >
      {initials(name) || '?'}
    </span>
  );
}

/**
 * Settings & Team. Profile data comes from the authenticated /auth/me record
 * (there is no self-service profile editing endpoint - and we do not fake
 * one), the directory comes from the authenticated /users search, and "my
 * access" derives the caller's role per project from the project documents.
 */
export default function SettingsPage() {
  const { user } = useAuth();

  /* ------------------------------ directory ------------------------------ */

  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [users, setUsers] = useState(null);
  const [directoryError, setDirectoryError] = useState(null);
  const [directoryLoading, setDirectoryLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(timer);
  }, [q]);

  const loadDirectory = useCallback(async () => {
    setDirectoryLoading(true);
    setDirectoryError(null);
    try {
      const result = await api.get('/users', {
        params: { q: debouncedQ || undefined, limit: 50 },
      });
      setUsers(result.items || []);
    } catch (err) {
      setDirectoryError(err.message);
    } finally {
      setDirectoryLoading(false);
    }
  }, [debouncedQ]);

  useEffect(() => {
    loadDirectory();
  }, [loadDirectory]);

  /* ------------------------------- access -------------------------------- */

  const [projects, setProjects] = useState(null);

  useEffect(() => {
    api
      .get('/projects', { params: { limit: 100 } })
      .then((result) => setProjects(result.items || []))
      .catch(() => setProjects([]));
  }, []);

  const accessRows = (projects || [])
    .map((project) => {
      const membership = (project.members || []).find(
        (m) => String(m.user?._id || m.user) === String(user?._id)
      );
      const role = membership?.role || (user?.role === 'admin' ? 'admin' : null);
      return role ? { project, role, viaGlobalAdmin: !membership } : null;
    })
    .filter(Boolean);

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: 'Settings & Team' }]}
        title="Settings & Team"
        description="Your profile, the workspace directory and the access you hold across projects."
      />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ------------------------------ profile --------------------------- */}
        <div className="space-y-6">
          <Card>
            <CardHeader title="Your profile" subtitle="From your authenticated session" />
            <CardBody>
              <div className="flex items-center gap-4">
                <Avatar name={user?.name} size="lg" />
                <div className="min-w-0">
                  <p className="truncate font-semibold text-fg">{user?.name}</p>
                  <p className="truncate text-sm text-muted">{user?.email}</p>
                </div>
              </div>

              <dl className="mt-5 divide-y divide-edge/60 border-t border-edge/60">
                <div className="flex items-center justify-between gap-3 py-2">
                  <dt className="text-xs text-faint">Global role</dt>
                  <dd>
                    <RoleBadge role={user?.role} />
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3 py-2">
                  <dt className="text-xs text-faint">Member since</dt>
                  <dd className="text-sm text-muted">
                    {user?.createdAt ? formatDateTime(user.createdAt) : '—'}
                  </dd>
                </div>
              </dl>

              <p className="mt-4 flex items-start gap-2 rounded-lg border border-edge bg-surface-2/50 px-3 py-2 text-xs leading-relaxed text-muted">
                <Info size={14} className="mt-0.5 shrink-0 text-faint" aria-hidden="true" />
                Profile details are managed by your workspace administrator - self-service
                editing is not part of this release.
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="My access"
              subtitle={
                user?.role === 'admin'
                  ? 'As a global admin you can manage every project.'
                  : 'Roles you hold on each project'
              }
            />
            <CardBody className="space-y-1">
              {projects === null ? (
                <Skeleton lines={3} />
              ) : accessRows.length === 0 ? (
                <p className="text-sm text-muted">
                  You are not a member of any project yet.{' '}
                  <Link to="/projects" className="text-primary-300 transition-colors hover:text-primary-200">
                    Browse projects
                  </Link>
                </p>
              ) : (
                <ul className="divide-y divide-edge/60">
                  {accessRows.map(({ project, role, viaGlobalAdmin }) => (
                    <li
                      key={project._id}
                      className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-fg">{project.name}</p>
                        <p className="text-xs text-faint">
                          {(project.environments || []).slice(0, 3).join(' · ')}
                        </p>
                      </div>
                      <RoleBadge role={role} />
                      {viaGlobalAdmin && (
                        <span className="text-[10px] uppercase tracking-wide text-faint">
                          via admin
                        </span>
                      )}
                      <Link
                        to={`/projects/${project._id}?tab=settings`}
                        className="inline-flex cursor-pointer items-center gap-1 text-xs text-primary-300 transition-colors hover:text-primary-200"
                      >
                        Manage <ExternalLink size={11} aria-hidden="true" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>

        {/* ----------------------------- directory -------------------------- */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader
              title="Team directory"
              subtitle="Everyone in the workspace - search by name or email"
              actions={
                <Input
                  label=""
                  aria-label="Search teammates"
                  placeholder="Search teammates…"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  className="w-56"
                />
              }
            />
            {directoryError ? (
              <ErrorState message={directoryError} onRetry={loadDirectory} />
            ) : directoryLoading && !users ? (
              <CardBody>
                <Skeleton lines={4} />
              </CardBody>
            ) : users && users.length === 0 ? (
              <EmptyState
                icon={Users}
                title="No teammates found"
                message={
                  debouncedQ
                    ? `Nobody matches "${debouncedQ}". Try a different name or email.`
                    : 'The workspace has no users yet.'
                }
                className="py-10"
              />
            ) : (
              <ul className="divide-y divide-edge/70">
                {(users || []).map((member) => (
                  <li
                    key={member._id}
                    className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3"
                  >
                    <Avatar name={member.name} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-fg">
                        {member.name}
                        {member._id === user?._id && (
                          <span className="ml-2 text-xs font-normal text-faint">(you)</span>
                        )}
                      </p>
                      <p className="truncate text-xs text-muted">{member.email}</p>
                    </div>
                    <RoleBadge role={member.role} />
                    <span
                      className="hidden w-24 text-right text-xs text-faint sm:block"
                      title={member.createdAt ? formatDateTime(member.createdAt) : undefined}
                    >
                      {member.createdAt ? timeAgo(member.createdAt) : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="mt-6">
            <CardBody className="flex flex-wrap items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-edge bg-surface-2">
                <FolderKanban size={16} className="text-faint" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-fg">Project-level settings</p>
                <p className="mt-0.5 text-sm text-muted">
                  Environments, members and integration secrets live on each project's Settings
                  tab, where they are scoped to that project's admins.
                </p>
              </div>
              <Link
                to="/projects"
                className="inline-flex cursor-pointer items-center gap-1 text-sm text-primary-300 transition-colors hover:text-primary-200"
              >
                Open projects <ExternalLink size={12} aria-hidden="true" />
              </Link>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
