# BuildTrace

**Who broke the build?** BuildTrace is an incident tracking and deployment monitoring platform that helps engineering teams answer that question with evidence, not guesswork.

It ingests deployments and engineering events, maintains a truthful event timeline (ordered by when things *actually happened*, not when they arrived), and ranks the deployments most likely to have caused an incident through a **transparent, explainable correlation engine** — every suggestion shows its factors, weights and reasoning, and none of them are ever treated as a confirmed cause.

---

## Features

### Incident lifecycle (SEV1–SEV4)
- Create, edit, assign and delete incidents scoped to projects
- Validated status transitions `open → investigating → monitoring → resolved` (and back) — resolving **requires** a resolution summary; reopening is allowed and clears the resolution timestamp
- Optimistic concurrency: every update carries a `version`; a stale write is rejected with `409` and the UI reloads the newest state instead of silently overwriting
- Comments and investigator notes in a conversation-ordered activity feed

### Deployment tracking
- Manual records plus CI/automation ingestion and GitHub webhooks
- Occurrence time vs. receipt time: late-ingested events keep their true position in history and are flagged as late arrivals
- Statuses: `success`, `failed`, `in_progress`, `rolled_back`, `cancelled`

### Event pipeline
- Source-scoped deduplication enforced at the database level (unique partial index) — replays are safe no-ops
- Deterministic ordering by `occurredAt` with a stable tie-break
- Failed processing is persisted, retryable and surfaced (never silently dropped)

### Correlation engine (explainable by design)
- 60-minute investigation window (configurable)
- Weighted scoring across four factors: proximity, environment, service match, change signals (weights configurable, surface in the API response)
- Candidates are labelled **suggestions**; an investigator explicitly **associates** or **dismisses** them, and every decision is audited
- When nothing matches, the API says so explicitly instead of returning an empty list silently

### Realtime — notification-only
- Authenticated Socket.IO connections; users only join rooms for projects they belong to
- Payloads carry ids and summaries only — MongoDB stays the single source of truth and clients refetch authoritative state on every notification
- Live connection indicator in the header; automatic reconnect

### Access control
- JWT authentication (bcrypt-hashed passwords, 8+ characters)
- Three roles: `admin`, `developer`, `viewer` — enforced **server-side on every route**, mirrored in the UI so controls are hidden/disabled appropriately
- Global admins can reach every project; everyone else needs a project membership
- Every sensitive change lands in an immutable audit log with before/after snapshots

### GitHub integration
- Raw-body HMAC-SHA256 signature verification with constant-time comparison
- Delivery-id dedup (redeliveries are no-ops; failed events are reprocessed on retry)
- `push` events are recorded as commit events — **a push is never treated as a deployment**
- One-time secret reveal, hashed at rest, never logged or returned again

### Frontend
- React 19 + Vite + React Router + Tailwind CSS v4 + Recharts + Lucide icons
- Dark-first design system (violet primary / cyan accents), fully responsive with mobile drawer navigation
- Dashboard, Projects, Project Detail (tabbed), Deployments, Incidents, Incident Investigation, Timeline, Settings & Team — all wired to real APIs, no mock data anywhere
- Route-level code splitting, skeleton loaders, empty states with next actions, keyboard-accessible dialogs, `prefers-reduced-motion` respected

---

## Tech stack

| Layer      | Technology |
|------------|------------|
| Frontend   | React 19, Vite, React Router 7, Tailwind CSS 4, Recharts, Lucide, Socket.IO client, Axios |
| Backend    | Node.js, Express 5, MongoDB + Mongoose 9, Socket.IO, Zod validation, JWT, bcryptjs, Helmet, express-rate-limit, Pino |
| Testing    | Vitest + Supertest (62 tests across 10 suites) + live verification scripts |
| Infra      | Docker multi-stage builds, docker-compose (MongoDB 7 + API + nginx SPA) |

---

## Quick start

### Option A — Docker (recommended)

```bash
# 1. Build and start MongoDB + API + frontend (first build takes a few minutes)
JWT_SECRET=$(openssl rand -hex 32) docker compose up --build -d

# 2. Optional: load realistic demo data
docker compose exec backend npm run seed -- --force

# 3. Open the app
open http://localhost:8080
```

Only port `8080` is published; nginx serves the SPA and proxies `/api`, `/health` and `/socket.io` to the backend over the internal network (same-origin — no CORS setup needed).

### Option B — Local development

```bash
# 0. Prerequisites: Node 20+, MongoDB running locally

# 1. Backend
cd backend
cp ../.env.example .env          # adjust if needed
npm install
npm run seed                     # demo data (refuses when NODE_ENV=production)
npm run dev                      # http://localhost:5000

# 2. Frontend (new terminal)
cd frontend
npm install
npm run dev                      # http://localhost:5173
```

The Vite dev server proxies `/api`, `/health` and `/socket.io` to `http://localhost:5000`, so the frontend always uses same-origin relative URLs.

### Demo accounts

After seeding, log in with any of these (password `BuildTrace123!`):

