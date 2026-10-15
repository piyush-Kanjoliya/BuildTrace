import { Link } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { IncidentStatusBadge, SeverityBadge } from '../ui/Badge.jsx';
import { EmptyState, TableSkeleton } from '../ui/Feedback.jsx';
import { formatFull, orDash, timeAgo } from '../../lib/format.js';

const COLS = ['Incident', 'Severity', 'Status', 'Project', 'Assignee', 'Created'];

/**
 * Incident table shared by the global Incidents page and the project detail
 * tab. Titles link to the investigation workspace.
 */
export function IncidentsTable({
  items = [],
  loading = false,
  showProject = false,
  emptyAction = null,
  emptyTitle = 'No incidents found',
  emptyMessage = 'Nothing matches the current filters. Adjust the filters or open a new incident.',
}) {
  if (loading) return <TableSkeleton rows={6} cols={showProject ? 6 : 5} />;

  if (!items.length) {
    return <EmptyState icon={ShieldAlert} title={emptyTitle} message={emptyMessage} action={emptyAction} />;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead>
          <tr className="border-b border-edge">
            {COLS.filter((c) => c !== 'Project' || showProject).map((c) => (
              <th key={c} className="px-5 py-3 text-[11px] font-medium uppercase tracking-wide text-faint">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((inc) => {
            const project = inc.projectId && typeof inc.projectId === 'object' ? inc.projectId : null;
            return (
              <tr
                key={inc._id}
                className="border-b border-edge/60 transition-colors last:border-0 hover:bg-surface-2/50"
              >
                <td className="max-w-[340px] px-5 py-3">
                  <Link
                    to={`/incidents/${inc._id}`}
                    className="cursor-pointer font-medium text-fg transition-colors hover:text-primary-300"
                  >
                    {inc.title}
                  </Link>
                  <p className="mt-0.5 truncate text-xs text-faint">
                    {orDash(inc.affectedService)}
                    {inc.environment ? ` · ${inc.environment}` : ''}
                  </p>
                </td>
                <td className="px-5 py-3">
                  <SeverityBadge severity={inc.severity} />
                </td>
                <td className="px-5 py-3">
                  <IncidentStatusBadge status={inc.status} />
                </td>
                {showProject && (
                  <td className="px-5 py-3 text-muted">
                    {project ? (
                      <Link
                        to={`/projects/${project._id}`}
                        className="cursor-pointer transition-colors hover:text-primary-300"
                      >
                        {project.name}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                )}
                <td className="px-5 py-3 text-muted">{inc.assigneeId?.name || '—'}</td>
                <td className="px-5 py-3 text-muted tabular" title={formatFull(inc.createdAt)}>
                  {timeAgo(inc.createdAt)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
