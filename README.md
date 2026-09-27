# Coffee Washing Station Management System

Management system for a red-cherry coffee washing station: suppliers, quality, weighing and purchase vouchers, payments, lot traceability through wet processing and drying, warehouse and bin cards, workforce and payroll, audits and corrective actions, reports.

The design is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (v2 for this stack).

| Layer | Technology |
|---|---|
| Frontend | React 19 + TypeScript + Vite + MUI, TanStack Query, React Hook Form + Zod |
| API | REST `/api/v1`, Swagger at `/api/docs` |
| Backend | Node.js 22 + Express 5 + TypeScript |
| Database | PostgreSQL 16 via `pg`, plain SQL migrations (`backend/db/migrations`) |
| Jobs | pg-boss (in the same database) |
| Auth | JWT access token + rotating httpOnly refresh cookie, argon2id |
| Tests | Jest + Supertest (backend, real PostgreSQL), Vitest (frontend) |
| Documents | PDFKit, ExcelJS (from Phase 2 / 8) |
| Hosting | Render: Web Service + Static Site + PostgreSQL; S3-compatible storage |
| DB admin | pgAdmin 4 |

## Status

**Phase 1 — Foundation: done.** Authentication, users/roles/permissions (seeded from the design's role matrix), employees, settings (with the "to confirm" workflow), hash-chained audit log, file storage, outbox + pg-boss worker, idempotency keys, document numbering, health checks, Swagger, and the frontend shell (login, forced password change, navigation by permission, dashboard, users, roles, settings, audit log). The full database (78 tables) is already migrated so later phases only add code.

**Phase 2 — Procurement: done.** Suppliers (documents, status, history), cherry quality inspections with configurable rules, quality holds, equipment and maintenance, scales with daily verification (failed check → out of service + corrective action), purchase vouchers with server-computed totals and the full state machine (submit → verify → approve, return, cancel, void, PDF), supplier payments (approve → pay out → reverse, one live payment per voucher), cash ledger, and automatic lot creation with its `PURCHASED` event. Segregation of duties is enforced on every step. Build plan: [BUILD_PLAN.md](BUILD_PLAN.md).

## Run locally

Requirements: Node.js ≥ 22.12, Docker (or any PostgreSQL 16).

```bash
docker compose up -d                     # PostgreSQL on :5432, pgAdmin on http://localhost:5050

cd backend
cp .env.example .env                     # set JWT_ACCESS_SECRET and SEED_ADMIN_PASSWORD
npm ci
npm run migrate                          # applies db/migrations/*.sql
npm run seed                             # roles, permissions, settings, first SUPER_ADMIN
npm run dev                              # http://localhost:4000  (Swagger: /api/docs)

cd ../frontend
npm ci
npm run dev                              # http://localhost:5173  (proxies /api to :4000)
```

Sign in as `admin` with `SEED_ADMIN_PASSWORD`; you will be asked to choose a new password.

## Checks (the phase exit gate)

```bash
cd backend
npm run typecheck && npm run lint
npm test          # unit + integration + authorization matrix (needs PostgreSQL; uses TEST_DATABASE_URL or postgres://postgres@localhost:5432/cws_test)
npm run build

cd ../frontend
npm run typecheck && npm run lint && npm test && npm run build
```

The integration tests drop and re-create the test database, apply every migration and seed it on each run.

## Database changes

Add a new file `backend/db/migrations/NNNN_description.sql`. Never edit a file that has been applied — the migrator stores a checksum and refuses modified files. `npm run migrate:status` lists applied and pending files.

## Deploy to Render

1. Push this repository to GitHub.
2. In Render: **New → Blueprint**, select the repository (`render.yaml` creates `cws-db`, `cws-api`, `cws-web`).
3. Fill in the secrets Render asks for: `CORS_ORIGINS` (the static site URL), `VITE_API_BASE_URL` (the API URL), the `S3_*` bucket settings, `SEED_ADMIN_PASSWORD`.
4. Each deploy of `cws-api` runs migrations and the (idempotent) seed before starting.
5. pgAdmin → add server with the database's **External** connection details, SSL mode `require`.

See ARCHITECTURE.md §16 for plans, cookies across `*.onrender.com`, and the optional Background Worker.
