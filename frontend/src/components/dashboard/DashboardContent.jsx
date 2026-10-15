import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  FolderKanban,
  Rocket,
  ShieldAlert,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Badge, DeploymentStatusBadge, IncidentStatusBadge, SeverityBadge } from '../ui/Badge.jsx';
import { Card, CardBody, CardHeader } from '../ui/Card.jsx';
import { ErrorState } from '../ui/Feedback.jsx';
import { StatCard } from '../ui/StatCard.jsx';
import { TimelineList } from '../TimelineList.jsx';
import { api } from '../../lib/api.js';
import {
  CHART_COLORS,
  DEPLOYMENT_STATUS_META,
  INCIDENT_STATUS_META,
  SEVERITIES,
} from '../../lib/constants.js';
import { cx, orDash, percent, timeAgo } from '../../lib/format.js';

const TOOLTIP_STYLE = {
  backgroundColor: '#101221',
  border: '1px solid #232848',
  borderRadius: 10,
  fontSize: 12,
  color: '#eef0fa',
};

const SEVERITY_BAR = { SEV1: 'bg-sev1', SEV2: 'bg-sev2', SEV3: 'bg-sev3', SEV4: 'bg-sev4' };
const STATUS_BAR = {
  open: 'bg-danger',
  investigating: 'bg-warning',
  monitoring: 'bg-accent-400',
  resolved: 'bg-success',
};
const DEPLOYMENT_BAR = {
  success: 'bg-success',
  failed: 'bg-danger',
  in_progress: 'bg-accent-400',
  rolled_back: 'bg-warning',
  cancelled: 'bg-muted',
};

