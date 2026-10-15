'use strict';

const Event = require('../models/Event');
const { getPagination } = require('../utils/pagination');
const { assertProjectRole } = require('../middleware/rbac');
const { ROLES, EVENT_TYPES } = require('../utils/constants');
const { isLateArrival } = require('../utils/eventTime');

/**
 * The project timeline: a chronological stream of deployments, commits,
 * incidents, rollbacks, comments and investigation activity.
 *
 * Ordering is by occurrence time with _id as a stable secondary key, so
 * events sharing a timestamp keep a deterministic order. Late-arriving events
 * are ordinary rows here - they simply take their correct chronological
 * position and are flagged for the UI.
 */
async function getTimeline(user, project, query) {
  assertProjectRole(user, project, ROLES.VIEWER);
  const { page, limit, skip } = getPagination(query, { defaultLimit: 30 });

  const filter = { projectId: project._id };
  if (query.types?.length) filter.eventType = { $in: query.types };
  if (query.source) filter.source = query.source;
  if (query.from || query.to) {
    filter.occurredAt = {};
    if (query.from) filter.occurredAt.$gte = query.from;
    if (query.to) filter.occurredAt.$lte = query.to;
  }

  // order=asc returns oldest-first (investigation reading order);
  // default is newest-first with the stable _id secondary key either way.
  const direction = query.order === 'asc' ? 1 : -1;
  const sort = { occurredAt: direction, _id: direction };

  const [items, total, typeCounts] = await Promise.all([
    Event.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate('actor.userId', 'name email')
      .populate('deploymentId', 'version environment status commitSha')
      .populate('incidentId', 'title severity status')
      .lean(),
    Event.countDocuments(filter),
    Event.aggregate([
      { $match: { projectId: project._id } },
      { $group: { _id: '$eventType', count: { $sum: 1 } } },
    ]),
  ]);

  const events = items.map((e) => ({
    ...e,
    occurredAtOriginal: e.occurredAt,
    lateArrival: isLateArrival(new Date(e.occurredAt), new Date(e.receivedAt)),
    timestampUncertain: e.occurredAtSource !== 'payload',
    receiptDelayMinutes: Math.round(((new Date(e.receivedAt) - new Date(e.occurredAt)) / 60000) * 10) / 10,
  }));

  return {
    items: events,
    page,
    limit,
    total,
    typeCounts: Object.fromEntries(typeCounts.map((t) => [t._id, t.count])),
    availableTypes: EVENT_TYPES,
  };
}

module.exports = { getTimeline };
