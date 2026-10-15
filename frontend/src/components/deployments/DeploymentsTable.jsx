import { Link } from 'react-router-dom';
import { Rocket } from 'lucide-react';
import { DeploymentStatusBadge } from '../ui/Badge.jsx';
import { Button } from '../ui/Button.jsx';
import { EmptyState, TableSkeleton } from '../ui/Feedback.jsx';
import { formatFull, orDash, shortSha, timeAgo } from '../../lib/format.js';

const COLS = ['Release', 'Environment', 'Status', 'Service', 'Author', 'Occurred', 'Source'];

/**
 * Deployment table shared by the global Deployments page and the project
 * detail tab. "Details" opens the investigation drawer for a deployment.
 */
export function DeploymentsTable({
  items = [],
  loading = false,
  showProject = false,
  onSelect = null,
  emptyTitle = 'No deployments found',
  emptyMessage = 'Nothing matches the current filters. Deployments appear here once created or ingested.',
}) {
  if (loading) return <TableSkeleton rows={6} cols={showProject ? 7 : 6} />;

  if (!items.length) {
    return <EmptyState icon={Rocket} title={emptyTitle} message={emptyMessage} />;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[780px] text-left text-sm">
        <thead>
          <tr className="border-b border-edge">
            {COLS.filter((c) => c !== 'Source' || showProject).map((c) => (
              <th key={c} className="px-5 py-3 text-[11px] font-medium uppercase tracking-wide text-faint">
                {c}
              </th>
            ))}
            <th className="px-5 py-3" aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {items.map((dep) => {
            const project = dep.projectId && typeof dep.projectId === 'object' ? dep.projectId : null;
            return (
              <tr
                key={dep._id}
                className="border-b border-edge/60 transition-colors last:border-0 hover:bg-surface-2/50"
              >
                <td className="px-5 py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-fg">
                      {dep.version && dep.version !== 'unknown' ? `v${dep.version}` : 'Deployment'}
                    </span>
                    {dep.commitSha && (
                      <code className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[11px] text-accent-300">
                        {shortSha(dep.commitSha)}
                      </code>
                    )}
                  </div>
                  {showProject && project && (
                    <Link
                      to={`/projects/${project._id}`}
                      className="mt-0.5 block cursor-pointer text-xs text-faint transition-colors hover:text-primary-300"
                    >
                      {project.name}
                    </Link>
                  )}
                </td>
                <td className="px-5 py-3 text-muted">{orDash(dep.environment)}</td>
                <td className="px-5 py-3">
                  <DeploymentStatusBadge status={dep.status} />
                </td>
                <td className="px-5 py-3 text-muted">{orDash(dep.service)}</td>
                <td className="px-5 py-3 text-muted">
                  {dep.actor?.name || dep.actor?.userId?.name || orDash(dep.actor?.type)}
                </td>
                <td className="px-5 py-3 text-muted tabular" title={formatFull(dep.occurredAt)}>
                  {timeAgo(dep.occurredAt)}
                </td>
                {showProject && <td className="px-5 py-3 text-faint">{dep.source}</td>}
                <td className="px-5 py-3 text-right">
                  {onSelect && (
                    <Button variant="ghost" size="xs" onClick={() => onSelect(dep)}>
                      Details
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