function TrendChart({ trends }) {
  const data = useMemo(
    () =>
      (trends?.incidents || []).map((row, i) => ({
        date: row.date,
        incidents: row.count,
        deployments: trends.deployments?.[i]?.count ?? 0,
      })),
    [trends]
  );

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
          <defs>
            <linearGradient id="gradIncidents" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART_COLORS.primary} stopOpacity={0.35} />
              <stop offset="100%" stopColor={CHART_COLORS.primary} stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gradDeployments" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART_COLORS.accent} stopOpacity={0.28} />
              <stop offset="100%" stopColor={CHART_COLORS.accent} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#232848" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={(d) => d.slice(5)}
            stroke="#6d7395"
            tickLine={false}
            axisLine={false}
            fontSize={11}
          />
          <YAxis
            allowDecimals={false}
            stroke="#6d7395"
            tickLine={false}
            axisLine={false}
            fontSize={11}
            width={34}
          />
          <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: '#a2a8c8' }} />
          <Legend wrapperStyle={{ fontSize: 12, color: '#a2a8c8' }} />
          <Area
            type="monotone"
            dataKey="incidents"
            name="Incidents"
            stroke={CHART_COLORS.primary}
            fill="url(#gradIncidents)"
            strokeWidth={2}
          />
          <Area
            type="monotone"
            dataKey="deployments"
            name="Deployments"
            stroke={CHART_COLORS.accent}
            fill="url(#gradDeployments)"
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Horizontal distribution bars - label + count + proportional bar. */
function Bars({ rows }) {
  const total = rows.reduce((sum, r) => sum + (r.count || 0), 0) || 1;
  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <li key={row.key}>
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2">{row.badge}</span>
            <span className="tabular text-sm text-fg">{row.count || 0}</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-3">
            <div
              className={cx('h-full rounded-full transition-[width] duration-300', row.barClass)}
              style={{ width: `${percent(row.count || 0, total)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Dashboard metrics for the whole workspace (projectId = null) or a single
 * project. Every number is aggregated server-side from MongoDB.
 */
export function DashboardContent({ projectId = null, nonce = 0 }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await api.get(projectId ? `/projects/${projectId}/dashboard` : '/dashboard');
      setData(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load, nonce]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <DashboardSkeleton />;

  const { totals, incidents, deployments, trends, recentIncidents, recentDeployments, recentActivity, recurringIssues } =
    data;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Projects"
          value={totals.projects}
          icon={FolderKanban}
          hint={data.scope === 'user' ? 'Projects you belong to' : 'All projects'}
          loading={loading && !data}
        />
        <StatCard
          label="Open incidents"
          value={totals.openIncidents}
          icon={ShieldAlert}
          tone={totals.openIncidents ? 'danger' : 'default'}
          hint="Open · investigating · monitoring"
        />
        <StatCard
          label="Critical open"
          value={totals.criticalOpen}
          icon={AlertTriangle}
          tone={totals.criticalOpen ? 'warning' : 'default'}
          hint={`${totals.criticalIncidents} SEV1 recorded all-time`}
        />
        <StatCard
          label="Resolved incidents"
          value={totals.resolvedIncidents}
          icon={CheckCircle2}
          tone="success"
          hint="All-time"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title={`Trends - last ${trends.days} days`}
            subtitle="Incidents created and deployments recorded per day"
          />
          <CardBody>
            <TrendChart trends={trends} />
          </CardBody>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Incidents by severity" subtitle="All time in scope" />
            <CardBody>
              <Bars
                rows={SEVERITIES.map((sev) => ({
                  key: sev,
                  count: incidents.bySeverity[sev],
                  badge: <SeverityBadge severity={sev} />,
                  barClass: SEVERITY_BAR[sev],
                }))}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Incidents by status" subtitle="All time in scope" />
            <CardBody>
              <Bars
                rows={Object.keys(INCIDENT_STATUS_META).map((status) => ({
                  key: status,
                  count: incidents.byStatus[status],
                  badge: <IncidentStatusBadge status={status} dot={false} />,
                  barClass: STATUS_BAR[status],
                }))}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader
              title="Deployments by status"
              subtitle={`Last ${deployments.windowDays} days`}
            />
            <CardBody>
              <Bars
                rows={Object.keys(DEPLOYMENT_STATUS_META).map((status) => ({
                  key: status,
                  count: deployments.byStatus[status],
                  badge: <DeploymentStatusBadge status={status} dot={false} />,
                  barClass: DEPLOYMENT_BAR[status],
                }))}
              />
            </CardBody>
          </Card>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader
            title="Recent incidents"
            actions={
              <Link
                to="/incidents"
                className="cursor-pointer text-xs text-primary-300 transition-colors hover:text-primary-400"
              >
                View all
              </Link>
            }
          />
          <CardBody className="space-y-1">
            {recentIncidents.length === 0 && (
              <p className="py-4 text-sm text-faint">No incidents recorded yet.</p>
            )}
            {recentIncidents.map((inc) => (
              <Link
                key={inc._id}
                to={`/incidents/${inc._id}`}
                className="block cursor-pointer rounded-lg px-2 py-2 transition-colors hover:bg-surface-2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <SeverityBadge severity={inc.severity} />
                  <IncidentStatusBadge status={inc.status} dot={false} />
                  <span className="ml-auto text-xs text-faint tabular">{timeAgo(inc.createdAt)}</span>
                </div>
                <p className="mt-1.5 truncate text-sm font-medium text-fg">{inc.title}</p>
                <p className="truncate text-xs text-faint">
                  {inc.projectId?.name || '—'}
                  {inc.assigneeId ? ` · assigned to ${inc.assigneeId.name}` : ' · unassigned'}
                </p>
              </Link>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Recent deployments"
            actions={
              <Link
                to="/deployments"
                className="cursor-pointer text-xs text-primary-300 transition-colors hover:text-primary-400"
              >
                View all
              </Link>
            }
          />
          <CardBody className="space-y-1">
            {recentDeployments.length === 0 && (
              <p className="py-4 text-sm text-faint">No deployments recorded yet.</p>
            )}
            {recentDeployments.map((dep) => (
              <div key={dep._id} className="rounded-lg px-2 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-fg">
                    {dep.version && dep.version !== 'unknown' ? `v${dep.version}` : 'Deployment'}
                  </span>
                  <Badge tone="neutral">{dep.environment}</Badge>
                  <DeploymentStatusBadge status={dep.status} dot={false} />
                  <span className="ml-auto text-xs text-faint tabular">{timeAgo(dep.occurredAt)}</span>
                </div>
                <p className="mt-1 truncate text-xs text-faint">
                  {orDash(dep.service)} {dep.actor?.name ? `· ${dep.actor.name}` : ''}
                </p>
              </div>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Recent activity" subtitle="Events by occurrence time" />
          <CardBody className="p-0">
            <TimelineList
              items={recentActivity}
              emptyTitle="No activity yet"
              emptyMessage="Deployments, commits and incidents appear here as they are ingested."
            />
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Recurring issues"
          subtitle={`Incidents sharing the same normalized title signature (digits → #) within a project, ${recurringIssues.minOccurrences}+ occurrences`}
        />
        <CardBody>
          {recurringIssues.groups.length === 0 ? (
            <p className="text-sm text-faint">
              No recurring incident signatures detected yet. This rule is deterministic text matching, not statistical
              clustering.
            </p>
          ) : (
            <ul className="divide-y divide-edge/60">
              {recurringIssues.groups.map((group) => (
                <li key={`${group.projectId}-${group.signature}`} className="flex flex-wrap items-center gap-3 py-3">
                  <Badge tone="primary">{group.count}×</Badge>
                  <div className="min-w-0 flex-1">
                    <Link
                      to={`/incidents/${group.incidentIds[0]}`}
                      className="cursor-pointer text-sm font-medium text-fg transition-colors hover:text-primary-300"
                    >
                      {group.sampleTitle}
                    </Link>
                    <p className="mt-0.5 text-xs text-faint">
                      {group.projectName} · signature "{group.signature}" · last {timeAgo(group.lastOccurredAt)}
                      {group.openCount > 0 ? ` · ${group.openCount} still open` : ''}
                    </p>
                  </div>
                  <SeverityBadge severity={group.highestSeverity} />
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 rounded-lg bg-surface-2/60 px-3 py-2 text-xs leading-relaxed text-faint">
            {recurringIssues.rule}
          </p>
        </CardBody>
      </Card>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-label="Loading dashboard">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skeleton h-28" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="skeleton h-80 lg:col-span-2" />
        <div className="skeleton h-80" />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="skeleton h-64" />
        ))}
      </div>
    </div>
  );
}
