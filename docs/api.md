# BuildTrace — API Reference

REST API served by Express at `/api/v1`. All endpoints are authenticated with a
Bearer JWT unless marked **public**. Socket.IO carries realtime notifications
(identifiers only — clients refetch through REST).

Base URL locally: `http://localhost:5000`

---

## Conventions

### Response envelope

Single resource:

```json
{ "success": true, "data": { "...": "..." } }
```

Collections are paginated:

```json
{
  "success": true,
  "data": {
    "items": [],
    "page": 1,
    "limit": 20,
    "total": 137,
    "totalPages": 7
  }
}
```

### Error model

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [{ "path": "title", "message": "Title must be at least 4 characters", "code": "too_small" }]
  }
}
```

| Status | Code | Meaning |
|--------|------|---------|
| 400 | `BAD_REQUEST` | Malformed JSON, bad ObjectId, missing required header |
| 401 | `UNAUTHORIZED` | Missing/invalid token, invalid webhook signature |
| 403 | `FORBIDDEN` | Authenticated but role/membership check failed |
| 404 | `NOT_FOUND` | Resource does not exist or is not visible to this user |
| 409 | `CONFLICT` | Stale `version` (OCC) — body includes `error.currentRecord` with the newest state |
| 409 | `DUPLICATE_KEY` | Unique constraint (e.g. project slug) |
| 422 | `VALIDATION_ERROR` | Zod/Mongoose validation failure, invalid state transition |
| 429 | `TOO_MANY_REQUESTS` | Rate limit exceeded |
| 500 | `INTERNAL_ERROR` | Unexpected server error (message sanitized in production) |

### Pagination & filters (shared)

- `page` (≥1, default 1), `limit` (1..100, default 20)
- `from` / `to` — date range on the occurrence timestamp
- Arrays are passed as repeated params: `?status=open&status=investigating`

### Authorization model

Each request is checked server-side:

1. Valid JWT → the user.
2. Project membership (or global `admin`) → read access.
3. Project role `admin`/`developer` → write access; `viewer` is read-only.

`GET /incidents/:id` additionally returns `yourProjectRole` so the UI can render
permissions honestly without duplicating the rule.

---

## Auth & users

### POST `/api/v1/auth/register` — public

```json
{ "name": "Ada Lovelace", "email": "ada@example.com", "password": "S3cret!Pass" }
```

`201` → `{ user: {...}, token: "eyJ..." }`

### POST `/api/v1/auth/login` — public

```json
{ "email": "admin@buildtrace.dev", "password": "BuildTrace123!" }
```

`200` → `{ user: {...}, token: "eyJ..." }`. Errors are deliberately generic
(`Invalid email or password`) so account existence is never leaked.

### POST `/api/v1/auth/logout`

Stateless-JWT contract endpoint. `200` → `{ loggedOut: true }`. Clients discard
the token; the server holds no session.

### GET `/api/v1/auth/me`

`200` → the current user (never includes `passwordHash`).

### GET `/api/v1/users?q=&limit=`

Minimal directory for "add project member" flows. Returns only `id`, `name`,
`email`, `role`. `limit` max 50.

---

## Projects

### POST `/api/v1/projects`

```json
{
  "name": "Payments Platform",
  "description": "Checkout, billing and payment processing",
  "repositoryUrl": "https://github.com/acme/payments",
  "environments": ["production", "staging"],
  "members": [{ "email": "maya@buildtrace.dev", "role": "developer" }]
}
```

The creator becomes project `admin`; invited members must already have
accounts (unknown emails are reported rather than failing the request).
`201` → `{ project, skippedMembers: [{ email, reason }] }` — the project is
hydrated (members and createdBy populated).

### GET `/api/v1/projects?q=&page=&limit=&sort=`

Lists projects the user is a member of (admins see all). `q` matches name and
description (text index).

### GET `/api/v1/projects/:id`

Full project: hydrated `members[]` (populated name/email), `environments`,
`repositoryUrl`, plus `summary: { openIncidents, totalDeployments,
lastDeployedAt, memberCount }`.

### PATCH `/api/v1/projects/:id`

Updatable: `name`, `description`, `repositoryUrl`, `environments`. Project admin.
Writes audit `project.updated` with before/after diffs.

### DELETE `/api/v1/projects/:id`

Project admin. Cascades across collections.
`200` → `{ deleted: { project: 1, deployments, incidents, incidentUpdates, events, auditLogs } }`
with per-collection counts.

### Members

| Method & path | Body | Notes |
|---------------|------|-------|
| POST `/projects/:id/members` | `{ email, role }` | User must already exist; audit `project.member_added` |
| PATCH `/projects/:id/members/:memberId` | `{ role }` | Audit `project.member_role_changed`; the last admin cannot be demoted |
| DELETE `/projects/:id/members/:memberId` | — | Audit `project.member_removed`; the last admin cannot be removed |

### Integrations (project admin)

| Method & path | Returns |
|---------------|---------|
| GET `/projects/:id/integrations` | `{ repositoryUrl, webhookConfigured, ingestKeyConfigured, ingestKeyLast4, webhookPath, eventsUrl }` |
| POST `/projects/:id/integrations/webhook-secret` | `{ secret, note }` — **returned exactly once**; stored server-side for HMAC verification (write-only, never serialized) |
| DELETE `/projects/:id/integrations/webhook-secret` | `{ webhookConfigured: false }` |
| POST `/projects/:id/integrations/ingest-key` | `{ key, note }` — returned exactly once; only a SHA-256 hash is stored |

Audit actions: `project.webhook_secret_rotated`, `project.webhook_secret_cleared`,
`project.ingest_key_rotated`. Secrets are never retrievable afterwards and are
stripped from every serialization.

---

## Dashboard & timeline

### GET `/api/v1/dashboard` — user-scoped; `?projectId=` — project-scoped

KPI aggregates computed live from the database (nothing hardcoded):

```json
{
  "scope": "user",
  "projectName": null,
  "totals": { "projects": 3, "openIncidents": 4, "criticalIncidents": 2, "criticalOpen": 1, "resolvedIncidents": 8 },
  "incidents": {
    "byStatus": { "open": 3, "investigating": 1, "monitoring": 0, "resolved": 8 },
    "bySeverity": { "SEV1": 2, "SEV2": 3, "SEV3": 6, "SEV4": 1 }
  },
  "deployments": {
    "windowDays": 30,
    "byStatus": { "success": 76, "failed": 5, "in_progress": 1, "rolled_back": 2, "cancelled": 0 }
  },
  "trends": {
    "days": 14,
    "incidents":   [{ "date": "2026-10-12", "count": 2 }],
    "deployments": [{ "date": "2026-10-12", "count": 11 }]
  },
  "recentIncidents": [],
  "recentDeployments": [],
  "recentActivity": [],
  "recurringIssues": {
    "rule": "Incidents sharing the same normalized title signature (digits replaced with '#', punctuation removed) within a project are treated as recurring. This is a deterministic text rule, not statistical clustering.",
    "minOccurrences": 2,
    "groups": []
  }
}
```

Trend series are gap-filled to a continuous 14-day window so charts render
without holes.

### GET `/api/v1/projects/:id/dashboard`

Same shape, `scope: "project"` with `projectName` filled in (membership
enforced).

### GET `/api/v1/projects/:id/timeline`

The ordered event ledger for the project — every deployment, commit, incident
and status change as an event, enriched for investigation reading.
Query: `page`, `limit` (default 30), `types` (repeated), `source`, `order`
(`asc` = oldest-first reading order; default `desc`), `from`, `to`.

Each item is an event document with derived investigation fields and
populated `deploymentId` / `incidentId`:

```json
{
  "items": [
    {
      "id": "...",
      "eventType": "deployment",
      "source": "github",
      "occurredAt": "2026-10-12T14:02:11.000Z",
      "occurredAtOriginal": "2026-10-12T14:02:11.000Z",
      "receivedAt": "2026-10-12T14:02:12.400Z",
      "lateArrival": false,
      "timestampUncertain": false,
      "receiptDelayMinutes": 0,
      "processingStatus": "processed",
      "deploymentId": { "_id": "...", "version": "v2.4.1", "environment": "production", "status": "success", "commitSha": "9f2c1ab..." },
      "incidentId": null,
      "actor": { "userId": { "name": "Maya Chen", "email": "maya@buildtrace.dev" }, "name": "Maya Chen" }
    }
  ],
  "page": 1, "limit": 30, "total": 214, "totalPages": 8,
  "typeCounts": { "deployment": 84, "commit": 96, "incident": 12 },
  "availableTypes": ["deployment", "deployment_status", "rollback", "commit", "incident", "incident_update", "comment", "investigation", "config_change", "other"]
}
```

`typeCounts` powers the client's type-filter chips without extra requests.

### GET `/api/v1/projects/:id/events`

Raw event ledger (ingestion view), filterable by `types`, `source`,
`processingStatus`, `order=asc|desc`, `from`, `to`.

---

## Deployments

### GET `/api/v1/deployments`

Global list, scoped server-side to the user's projects.

| Param | Values |
|-------|--------|
| `projectId`, `environment`, `author`, `source` | exact match |
| `status` | repeated; `success\|failed\|in_progress\|rolled_back\|cancelled` |
| `page`, `limit`, `from`, `to`, `sort` | standard |

Each item is a deployment document with `projectId` populated (name, slug) and
the stored `actor` identity.

### GET `/api/v1/deployments/:id`

```json
{
  "deployment": { "...": "..." },
  "project": { "id": "...", "name": "...", "environments": [] },
  "relatedIncidents": {
    "associated": [{ "title": "...", "relation": "associated" }],
    "potential":  [{ "title": "...", "relation": "potential" }]
  }
}
```

`associated` = incidents where an investigator explicitly linked this
deployment. `potential` = unresolved incidents whose investigation window
overlaps this deployment — temporal overlap only, explicitly labelled
unconfirmed.

### POST `/api/v1/projects/:id/deployments`

```json
{
  "version": "v2.4.1",
  "commitSha": "9f2c1ab34d5e6f7a8b9c0d1e2f3a4b5c6d7e8f90",
  "environment": "production",
  "status": "success",
  "occurredAt": "2026-10-12T14:02:11.000Z",
  "service": "checkout-api",
  "commitMessage": "fix: raise pool size",
  "changedFiles": ["src/db/pool.ts"],
  "url": "https://ci.example.com/runs/812"
}
```

Developer+ role. `201` → deployment. Creates a `deployment` event and emits
`deployment:created`.

### PATCH `/api/v1/deployments/:id`

Updatable: `status`, `version`, `commitMessage`, `changedFiles`, `url`, `service`.
Status transitions are guarded against stale order (`lastStatusAt`). Audit
`deployment.updated`; emits `deployment:updated`.

---

## Incidents

### GET `/api/v1/incidents`

Global list scoped to the user's projects.

| Param | Values |
|-------|--------|
| `q` | free text over title/description |
| `status`, `severity` | repeated (`?status=open&status=investigating`) |
| `assigneeId`, `environment` | exact match |
| `page`, `limit`, `from`, `to`, `sort` | on `createdAt\|updatedAt\|severity\|status\|title\|resolvedAt` (prefix `-` for desc) |

Items are incident documents with `assigneeId` and `createdBy` populated
(name/email) and `projectId` populated (name, slug).

### GET `/api/v1/incidents/:id`

```json
{
  "id": "...", "title": "...", "severity": "SEV1", "status": "investigating",
  "version": 3, "rootCause": null, "resolution": null,
  "project": { "id": "...", "name": "...", "slug": "...", "environments": [] },
  "yourProjectRole": "developer",
  "associatedDeployments": [ { "id": "...", "version": "v2.4.1", "environment": "production", "status": "success" } ],
  "commentCount": 5
}
```

`associatedDeployments` are the investigator-confirmed deployments, sorted
newest-first by occurrence.

`yourProjectRole` lets the UI disable write controls honestly; the server still
enforces every action.

### POST `/api/v1/projects/:id/incidents`

```json
{
  "title": "Checkout timeout errors spike",
  "description": "5xx rate rose from 0.2% to 8%",
  "severity": "SEV1",
  "environment": "production",
  "affectedService": "checkout-api",
  "assigneeId": null
}
```

`assigneeId` is validated against project membership. `201`; emits
`incident:created`; audit `incident.created`.

### PATCH `/api/v1/incidents/:id` — optimistic concurrency

```json
{
  "version": 3,
  "status": "resolved",
  "resolution": "Raised connection pool size and rolled back the cache change."
}
```

- `version` is **required** and must match the stored version. Mismatch → `409`
  with `error.currentRecord` (newest incident) so the client can merge and retry.
- Status transitions are whitelisted: `open → investigating|monitoring|resolved`,
  `investigating → monitoring|resolved|open`, `monitoring → resolved|investigating|open`,
  `resolved → open` (reopen clears `resolvedAt`). Anything else → `422`.
- `status: resolved` requires non-empty `resolution` (existing or supplied) → else `422`.
- Status changes auto-append a `status_change` entry to the activity feed; every
  update writes audit `incident.updated` with before/after; emits `incident:updated`.

### DELETE `/api/v1/incidents/:id`

Project admin. Cascades updates/audit rows; emits `incident:deleted`; audit
`incident.deleted`. `200` → `{ deleted: true }`.

### Activity feed

| Method & path | Body | Notes |
|---------------|------|-------|
| GET `/incidents/:id/updates?page=&limit=` | — | Oldest-first conversation order, populated author |
| POST `/incidents/:id/updates` | `{ "content": "...", "kind": "comment" \| "note" }` | Developer+; audit `incident.comment_added`; emits `comment:added` |

### Investigation

#### GET `/api/v1/incidents/:id/candidates`

Correlation-engine output (never persisted):

```json
{
  "incidentId": "...",
  "projectId": "...",
  "window": { "minutes": 60, "from": "...", "to": "...", "description": "1 hour before detection" },
  "weights": { "proximity": 0.45, "environment": 0.2, "service": 0.2, "change_signals": 0.15 },
  "methodology": "Weighted scoring ...",
  "candidates": [
    {
      "deployment": { "...": "..." },
      "score": 0.93,
      "timeDeltaMinutes": 18,
      "factors": [
        { "key": "proximity", "label": "Proximity", "score": 0.7, "weight": 0.45, "explanation": "18 min before detection" },
        { "key": "environment", "label": "Environment", "score": 1, "weight": 0.2, "explanation": "Same environment (production)" }
      ],
      "associatedByInvestigator": false,
      "lateArrival": false
    }
  ],
  "noneFound": false,
  "noneFoundMessage": null
}
```

When nothing clears the bar: `noneFound: true` and an explicit
`noneFoundMessage` — the UI shows it rather than an empty list.

#### POST `/api/v1/incidents/:id/deployments/associate`

`{ "deploymentId": "..." }` → adds to `deploymentIds`, audit
`incident.deployment_associated`, emits `incident:updated`.

#### POST `/api/v1/incidents/:id/deployments/dismiss`

`{ "deploymentId": "..." }` → adds to `dismissedDeploymentIds`; dismissed
candidates never reappear. Audit `incident.deployment_dismissed`.

#### GET `/api/v1/incidents/:id/audit-logs?page=&limit=`

`{ items: [{ action, actorId: {name,email}|null, before, after, timestamp }], total }`
— newest-first, populated actor (`null` actor = system action, e.g. incident
created from an event).

---

## Events

### POST `/api/v1/events`

Authenticated via Bearer JWT **or** project ingest key
(`X-Ingest-Key: btin_...`). Developer+ for JWT; key is project-scoped for
automation.

```json
{
  "projectId": "...",
  "eventType": "deployment_status",
  "source": "ci",
  "externalId": "run-812",
  "occurredAt": "2026-10-12T14:02:11.000Z",
  "service": "checkout-api",
  "deployment": { "version": "v2.4.2", "environment": "production", "status": "failed" }
}
```

| Field | Notes |
|-------|-------|
| `eventType` | `deployment \| deployment_status \| rollback \| commit \| incident \| incident_update \| comment \| investigation \| config_change \| other` |
| `externalId` / `idempotencyKey` | dedup identity (`source:externalId` preferred). Repeats return the existing event with `duplicate: true` |
| `occurredAt` | true occurrence time; absent → receipt time with `timestampUncertain: true` |
| `deployment` / `incident` | typed payloads interpreted per `eventType` |

`202` → `{ duplicate, reprocessed, event, deploymentId, incidentId,
processingStatus, failed, error }` where `event` is the persisted event
document. Emits `event:processed` (and `deployment:created` /
`incident:created` when processing produces one).

### POST `/api/v1/events/:id/retry`

Project admin. Re-runs processing of a **failed** event on the same row (no
duplicate side effects). Audit `event.retry`.

---

## Webhooks

### POST `/api/v1/webhooks/github` — public, HMAC-authenticated

Headers: `X-Hub-Signature-256`, `X-GitHub-Delivery`, `X-GitHub-Event`.

- Project is resolved by matching the payload's repository URL against
  `repositoryUrl`, or by `?projectId=<id>` in the URL for explicit routing.
- Signature: `HMAC-SHA256(rawBody, webhookSecret)` compared timing-safely.
  Invalid → `401 "Invalid webhook signature"`. The secret never appears in any
  response or log.
- Missing `X-GitHub-Delivery` → `400`.
- Duplicate deliveries: previously **failed** → re-processed (`reprocessed: true`);
  previously succeeded → safe no-op (`duplicate: true`).

| Event | Behaviour |
|-------|-----------|
| `ping` | `200` → `{ "pong": true }` |
| `push` | records a `commit` event — **a push is never a deployment** |
| `deployment_status` | creates/updates a deployment (`externalId: gh-deployment:<id>`) |

`202` → `{ deliveryId, duplicate, reprocessed, eventId, eventType, processingStatus, deploymentId? }`

If the delivery was persisted but processing failed, the response is `500`
with code `PROCESSING_FAILED` — this is deliberate: it makes GitHub redeliver,
and the redelivery re-attempts processing of the persisted event.

---

## Socket.IO

Connect with `auth: { token: <jwt> }`. Then emit `project:subscribe`,
`{ projectId }`; server verifies membership before joining `project:<id>`.
Payloads are notification-only (ids + type), never state.

| Event | Meaning |
|-------|---------|
| `incident:created` / `incident:updated` / `incident:deleted` | Incident lifecycle |
| `comment:added` | Activity feed entry |
| `deployment:created` / `deployment:updated` | Deployment recorded / status changed |
| `event:processed` | Event ingestion finished (includes failures) |

Executable specs: `backend/scripts/verify-sockets.mjs` (9 checks) and
`backend/scripts/verify-webhooks.py` (12 checks).