| Email | Role | Notes |
|-------|------|-------|
| `admin@buildtrace.dev` | admin | Global admin — can manage every project |
| `maya@buildtrace.dev` | developer | Member of several projects |
| `leo@buildtrace.dev` | developer | Member of several projects |
| `priya@buildtrace.dev` | viewer | Read-only demo account |

The seed also creates three realistic projects (Payments Platform, Web Dashboard, Mobile API), deployments across environments, incidents in various lifecycle states, comments, events and audit records.

---

## Testing & verification

```bash
# Automated tests (from backend/)
npm test

# Live webhook hardening checks (server running)
python3 backend/scripts/verify-webhooks.py
#   -> signature enforcement, delivery dedup, push != deployment,
#      ping, header validation, secret non-leakage

# Live Socket.IO checks (server running)
node backend/scripts/verify-sockets.mjs
#   -> handshake auth, room membership, comment:added / event:processed
#      delivery, notification-only payloads

# Frontend production build
cd frontend && npm run build
```

---

## Configuration

All backend settings come from environment variables with sane defaults — see [`.env.example`](.env.example). The important ones:

| Variable | Default | Purpose |
|----------|---------|---------|
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/buildtrace` | Database connection |
| `JWT_SECRET` | dev placeholder (production **fails fast** without a real one) | Token signing |
| `CORS_ORIGINS` | `http://localhost:5173` | Comma-separated browser origins |
| `CORRELATION_WINDOW_MINUTES` | `60` | Investigation window for candidate deployments |
| `CORRELATION_W_*` | `.45/.20/.20/.15` | Factor weights (must sum to 1.0) |
| `LATE_EVENT_THRESHOLD_MINUTES` | `5` | When an event counts as a late arrival |
| `RATE_LIMIT_*` | see example | API and login rate limits |

---

## Project structure

```
Code_Chef/
├── backend/
│   ├── server.js              # HTTP + Socket.IO bootstrap, graceful shutdown
│   ├── src/
│   │   ├── app.js             # Express app: security, raw webhook body, routes
│   │   ├── config/            # env, db, logger
│   │   ├── controllers/       # thin HTTP layer
│   │   ├── middleware/        # auth, RBAC, validation, rate limits, errors
│   │   ├── models/            # User, Project, Deployment, Incident, Event, ...
│   │   ├── routes/            # REST surface under /api/v1
│   │   ├── services/          # business logic: events, correlation, incidents...
│   │   ├── sockets/           # authenticated Socket.IO rooms
│   │   ├── utils/             # ApiError, pagination, security, constants
│   │   └── validators/        # Zod schemas for every endpoint
│   ├── scripts/               # seed + live verification scripts
│   └── tests/                 # Vitest + Supertest suites
├── frontend/
│   ├── src/
│   │   ├── components/        # UI kit, layouts, feature components
│   │   ├── context/           # Auth, Socket, Toast providers
│   │   ├── lib/               # API client, formatting, shared constants
│   │   └── pages/             # one file per screen, all API-wired
│   ├── nginx.conf             # production proxy config
│   └── Dockerfile             # multi-stage build -> nginx
├── docs/
│   ├── architecture.md        # system design + diagrams
│   ├── database-schema.md     # collections, indexes, ER diagram
│   ├── workflow.md            # incident lifecycle, event & webhook flows
│   └── api.md                 # full endpoint reference
├── docker-compose.yml
└── .env.example
```

---

## Documentation

| Document | Contents |
|----------|----------|
| [docs/architecture.md](docs/architecture.md) | System architecture, event pipeline, correlation engine, realtime & security design |
| [docs/database-schema.md](docs/database-schema.md) | Collections, fields, indexes, ER diagram, design decisions |
| [docs/workflow.md](docs/workflow.md) | Incident lifecycle, investigation workflow, webhook & event-processing flows |
| [docs/api.md](docs/api.md) | Endpoint reference with examples, error model, Socket.IO events |

---

## Design decisions & assumptions

- **No fake data, no dead controls.** Every screen reads real APIs; role-inappropriate controls are hidden or disabled with an explanation.
- **Notifications, not state.** Socket.IO payloads are ids + summaries; clients refetch on notification and on reconnect, so a dropped socket can never corrupt the UI.
- **Suggestions are never conclusions.** Correlation output is explicitly labelled as candidate and requires an investigator decision that is itself audited.
- **Version-based concurrency over silent overwrites.** Conflicts surface as an explained `409` with automatic refresh.
- **One-time secret reveal.** Webhook secrets and ingest keys are shown exactly once and never returned again. Ingest keys are stored as a SHA-256 hash; the GitHub webhook secret is stored server-side (write-only, never serialized) because HMAC verification requires the shared secret to be recoverable — losing either means rotating, not retrieving.
- **JWT in localStorage** keeps the demo simple; the API layer auto-logs-out on `401` and the trade-off is documented in [docs/architecture.md](docs/architecture.md).
- **Frontend build is code-split per route** — the dashboard charts (Recharts) load only when the dashboard is opened.

---

## License

MIT
