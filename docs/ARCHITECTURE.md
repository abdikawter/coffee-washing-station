# Coffee Washing Station Management System — Architecture & Design (v2)

Source of business rules: the requirements brief derived from the *General Control, Organization, and Operations Manual for Red Coffee Processing Station*. **The manual itself was not attached**, so every rule below is taken from the brief. Anything the brief does not state is either (a) a configurable setting marked `PROVISIONAL` or `UNSET`, or (b) listed as an open question in §19–20. Nothing in this design should be read as a manual rule unless it is tagged **[MANUAL]**.

**v2 changes the technology stack only.** Business rules, roles, the permission matrix, workflows, state machines, segregation of duties, traceability and settings are unchanged from v1 (§5, §7, §9, §10, §11, §20 are carried over as approved). §0 lists every stack substitution and what replaced each v1 mechanism.

Companion files: `backend/db/migrations/*.sql` (the database — 78 tables, 64 enum types, converted from the v1 table blueprint `schema.prisma`, which is now reference only), `backend/src/modules/access/catalog.ts` (roles & permission codes seeded from §7), `backend/src/core/settings/registry.ts` (settings seeded from §20).

---

## 0. Stack (v2) and what changed from v1

| Concern | v1 | v2 (current) | Notes |
|---|---|---|---|
| Frontend | React + Vite + Tailwind + shadcn/ui | **React 19 + TypeScript + Vite + MUI** | TanStack Query (server state), React Hook Form + Zod (forms), React Router. Charts in Phase 8 (Recharts or MUI X Charts). |
| API style | REST `/api/v1` | **REST `/api/v1`** (unchanged) | Swagger/OpenAPI 3 generated from the Zod route schemas; served at `/api/docs`. |
| Backend | NestJS (modules, guards, DTO classes) | **Node.js 22 + Express 5 + TypeScript (ESM)** | Modular monolith kept. A small route registry (`http/api.ts`) replaces Nest guards/pipes/decorators; see §2.2. |
| Validation | class-validator DTOs | **Zod** schemas per route (strict objects = whitelist + forbid unknown) | Same schemas generate the Swagger docs. |
| Database access | Prisma ORM + Prisma migrations | **PostgreSQL 16 via `pg` (node-postgres), plain SQL** | Parameterised queries only; `withTransaction(pool, fn)` helper; pg errors mapped to API errors (§2.2). |
| Migrations | `prisma migrate` | **Plain SQL files** `backend/db/migrations/NNNN_name.sql` + a 100-line runner | Ordered, each in its own transaction, checksum-locked once applied, serialised by an advisory lock. |
| Background jobs | BullMQ + Redis | **pg-boss** (jobs stored in the `pgboss` schema of the same database) | Lets the outbox relay enqueue in the same transaction. No Redis anywhere. |
| Cache / rate-limit / idempotency / SSE fan-out | Redis | Settings: 5-second in-process cache; rate limits: `express-rate-limit` (in memory, one instance); idempotency: `idempotency_keys` table; realtime (Phase 7): PostgreSQL `LISTEN/NOTIFY` | Losing a process loses no business data (principle 1 still holds). |
| Auth | JWT + refresh | **JWT access token (HS256, 15 min) + rotating refresh token (httpOnly cookie, hashed in DB, family reuse detection)** | Permissions are loaded from the DB on every request (no `ver` claim needed). |
| Passwords | argon2id | argon2id (unchanged) | |
| Tests | Jest + Supertest | **Jest + Supertest** (backend, real PostgreSQL); **Vitest + Testing Library** (frontend, Jest-compatible API, native to Vite) | |
| API docs | @nestjs/swagger | **zod-to-openapi + swagger-ui-express** | `npm run openapi` writes `openapi.json` without a database. |
| PDF / Excel | PDFKit / ExcelJS | PDFKit / ExcelJS (unchanged) | Introduced with the first document (voucher PDF, Phase 2) and exports (Phase 8). |
| Files | Local FS / S3 (MinIO in dev) | Local FS (dev) / **any S3-compatible service** (prod) | Render has no object store: use AWS S3, Cloudflare R2, Backblaze B2 or similar. |
| Hosting | Docker Compose + Nginx on a station/cloud host | **Render**: Web Service (API + worker), Static Site (frontend), Render PostgreSQL | Optional Render Background Worker for the jobs when scaling (§16). |
| DB administration | — | **pgAdmin 4** (local via Docker Compose; connects to Render with the external URL + SSL) | §16.4. |
| Config | `.env` + Joi | **`.env` + Zod** (`src/config/env.ts`), validated at boot | `.env.example` in each package; `.env` never committed. |
| Source control | Git + GitHub Actions | Git + GitHub + GitHub Actions CI (typecheck, lint, migrations on empty DB, tests, builds) | |

## 1. System architecture

```
 React + TypeScript + Vite + MUI        (Render Static Site; desktop + mobile browsers, PWA later)
   TanStack Query · React Hook Form + Zod · React Router · QR scanner (Phase 4/5)
              │  HTTPS  REST /api/v1/*   (Authorization: Bearer <access JWT>; refresh = httpOnly cookie)
              ▼
 Node.js 22 + Express 5 + TypeScript     (Render Web Service, one deployable)
   Route registry: rate limit → authenticate → password-change gate → permission check
                   → Zod validation → idempotency → handler            (deny by default)
   Domain modules (suppliers … reports) → services → pure domain functions
   Shared: Settings, Sequences, AuditLog, LotEvents, InventoryLedger, CashLedger, Outbox, Storage
   Worker (in-process by default): outbox relay + pg-boss handlers/schedules
              │ pg (node-postgres)                     │ S3 API
              ▼                                        ▼
 PostgreSQL 16 (Render PostgreSQL)             S3-compatible object storage
   public schema: business tables (SQL migrations)     (AWS S3 / Cloudflare R2 / B2; local disk in dev)
   pgboss schema: job queue (pg-boss)
              ▲
          pgAdmin 4 (administration, read-only reporting queries, backups check)
```

Key principles (unchanged from v1):

1. **PostgreSQL is the single source of truth.** Everything else (in-process caches, the rate-limit counters) is derived or transient. Jobs themselves live in PostgreSQL (pg-boss), so a restart loses nothing.
2. **Every business rule lives in a backend domain service.** Route handlers only map HTTP ↔ Zod-validated input ↔ service. The frontend repeats validation for UX only.
3. **Append-only ledgers** for everything financially or physically sensitive: `lot_events`, `inventory_transactions`, `cash_transactions`, `audit_logs`. Mistakes are corrected by reversal entries. Enforced by triggers (migration 0011).
4. **Transactional outbox**: services write `outbox_events` rows in the same DB transaction as the business change; the relay moves them to pg-boss **inside one transaction** (pg-boss `send` with the relay's `db` client), so notifications never fire for rolled-back work and are never lost or duplicated.
5. **Settings-driven thresholds**: every number the manual does not fix is a `system_settings` row, snapshotted onto the record that used it (e.g. `moisture_records.target_max_pct`) so historical decisions stay explainable after settings change.

## 2. Backend architecture

### 2.1 Layering inside each module

```
x.routes.ts   route definitions: access rule, Zod schemas, response schema (→ Swagger)   ← thin
   ↓
x.service.ts  use-case orchestration: withTransaction(), row locks, authorization policies (scope, SoD),
              audit, lot events, ledgers, outbox
   ↓
domain/*.ts   pure functions/classes: calculators, state machines, rule evaluators — no Express, no pg
   ↓
SQL via pg    parameterised queries on the transaction client passed explicitly (x.repo.ts where a module grows)
```

Pure domain code is where unit tests concentrate: `purchase-calculator.ts`, `voucher-state-machine.ts`, `quality-rule-evaluator.ts`, `moisture-classifier.ts`, `reconciliation.ts`, `outturn.ts`, `payroll-calculator.ts`, `inventory-ledger.ts`.

### 2.2 Cross-cutting infrastructure (`src/http`, `src/common`, `src/core`, `src/db`)

| Component | Responsibility |
|---|---|
| `db/pool.ts` | `pg.Pool`, `withTransaction(pool, fn, {isolationLevel})`, snake_case → camelCase row mapping. DATE columns are returned as `YYYY-MM-DD` strings and NUMERIC as strings (never floats). |
| `db/migrator.ts` | SQL migration runner: `schema_migrations(version, name, checksum, applied_at)`, advisory lock, one transaction per file, refuses modified files. CLI `npm run migrate` / `migrate:status`. |
| `http/api.ts` (route registry) | The only way to add an endpoint. Each route declares `access` = `{public}` \| `{authenticated}` \| `{permission: 'x:y' \| [...]}` (any-of), Zod `params/query/body`, the success response and flags (`idempotent`, `strictRateLimit`, `allowWhilePasswordChangeRequired`). Deny by default: the type requires `access`, and a test asserts the public-route list. Authorization runs **before** validation. |
| `common/errors.ts` | `AppError` family (`ValidationError` 400, `UnauthorizedError` 401, `ForbiddenError` / `SegregationOfDutiesError` 403, `NotFoundError` 404, `ConflictError` / `StaleVersionError` 409, `BusinessRuleError` 422). `mapPgError`: 23505 → 409 `DUPLICATE`, 23503 → 409, 23514 → 422 (or 403 for `*_sod` checks), append-only trigger → 409 `APPEND_ONLY`, serialization failure → 409. |
| `http/error-handler.ts` | Uniform error envelope (§8); hides internals in production. |
| `common/policies/segregation-of-duties.ts` | `assertSegregation(rule, actors)` with the §11.3 rules. Called by services inside the transaction after locking the record; repeated as CHECK constraints in migration 0011. |
| Scope policy (Phase 6/7) | Row-level scope for `…-own-group`, `…-self`, `…-assigned` permission variants (e.g. CAPITA only touches workers in groups they lead). |
| `core/settings` | Registry of every §20 key (type, default, source, Zod validator); `settings.getIn(tx, key)` inside transactions, 5 s cache outside; `require()` → 422 `SETTING_NOT_CONFIGURED` for UNSET keys; changes need a reason, are version-checked and audited. |
| `core/sequences` | Collision-free document numbers: `INSERT … ON CONFLICT DO UPDATE SET last_value = last_value + 1 RETURNING` inside the caller's transaction; formats from `numbering.formats`, per-year/per-day restart in the station timezone. |
| `core/audit-log` | Hash-chained `audit_logs` rows written in the caller's transaction (`pg_advisory_xact_lock` serialises the chain); secrets redacted; `verify()` recomputes the chain. |
| `LotEventService` (Phase 3) | Only way to change `lots.current_stage`: validates transition, appends `lot_events`, bumps `lots.version`. |
| `InventoryLedgerService` (Phase 5) | Only writer of `inventory_transactions`, `stock_balances`, `bin_cards`; `SELECT … FOR UPDATE` on the balance row; rejects negative stock (also a CHECK). |
| `CashLedgerService` (Phase 2) | Only writer of `cash_transactions`. |
| `core/outbox` | `outbox.emit(tx, event)`; `OutboxRelay` (every 2 s, `FOR UPDATE SKIP LOCKED`, per-event savepoint, retries then FAILED). |
| `core/queue` | pg-boss wrapper: queue creation, `sendInTx(tx, …)`. |
| `core/storage` | `LocalStorageAdapter` / `S3StorageAdapter`; magic-byte type detection (PDF, PNG, JPEG, WebP), size limit, SHA-256, random keys; S3 downloads via 5-minute presigned URLs. |
| `http/idempotency.ts` | `Idempotency-Key` support backed by the `idempotency_keys` table (§8). |
| Logging | `pino` + `pino-http`: JSON to stdout, `X-Request-Id` on every response, authorization/cookies/passwords redacted. |

### 2.3 Processes

- `src/server.ts` → HTTP API; with `RUN_WORKER_IN_PROCESS=true` (default) it also starts the worker, so a single Render Web Service runs everything.
- `src/worker.ts` → the same worker as a separate process (Render Background Worker) when the job load justifies it; then set `RUN_WORKER_IN_PROCESS=false` on the web service.
- `src/db/migrate.ts`, `src/db/seed.ts` → run on every deploy (idempotent).

### 2.4 Numeric correctness

All money/weight arithmetic uses `decimal.js` (`common/decimal.ts`). JS `number` is never used for business quantities; PostgreSQL NUMERIC comes back as strings and travels as strings in JSON. Rounding: money to 2 dp, weight to 3 dp, rounding mode from setting `finance.roundingMode` (PROVISIONAL: `HALF_UP`).

## 3. Frontend architecture

```
src/
  api/          axios instance (in-memory access token, single-flight refresh on 401), typed endpoint functions, types
  auth/         AuthProvider (session restore from the refresh cookie), useAuth, usePermission, <Can>
  layouts/      AppShell (MUI AppBar + responsive Drawer, nav by permission, "settings to confirm" banner)
  components/   PageHeader, StatusChip, ErrorAlert, Loading, ReasonDialog; later DataTable, MoneyCell, WeightCell,
                LotTimeline, TraceTree, QrScanner, SignatureCapture, ApprovalBar, FileUpload
  pages/        one folder per nav item (Dashboard, Suppliers, Purchasing, …, admin/Users, Roles, Settings, Audit log)
  routes/       <RequireAuth> (incl. forced password change), <RequirePermission>, QR deep-link route /q/:token (Phase 5)
  navigation.tsx  nav items with required permissions and delivering phase
  utils/        formatting (decimal strings → display), station-timezone date helpers
  theme.ts      MUI theme (coffee palette, light/dark, large touch targets)
```

- **Server state** only in TanStack Query; no global store except the auth context.
- **Permission-aware UI** (`usePermission('purchase:approve')`, `<Can>`) hides/disables actions; the backend remains the authority.
- **Decimals** travel as strings and are displayed with formatting helpers; never parsed into floats for calculations.
- **Access token** is kept in memory only; the refresh token is an httpOnly cookie scoped to `/api/v1/auth`. Page reloads restore the session through `/auth/refresh`.
- **Mobile-first screens** (Phase 4/6): moisture entry, bed inspection, raking, attendance, lot lookup, QR scan — large touch targets, minimal fields, designed for a later PWA/offline queue.

## 4. Module list

| # | Backend module | Owns (tables) | Phase |
|---|---|---|---|
| 1 | `config` | env schema validation (Zod) | 1 ✅ |
| 2 | `auth` | refresh_tokens | 1 ✅ |
| 3 | `users` (+ `access`) | users, roles, permissions, role_permissions, user_roles, employees | 1 ✅ |
| 4 | `settings` | system_settings | 1 ✅ |
| 5 | `audit-log` | audit_logs | 1 ✅ |
| 6 | `files` | documents | 1 ✅ |
| 7 | `suppliers` | suppliers, supplier_documents | 2 ✅ |
| 8 | `quality` | quality_inspections, quality_settings, quality_holds, coffee_grades, coffee_types | 2 ✅ |
| 9 | `equipment` (incl. `scales`) | equipment, scales, scale_calibrations, machine_maintenance, maintenance_schedules | 2 ✅ |
| 10 | `purchasing` | purchase_vouchers, purchase_items, weight_records | 2 ✅ |
| 11 | `payments` | supplier_payments | 2 ✅ |
| 12 | `finance` (ledger part) | cash_transactions | 2 ✅ (ledger) / 7 |
| 13 | `lots` | lots, lot_events | 3 |
| 14 | `hopper` | hoppers, hopper_records, hopper_reconciliations | 3 |
| 15 | `pulping` | pulping_machines, pulping_machine_inspections, pulping_records | 3 |
| 16 | `fermentation` | fermentation_tanks, fermentation_batches, fermentation_measurements | 3 |
| 17 | `washing` | washing_records | 3 |
| 18 | `grading` | grading_records, grade_outputs | 3 |
| 19 | `drying` | drying_beds, drying_batches, drying_batch_beds, raking_records | 4 |
| 20 | `moisture` | moisture_records | 4 |
| 21 | `defects` | defect_types, defect_records | 4 |
| 22 | `warehouse` | warehouses, warehouse_sections, warehouse_stacks, store_receive_vouchers | 5 |
| 23 | `inventory` | inventory_items, inventory_transactions, stock_balances, bin_cards, stock_transfers | 5 |
| 24 | `traceability` | read-only queries across modules | 5 |
| 25 | `qr` | token resolution + QR image generation | 5 |
| 26 | `workers` | worker_roles, workers, worker_groups, worker_assignments | 6 |
| 27 | `attendance` | attendances | 6 |
| 28 | `payroll` | payrolls, payroll_items | 6 |
| 29 | `rations` | ration_items, store_issue_vouchers, store_issue_voucher_lines, ration_issues | 6 |
| 30 | `finance` (expenses, summaries) | expenses, expense_categories | 7 |
| 31 | `audits` | audits, audit_items | 7 |
| 32 | `corrective-actions` | corrective_actions, corrective_action_evidence | 7 |
| 33 | `notifications` | notifications, outbox_events | 7 (outbox from 1 ✅) |
| 34 | `reports` | report_jobs + read models | 8 |
| 35 | `health` | liveness/readiness | 1 ✅ |

Platform tables added in v2: `schema_migrations` (migration runner), `idempotency_keys` (replaces Redis), schema `pgboss` (created by pg-boss).

Dependency rule: modules depend on shared services (`LotEventService`, `InventoryLedgerService`, `CashLedgerService`, `SettingsService`, `SequenceService`, `AuditLogService`, `OutboxService`, `CorrectiveActionsService.raise()`), never on another module's routes or on each other in cycles. Production modules call `LotEventService`; nothing updates `lots.current_stage` directly.

## 5. Database ERD (description)

```
Supplier 1─* QualityInspection 1─1 PurchaseVoucher *─1 Supplier
PurchaseVoucher 1─* PurchaseItem 1─* WeightRecord *─1 Scale 1─1 Equipment
PurchaseVoucher 1─* SupplierPayment 1─* CashTransaction
PurchaseVoucher 1─1 Lot (root lot, LotType.PURCHASE)
Lot 1─* LotEvent            Lot 1─* QualityHold
Lot 1─* Lot (parentLotId: grade/other splits)
Lot 1─1 HopperRecord *─1 Hopper 1─1 Equipment
HopperReconciliation (per day, JSON per-lot detail) 1─* CorrectiveAction
Lot 1─* PulpingRecord *─1 PulpingMachine 1─* PulpingMachineInspection (1 per machine per day)
Lot 1─* FermentationBatch *─1 FermentationTank ; FermentationBatch 1─* FermentationMeasurement
Lot 1─* WashingRecord 1─* GradingRecord 1─* GradeOutput 1─1 Lot (child, LotType.GRADE_SPLIT)
Lot(child) 1─* DryingBatch 1─* DryingBatchBed *─1 DryingBed
DryingBatch 1─* MoistureRecord / RakingRecord / DefectRecord (each also → Lot, DryingBed)
DryingBatch 1─1 MoistureRecord (final verification)
DryingBatch 1─* StoreReceiveVoucher *─1 WarehouseStack *─1 WarehouseSection *─1 Warehouse
InventoryItem, Lot, CoffeeGrade, WarehouseStack ─ StockBalance (projection) / BinCard (header)
BinCard 1─* InventoryTransaction (append-only; reversal self-link; transfer → StockTransfer)
Worker *─1 WorkerRole, *─1 WorkerGroup (capita = Worker) ; Worker 1─* Attendance, WorkerAssignment, PayrollItem
Payroll 1─* PayrollItem 1─* Attendance (payrollItemId marks attendance as paid)
StoreIssueVoucher 1─* StoreIssueVoucherLine (→ inventory OUT) ; 1─* RationIssue *─1 RationItem 1─1 InventoryItem
Expense 1─* CashTransaction ; Payroll 1─* CashTransaction
Audit 1─* AuditItem 1─* CorrectiveAction 1─* CorrectiveActionEvidence *─1 Document
User ─ actors on everything; AuditLog *─1 User
```

## 6. Database schema (plain SQL migrations)

The database is defined only by `backend/db/migrations/*.sql`, applied in order by the runner in §2.2. The v1 `schema.prisma` was converted table-for-table (78 tables, 64 enum types, 196 foreign keys, every `@unique`/`@@unique`/`@@index`) and is kept outside the codebase as a reference; no Prisma is used.

| File | Contents |
|---|---|
| `0001_enums.sql` | All 64 enum types (`user_status`, `purchase_voucher_status`, `lot_stage`, …). |
| `0002_identity_and_system.sql` | users, roles, permissions, role_permissions, user_roles, refresh_tokens, employees, system_settings, document_sequences, documents, outbox_events. |
| `0003_suppliers_equipment_quality.sql` | suppliers, supplier_documents, equipment, maintenance, scales, scale_calibrations, coffee_types, coffee_grades, quality_settings, quality_inspections, quality_holds. |
| `0004_purchasing_payments.sql` | purchase_vouchers, purchase_items, weight_records, supplier_payments. |
| `0005_lots_and_wet_processing.sql` | lots, lot_events, hoppers, hopper_records, hopper_reconciliations, pulping_*, fermentation_*, washing_records, grading_records, grade_outputs. |
| `0006_drying.sql` | drying_beds, drying_batches, drying_batch_beds, moisture_records, raking_records, defect_types, defect_records. |
| `0007_warehouse_inventory.sql` | warehouses, sections, stacks, inventory_items, store_receive_vouchers, stock_balances, bin_cards, inventory_transactions, stock_transfers. |
| `0008_workforce.sql` | worker_roles, workers, worker_groups, worker_assignments, attendances, payrolls, payroll_items, ration_items, store_issue_vouchers (+ lines), ration_issues. |
| `0009_finance.sql` | expense_categories, expenses, cash_transactions. |
| `0010_controls_notifications_audit_log.sql` | audits, audit_items, corrective_actions, corrective_action_evidence, notifications, report_jobs, audit_logs. |
| `0011_constraints_and_triggers.sql` | Everything §6.4 describes (below). |
| `0012_platform_support.sql` | `idempotency_keys`, extra index, optional least-privilege grants. |

Rules for changing the schema: never edit an applied file (the runner refuses: checksum mismatch); add `NNNN_description.sql`; one concern per file; data migrations in their own file.

### 6.1 Types
- `numeric(14,2)` money, `numeric(12,3)` kg, `numeric(5,2)` percentages, `numeric(14,3)` inventory quantity (items other than coffee may be litres/pieces).
- `date` for business dates (voucher date, attendance date, reconciliation date) — interpreted in the station timezone setting and returned to Node as `YYYY-MM-DD` strings. `timestamptz` for events.
- Columns are snake_case; the API is camelCase (mapped in `db/pool.ts`). UUID keys via `gen_random_uuid()`; `audit_logs.id` is `bigint GENERATED ALWAYS AS IDENTITY` for strict ordering.
- `updated_at` is maintained by a `BEFORE UPDATE` trigger on every table that has it.

### 6.2 Snapshots
Records that depend on a mutable master or setting store a snapshot: supplier name/phone on the voucher, tolerance on calibrations and reconciliations, target range on moisture records, min/max hours on fermentation batches, role/area on payroll items.

### 6.3 Optimistic locking
`version` on `purchase_vouchers`, `lots`, `stock_balances`, `system_settings`. Updates use `WHERE id = $1 AND version = $2`; zero rows → 409 `STALE_VERSION` ("record changed by another user").

### 6.4 Constraints the table blueprint could not express (`0011_constraints_and_triggers.sql`)
```sql
-- one live payment per voucher (prevents duplicate payment)
CREATE UNIQUE INDEX ux_payment_live_per_voucher ON supplier_payments(voucher_id) WHERE status NOT IN ('REJECTED','REVERSED');
-- one active fermentation per tank / one active batch per bed / one active hold per lot
CREATE UNIQUE INDEX ux_ferm_active_tank ON fermentation_batches(tank_id) WHERE status = 'IN_PROGRESS';
CREATE UNIQUE INDEX ux_bed_active ON drying_batch_beds(bed_id) WHERE unloaded_at IS NULL;
CREATE UNIQUE INDEX ux_quality_hold_active ON quality_holds(lot_id) WHERE status = 'ACTIVE';
-- ledger keys with nullable columns
CREATE UNIQUE INDEX ux_stock_key   ON stock_balances(item_id, lot_id, grade_id, stack_id) NULLS NOT DISTINCT;
CREATE UNIQUE INDEX ux_bincard_key ON bin_cards(item_id, lot_id, grade_id, stack_id)      NULLS NOT DISTINCT;
```
- **~60 CHECK constraints**: non-negative stock, weights > 0, `net = gross − tare`, percentages 0–100, moisture target min ≤ max, washing/pulping output ≤ input, fermentation min ≤ max hours, date ranges, settings `source` values, rejection reason required when REJECTED, …
- **Segregation of duties as CHECKs** (defence in depth for §11.3): `ck_pv_sod`, `ck_payment_sod`, `ck_srv_sod`, `ck_transfer_sod`, `ck_inv_txn_sod`, `ck_payroll_sod`, `ck_attendance_sod`, `ck_expense_sod`, `ck_siv_sod`, `ck_ca_sod`. Services check first and return 403 `SEGREGATION_OF_DUTIES`; the database guarantees no code path can bypass them.
- **Append-only ledgers**: `forbid_mutation()` trigger rejects UPDATE, DELETE and TRUNCATE on `audit_logs`, `lot_events`, `inventory_transactions`, `cash_transactions` (SQLSTATE `P0A01` → 409 `APPEND_ONLY`).
- **Least-privilege role (optional)**: `db/roles.sql` creates `cws_app` (DML only, INSERT/SELECT on the four ledgers) and migrations run as the owner. On a single-user Render database this is skipped and the triggers remain the enforcement.

### 6.5 Indexes
Every FK used in lists, every `(entity, date)` pair used in reports (e.g. `purchase_vouchers(voucher_date)`, `(supplier_id, voucher_date)`, `lot_events(lot_id, occurred_at)`, `inventory_transactions(bin_card_id, occurred_at)`, `moisture_records(batch_id, measured_at)`, `attendances(work_date, approval_status)`), status columns used by queues/dashboards, and `(ref_type, ref_id)` for reverse lookups. Reviewed with `EXPLAIN ANALYZE` on seeded volume in Phase 9 (pgAdmin's graphical EXPLAIN is convenient for this).

## 7. Role–permission matrix

> **Current setup (decision of 2026-10-02):** the system runs with **one role, SUPER_ADMIN, which holds every permission**, and **segregation of duties has been removed** (service checks deleted; DB `ck_*_sod` constraints dropped by migration `0014_single_super_admin.sql`). The matrix below is the target design kept for reference: roles are added back only on request, by listing them in `backend/src/modules/access/catalog.ts`. Re-introducing segregation of duties would need new code and a new migration.

Legend: **R** read · **C** create/record · **U** update · **S** submit · **V** verify · **A** approve · **P** pay/disburse · **X** cancel/void/reverse · **M** manage master data · — none. Scope notes in brackets.

| Module / permission group | SUPER_ADMIN | SITE_MANAGER | QUALITY_INSPECTOR | PURCHASING_CLERK | CASHIER_ACCOUNTANT | PULPING_OPERATOR | DRYING_SUPERVISOR | STOREKEEPER | CAPITA | TEMP_WORKER | AUDITOR |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Users, roles | M | R | — | — | — | — | — | — | — | — | R |
| System settings | M | M (business keys) | R | R | R | R | R | R | — | — | R |
| Audit log | R | R | — | — | — | — | — | — | — | — | R |
| Suppliers | M | R U (status) | R | C R U | R | — | — | — | — | — | R |
| Quality inspection | R | R | C R | R | — | — | — | — | — | — | R |
| Quality hold / release | R | R | C X | — | — | R | R | R | — | — | R |
| Quality rules | M | M | R | — | — | — | — | — | — | — | R |
| Scales & calibration | M | R | C R (daily verification) | C R (daily verification) | — | — | — | — | — | — | R |
| Purchase voucher | R | R A X(void) | R V | C R U S X(cancel draft) | R | — | — | — | — | — | R |
| Supplier payment | R | R A X(reverse) | — | R | C R P | — | — | — | — | — | R |
| Lots & traceability | R | R | R | R | R | R | R | R | R (lookup) | — | R |
| Hopper / flotation | R | R | R | R | — | C R | — | — | — | — | R |
| Hopper reconciliation | R | R A(review) | R | R | — | C R | — | — | — | — | R |
| Pulping, machine checks | R | R | R | — | — | C R | — | — | — | — | R |
| Equipment & maintenance | M | M | R | — | — | C R | C R | — | — | — | R |
| Fermentation | R | R | C R (assessment) | — | — | C R | — | — | — | — | R |
| Washing & grading | R | R | C R (grading) | — | — | C R | — | — | — | — | R |
| Drying beds & batches | M | M | R | — | — | — | C R U | R | R | — | R |
| Moisture records | R | R | C R | — | — | — | C R | R | — | — | R |
| Final moisture verification | R | R | V | — | — | — | V | — | — | — | R |
| Raking & defects | R | R | R | — | — | — | C R | — | C R [own group] | — | R |
| Warehouse structure | M | M | — | — | — | — | — | R U | — | — | R |
| SRV | R | R A | R | — | — | — | C (deliver) R | C (receive) R | — | — | R |
| Inventory / bin cards | R | R | — | — | — | — | — | R | — | — | R |
| Transfers | R | A | — | — | — | — | — | C R | — | — | R |
| Adjustments | R | A | — | — | — | — | — | C R | — | — | R |
| Workers & groups | M | M | — | — | — | — | C R U | — | R [own group] | R [self] | R |
| Attendance | R | R A | — | — | — | — | R A | — | C R [own group] | R [self] | R |
| Payroll | R | R | — | — | R A(cashier) P | — | C R A(supervisor) | — | R [own group] | R [self] | R |
| Rations / SIV | R | R A | — | — | — | — | C (request) | C R P(issue) | C (request) [own group] | — | R |
| Expenses | R | R A | — | — | C R P | — | — | — | — | — | R |
| Cash transactions | R | R | — | — | C R | — | — | — | — | — | R |
| Audits | R | R (not unannounced schedule) | — | — | — | — | — | — | — | — | C R U |
| Corrective actions | R | C R U A(close) | C R U | R [assigned] U | R [assigned] U | R [assigned] U | C R [assigned] U | R [assigned] U | — | — | C R V |
| Reports | R | R export | R (quality, production) | R (purchasing) | R export (finance) | R (production) | R (drying) | R (warehouse) | — | — | R export |
| Notifications | own | own | own | own | own | own | own | own | own | own | own |


Notes:
- Permissions are data (`permissions`, `role_permissions`), seeded from this matrix by `backend/src/modules/access/catalog.ts` (129 codes, 11 roles). The SUPER_ADMIN can adjust assignments (`PUT /roles/:id/permissions`, reason required, audited); re-running the seed never re-grants something an administrator removed. The SUPER_ADMIN role can never lose `user:*`/`role:*` (lock-out guard). Code checks **permission codes**, not role names.
- Concrete codes follow `module:action`: `purchase:create`, `purchase:submit`, `purchase:verify`, `purchase:return`, `purchase:approve`, `purchase:cancel`, `purchase:void`, `payment:create`, `payment:approve`, `payment:disburse`, `payment:reverse`, `quality:inspect`, `quality:hold`, `quality:hold-release`, `scale:verify`, `drying:final-verify`, `srv:deliver`, `srv:receive`, `srv:approve`, `inventory:transfer-request`, `inventory:transfer-approve`, `inventory:adjust`, `inventory:adjust-approve`, `payroll:prepare`, `payroll:approve-supervisor`, `payroll:approve-cashier`, `payroll:pay`, `ca:verify`, `ca:close`, `settings:manage`, `settings:manage-system`, `auditlog:read`, `report:export`, `report:finance`, … The bracketed scopes of the matrix are separate codes: `…-own-group` (CAPITA), `…-self` (TEMP_WORKER), `…-assigned` (corrective actions).
- Cells the matrix leaves implicit (assumptions, adjustable at runtime): returning a voucher to draft = `purchase:return` (QUALITY_INSPECTOR, SITE_MANAGER); reversing an inventory transaction = `inventory:reverse` (SITE_MANAGER); uploading documents = `file:upload` (every role except TEMP_WORKER); reading other people's documents = `file:read` (SUPER_ADMIN, SITE_MANAGER, AUDITOR); `settings:manage` covers business keys, `settings:manage-system` covers the `auth`, `numbering`, `notifications` and `station` categories.
- ~~Segregation of duties applies to every role, including SUPER_ADMIN~~ — **removed for now** (see the note at the top of §7 and §11.3).
- TEMP_WORKER login is optional; most temporary workers will be represented only as `workers` rows.
- The authorization matrix is tested automatically: every route × every role (§15).

## 8. API architecture

- Base: `/api/v1/…` (URI versioning; a future `/api/v2` router can be mounted beside it).
- JSON only; decimals serialized as strings; timestamps ISO-8601 UTC; business dates `YYYY-MM-DD`.
- List endpoints: `?page=1&pageSize=25&sort=-createdAt&status=APPROVED&from=…&to=…` (plain query keys; `sort` values whitelisted per endpoint), response `{data: [...], meta: {page, pageSize, total}}`.
- Single: `{data: {...}}`.
- Commands are explicit sub-resources, not generic PATCHes of status: `POST /purchases/:id/submit`, `/verify`, `/approve`, `/cancel`, `/void`. Each command takes `{version, reason?}`.
- Idempotency: money-moving and stock-moving commands accept an `Idempotency-Key` header (stored in the `idempotency_keys` table for 24 h, keyed by user + route + key; the first 2xx response is replayed with `Idempotent-Replayed: true`; same key with a different body → 422 `IDEMPOTENCY_KEY_REUSED`) so double-clicks or retries on flaky rural networks don’t duplicate.
- Error envelope:
```json
{ "statusCode": 422, "error": "BUSINESS_RULE_VIOLATION", "code": "PAYMENT_BEFORE_APPROVAL",
  "message": "Payment cannot be processed before voucher approval",
  "details": { "voucherStatus": "VERIFIED" }, "timestamp": "…", "path": "/api/v1/payments", "requestId": "…" }
```
  400 validation (with field errors: `details: [{location, path, message}]`) · 401 (`UNAUTHORIZED`, `TOKEN_EXPIRED`, `INVALID_CREDENTIALS`, `ACCOUNT_LOCKED`, …) · 403 `FORBIDDEN` / `SEGREGATION_OF_DUTIES` / `PASSWORD_CHANGE_REQUIRED` · 404 · 409 `DUPLICATE` / `STALE_VERSION` / `APPEND_ONLY` · 422 `BUSINESS_RULE_VIOLATION` · 429. Every response carries `X-Request-Id`.
- Swagger UI: `/api/docs`; OpenAPI JSON: `/api/docs/openapi.json` (each operation lists its required permission).

Main endpoints (abridged; full Swagger generated per phase):

| Resource | Endpoints |
|---|---|
| auth ✅ | `POST /auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/change-password`, `GET /auth/me` |
| users ✅ | `GET/POST /users`, `GET/PATCH /users/:id`, `PUT /users/:id/roles`, `POST /users/:id/{deactivate,activate,unlock,reset-password}`, `GET /roles`, `PUT /roles/:id/permissions`, `GET /permissions`, `GET/POST /employees`, `PATCH /employees/:id` |
| settings ✅ | `GET /settings`, `GET /settings/:key`, `PUT /settings/:key` (`{value?, version, reason}`; omit `value` to confirm), `GET /settings/unconfirmed` |
| audit log ✅ | `GET /audit-logs` (filters), `GET /audit-logs/verify` |
| files ✅ | `POST /files` (multipart), `GET /files/:id`, `GET /files/:id/content` |
| health ✅ | `GET /health/live`, `GET /health/ready` |
| suppliers ✅ | `GET/POST /suppliers`, `GET/PATCH /suppliers/:id`, `PATCH /suppliers/:id/status`, `POST /suppliers/:id/documents`, `GET /suppliers/:id/documents`, `GET /suppliers/:id/history` (purchases, payments, inspections) |
| quality ✅ | `GET/POST /quality/inspections`, `GET /quality/inspections/:id` (`?available=true` = accepted and unused), `GET/POST /quality/holds`, `POST /quality/holds/:id/release`, `GET/POST /quality/rules`, `PATCH /quality/rules/:id`, `GET/POST /quality/grades`, `PATCH /quality/grades/:id`, `GET/POST /coffee-types`, `PATCH /coffee-types/:id` |
| equipment ✅ | `GET/POST /equipment`, `GET/PATCH /equipment/:id` (status change needs a reason), `GET/POST /equipment/:id/maintenance`, `GET/POST /equipment/:id/schedules`, `PATCH /maintenance-schedules/:id` |
| scales ✅ | `GET/POST /scales` (list = status board with current verification), `GET/PATCH /scales/:id`, `GET/POST /scales/:id/calibrations` |
| purchases ✅ | `GET /purchases`, `GET /purchases/summary` (dashboard), `POST /purchases` (draft incl. items + weight records, idempotent), `GET/PUT /purchases/:id`, `POST /purchases/:id/{submit,verify,return,approve,cancel,void}`, `GET /purchases/:id/pdf` |
| payments ✅ | `GET/POST /payments`, `GET /payments/:id`, `POST /payments/:id/{approve,reject,disburse,reverse}` (all idempotent) |
| lots | `GET /lots`, `GET /lots/:id`, `GET /lots/:id/events`, `GET /lots/:id/trace?direction=both`, `GET /lots/:id/outturn` |
| hopper | `POST /hopper/intakes`, `POST /hopper/intakes/:id/flotation`, `POST /hopper/reconciliations/run?date=`, `POST /hopper/reconciliations/:id/review` |
| pulping | `POST /pulping/machines/:id/inspections`, `POST /pulping/records`, `POST /pulping/records/:id/complete` |
| fermentation | `POST /fermentation/batches`, `POST /fermentation/batches/:id/measurements`, `POST /fermentation/batches/:id/complete` |
| washing / grading | `POST /washing/records`, `POST /grading/records` (creates grade child lots) |
| drying | beds CRUD, `POST /drying/batches`, `POST /drying/batches/:id/{start,assign-bed,unload-bed,final-verify}`, `POST /drying/raking` |
| moisture | `POST /moisture/records`, `GET /moisture/records?batchId=` |
| defects | `POST /defects`, `GET /defects`, `/defects/types` |
| warehouse | warehouses/sections/stacks CRUD, `POST /warehouse/srvs`, `POST /warehouse/srvs/:id/{submit,approve,reject,cancel}`, `GET /warehouse/srvs/:id/pdf` |
| inventory | `GET /inventory/balances`, `GET /inventory/transactions`, `GET /inventory/bin-cards/:id` (+`/pdf`), `POST /inventory/transfers` (+approve/reject), `POST /inventory/adjustments` (+approve), `POST /inventory/transactions/:id/reverse` |
| workers | workers, roles, groups CRUD, `POST /workers/assignments` |
| attendance | `POST /attendance` (bulk by group/day), `POST /attendance/approve` (bulk), `POST /attendance/:id/confirmation` |
| payroll | `POST /payroll` (generate from approved attendance), `POST /payroll/:id/{submit,approve-supervisor,approve-cashier,pay,cancel}`, `POST /payroll/items/:id/confirmation`, `GET /payroll/:id/pdf` |
| rations | ration items, `POST /rations/sivs` (+submit/approve/issue/cancel) |
| finance | ✅ Phase 2: `GET/POST /finance/cash` (funding/return), `GET /finance/cash/summary` · Phase 7: expenses (+approve/pay), `GET /finance/summary?period=` |
| audits | CRUD, `POST /audits/:id/{start,complete,close}`, `POST /audits/:id/items`, `POST /audits/unannounced/generate` |
| corrective-actions | CRUD, `POST /corrective-actions/:id/{start,resolve,verify,close}`, evidence upload |
| notifications | `GET /notifications`, `POST /notifications/:id/read`, `POST /notifications/read-all`, `GET /notifications/stream` (SSE) |
| reports | `GET /reports/{daily,weekly,monthly}/…` (web JSON), `POST /reports/exports` (PDF/XLSX job), `GET /reports/exports/:id` |
| qr | `GET /qr/:token` → `{entityType, entityId, route}`, `GET /qr/:entityType/:id/image.png` |

## 9. Workflow architecture

### 9.1 End-to-end flow and gates

| Step | Command | Backend gates (all enforced in services) |
|---|---|---|
| Supplier registration | `POST /suppliers` | Unique supplier code; unique (ID type, ID number) when provided. |
| Quality inspection | `POST /quality/inspections` | Supplier `ACTIVE`; percentages 0–100; sum within `quality.percentSumTolerance` of 100; configured `QualitySetting` rules evaluated → `REJECT` rules force `REJECTED`, `WARN` rules recorded; evaluation snapshot stored. |
| Scale verification | `POST /scales/:id/calibrations` | Daily verification **[MANUAL: daily]**; result PASS if |reading − standard| ≤ `scale.verificationToleranceKg` (if UNSET, verifier records PASS/FAIL explicitly). FAIL → scale `OUT_OF_SERVICE` + CA (`FAILED_CALIBRATION`). |
| Weighing + voucher draft | `POST /purchases` | Inspection exists, `ACCEPTED`, not already used, same supplier; every weight record’s scale verified within `scale.verificationFrequencyHours` → else per `scale.unverifiedPolicy`: `BLOCK` = 422, `WARN` = allowed with `scaleWarning` stored + notification; totals computed server-side (**Total = Weight × Price/kg** [MANUAL]); client totals ignored. |
| Submit | `…/submit` | DRAFT → PENDING_VERIFICATION; at least one item. |
| Verify | `…/verify` | Quality Inspector confirms grade/weights; verifier ≠ creator, ≠ weighing clerk. |
| Approve | `…/approve` | Site Manager; approver ∉ {creator, weighing clerk, verifier}. |
| Payment | `POST /payments` → approve → disburse | Voucher `APPROVED`; amount = voucher total; no live payment exists (DB partial unique); cashier ≠ weighing clerk [MANUAL]; payment approver ≠ cashier. Disburse writes `CashTransaction(OUT)`, voucher → PAID. |
| Lot creation | automatic | At `purchase.lotCreationTrigger` (default `ON_PAYMENT`, per the brief’s workflow order; option `ON_APPROVAL`). Same transaction. Event `PURCHASED`. |
| Hopper | `POST /hopper/intakes` | Lot stage PURCHASED, not on hold; hopper operational; intake ≤ hopper capacity (warning). Event `HOPPER_RECEIVED`. |
| Flotation | `…/flotation` | Floaters + sinkers vs intake within `hopper.flotationBalanceTolerancePct`; event `FLOTATION_COMPLETED`. |
| Pulping | `POST /pulping/records` | Machine `OPERATIONAL`; today’s machine inspection exists and PASS per `pulping.dailyInspectionPolicy` (BLOCK/WARN). Event `PULPED`. |
| Fermentation | start / measure / complete | Tank free (DB partial unique); duration defaults **24–48 h [MANUAL: typical]** from settings; completion before min requires reason; completion requires `mucilageAssessment = COMPLETE` if `fermentation.requireMucilageCompleteToEnd`. Events `FERMENTATION_STARTED/COMPLETED`. |
| Washing | `POST /washing/records` | Fermentation completed; output ≤ input. Event `WASHED`. |
| Grading | `POST /grading/records` | Σ grade outputs ≤ washing output; one child lot per grade (`<lot>-<gradeCode>`); parent status `SPLIT`. Events `GRADED` (parent) + `LOT_SPLIT`. |
| Drying batch / bed | create, assign bed(s), start | Child lot stage GRADING; each bed `AVAILABLE`, one active batch per bed; Σ loaded ≤ bed capacity. Event `DRYING_STARTED`. |
| Raking | `POST /drying/raking` | Batch `DRYING`; interval monitor **30 min default [MANUAL]**. |
| Moisture | `POST /moisture/records` | Classified vs `moisture.targetMinPct/MaxPct` **(10.5–11.5 % [MANUAL])**; out-of-range → notification; batch `currentMoisturePct` updated. Event `MOISTURE_CHECK`. |
| Defect picking | `POST /defects` | Recorded separately by type/source; per-batch cumulative vs `defect.correctiveActionThresholdPct` (UNSET → no auto CA). Event `DEFECT_RECORDED`. |
| Final moisture verification | `…/final-verify` | Latest reading within target range, taken within `moisture.finalVerificationMaxAgeHours`, by a user with `drying:final-verify`; batch → VERIFIED, lot stage FINAL_MOISTURE_VERIFIED. |
| SRV | create → submit → approve | Batch VERIFIED; **moisture ≤ `moisture.warehouseMaxPct` (11.5 % [MANUAL]) else 422 `MOISTURE_ABOVE_WAREHOUSE_LIMIT`**; Σ SRV net weights per batch ≤ batch final weight; deliverer ≠ receiver; approver ∉ {deliverer, receiver}; **manager approval [MANUAL field]**. Approval posts inventory IN, bin card entry, lot → WAREHOUSE / IN_STORE, beds unloaded → AVAILABLE. Event `WAREHOUSE_RECEIVED`. |
| Inventory | transfers / adjustments / issues | Ledger only; see §11.4. Events `TRANSFERRED`, `INVENTORY_ADJUSTED`, `RELEASED`. |

### 9.2 State machines (implemented as pure transition tables in `domain/`)

```
PurchaseVoucher: DRAFT → PENDING_VERIFICATION → VERIFIED → APPROVED → PAID
                 DRAFT|PENDING_VERIFICATION|VERIFIED → CANCELLED        (reason)
                 PENDING_VERIFICATION|VERIFIED → DRAFT                   (returned for correction, reason)
                 APPROVED → VOIDED                                       (Site Manager, reason; no live payment; lot still PURCHASED → lot CLOSED)
                 PAID → APPROVED                                         (its payment was REVERSED; the voucher can then be paid again or voided)
SupplierPayment: PENDING_APPROVAL → APPROVED → PAID ;  PENDING_APPROVAL → REJECTED ; PAID → REVERSED (reversal cash txn)
                 (if payment.requiresApproval = false: created directly as APPROVED)
Lot stage:       PURCHASED → HOPPER → FLOTATION → PULPING → FERMENTATION → WASHING → GRADING
                 → (child) DRYING → FINAL_MOISTURE_VERIFIED → WAREHOUSE → RELEASED
Lot status:      ACTIVE ⇄ ON_HOLD (QualityHold) ; ACTIVE → SPLIT (parent after grading) ; → IN_STORE → RELEASED ; → REJECTED
Fermentation:    IN_PROGRESS → COMPLETED | CANCELLED
DryingBatch:     LOADING → DRYING → READY_FOR_VERIFICATION → VERIFIED → RECEIVED_IN_STORE ; DRYING → REJECTED
DryingBed:       AVAILABLE → LOADED → DRYING → READY → AVAILABLE ; any → MAINTENANCE/OUT_OF_SERVICE (only when empty)
SRV:             DRAFT → PENDING_APPROVAL → APPROVED | REJECTED ; DRAFT|PENDING_APPROVAL → CANCELLED
Payroll:         DRAFT → SUBMITTED → SUPERVISOR_APPROVED → CASHIER_APPROVED → PAID ; pre-PAID → CANCELLED
SIV:             DRAFT → PENDING_APPROVAL → APPROVED → ISSUED ; → REJECTED | CANCELLED
Expense:         DRAFT → PENDING_APPROVAL → APPROVED → PAID ; → REJECTED | CANCELLED
CorrectiveAction: OPEN → IN_PROGRESS → RESOLVED → VERIFIED → CLOSED ; RESOLVED → IN_PROGRESS (verification failed)
Audit:           SCHEDULED → IN_PROGRESS → COMPLETED → CLOSED ; SCHEDULED → CANCELLED
```

A **QualityHold** on a lot blocks every forward transition of that lot (and its children) until released by `quality:hold-release`. This implements the Quality Inspector’s authority to stop substandard processing.

## 10. Traceability architecture

- **Identity**: `Lot.lotNumber` (human) + `Lot.id` (UUID) + `Lot.qrToken` (random, unguessable). Root lot is created from exactly one purchase voucher; grade lots are children via `parentLotId`. Child lots keep the root’s `originalCherryWeightKg` for outturn.
- **Event spine**: every stage command appends a `LotEvent` with `(lotId, sequence, eventType, stage, quantityKg, refType, refId, userId, occurredAt)` in the same transaction as the stage record. `refType/refId` point at the exact operational record (HopperRecord, PulpingRecord, …).
- **Backward trace** (`GET /lots/:id/trace?direction=backward`): recursive CTE up `parent_lot_id` to the root → PurchaseVoucher → QualityInspection → WeightRecords (→ Scale + calibration valid at weighing time) → SupplierPayment → Supplier.
- **Forward trace**: recursive CTE down children → DryingBatches → beds, moisture, raking, defects → SRVs → InventoryTransactions → current StockBalance per stack → SIV (release).
- **Timeline view**: union of events across the lot tree, ordered by time — the “Lot passport” page (printable PDF in Phase 8).
- **QR**: `GET /qr/:token` resolves supplier, lot, drying bed, drying batch, warehouse stack, SRV. Printed QR encodes `https://<host>/q/<token>`; the frontend route resolves the token (auth required) and redirects to the record. Tokens reveal nothing without login.
- **Integrity checks** (nightly job + report): stage records without an event, events without a record, lots whose child weights exceed parent output, stock balances not equal to ledger sums.

## 11. Business-rule architecture

### 11.1 Where rules live
- `domain/` pure functions per module (calculators, validators, state tables) — unit tested.
- Application services apply them inside `withTransaction(pool, tx => …)` with the settings read through that transaction (`settings.getIn(tx, key)`), and snapshot them onto the record.
- `SegregationOfDutiesPolicy` and `ScopePolicy` are shared providers.
- Rules requiring numbers call `SettingsService`; if a required setting is `UNSET` the service returns 422 `SETTING_NOT_CONFIGURED` (`settings.require()`) rather than guessing (except where §20 defines a safe fallback).

### 11.2 Key calculations
| Rule | Formula | Source |
|---|---|---|
| Purchase line & voucher total | `amount = weightKg × pricePerKg`; `total = Σ amount`; `totalWeight = Σ weightKg` | [MANUAL] |
| Weight record | `net = gross − tare` | standard |
| Hopper reconciliation | `diff = intake − purchased`; `diff% = |diff| / purchased × 100`; flag if `diff% > hopper.reconciliationTolerancePct` | [MANUAL: compare & flag]; tolerance configurable |
| Outturn | `final parchment kg / original red cherry kg × 100`; final parchment = Σ approved SRV net weight across the root lot’s tree | [MANUAL] |
| Outturn by grade | grade parchment kg / root cherry kg × 100 (grades sum to the lot total; no apportioning of cherry) | derived from manual formula |
| Payroll | `total = days × dailyRate`; days = count of approved `PRESENT` attendance in the period not already paid; rate = worker override ?? role default | [MANUAL] formula |
| Capita ratio | warn when group size outside `workforce.workersPerCapitaMin..Max` (20–30) | [MANUAL: approx.] |
| Moisture class | `< min` BELOW, `> max` ABOVE, else WITHIN | [MANUAL 10.5–11.5] |

### 11.3 Segregation of duties — REMOVED (2026-10-02)

Not enforced: one SUPER_ADMIN may perform every step of a record. The table below is the original design, kept for when roles return.

| Record | Rule |
|---|---|
| PurchaseVoucher | weighing clerk ≠ cashier [MANUAL]; verifier ∉ {creator, weighing clerk}; approver ∉ {creator, weighing clerk, verifier} |
| SupplierPayment | payment approver ≠ paying cashier; cashier ≠ voucher weighing clerk |
| SRV | deliverer ≠ receiver; approver ∉ {deliverer, receiver} |
| Transfer / Adjustment | approver ≠ requester |
| Payroll | supervisor approver ≠ preparer; cashier approver ∉ {preparer, supervisor approver} |
| Attendance | approver ≠ recorder |
| Expense / SIV | approver ≠ requester |
| CorrectiveAction | verifier ≠ responsible person |
| Settings | change requires reason; audited with before/after |

### 11.4 Inventory rules
- `InventoryLedgerService.post(tx, lines[])` is the only writer. Each line: lock `StockBalance` row (create if missing) → compute new balance → reject if negative → insert transaction with `balanceAfter` → update balance with version bump.
- Transfer = OUT line at source + IN line at destination in one DB transaction, both linked to `StockTransfer`.
- Adjustment requires approval (`inventory.adjustmentRequiresApproval`, PROVISIONAL true) and a reason; if |adjustment| exceeds `inventory.discrepancyCaThresholdPct` → CA `INVENTORY_DISCREPANCY` (or `MISSING_STOCK` for negative).
- Reversal posts the mirror line referencing `reversalOfId` (unique → cannot reverse twice).

### 11.5 Corrective-action triggers
`CorrectiveActionsService.raise(tx, {source, …})` is called by: failed calibration, reconciliation discrepancy, flotation imbalance, defect threshold, moisture problem (e.g. SRV attempt above limit, repeated out-of-range), inventory discrepancy/missing stock, process violation (e.g. pulping under WARN policy without inspection, fermentation overdue), audit finding (`NON_COMPLIANT` item). Setting `controls.correctiveActionMode`: `AUTO_CREATE` or `RECOMMEND` (notification with prefilled CA draft). PROVISIONAL: `RECOMMEND`, except failed calibration and audit findings which always create (they are explicit triggers in the brief).

## 12. Notification architecture

```
Service tx ──► outbox_events (same tx)
                  │  OutboxRelay (worker, every 2 s, FOR UPDATE SKIP LOCKED, one savepoint per event)
                  │  pg-boss send(..., { db: relay tx })  → job insert + PROCESSED update commit together
                  ▼
        pg-boss queue "domain-events" ──► NotificationRules (maps event → recipients by permission, dedupeKey)
                                                  │
                                                  ▼
                                         ChannelDispatcher
                                   ├─ InAppChannel (notifications row + NOTIFY → SSE stream to open browsers)
                                   ├─ EmailChannel (nodemailer adapter, disabled by setting)
                                   └─ SmsChannel (interface only; provider later)
Scheduled jobs (pg-boss schedule(), cron in the station timezone; minimum granularity 1 minute):
  fermentation-monitor  every 5 min   approaching (maxHours − leadHours) / overdue (> maxHours)
                                       + sendAfter() job at fermentation start (the scanner is the safety net)
  raking-monitor        every 5 min   within drying.activeHours only; last raking older than interval
  calibration-due       hourly        scale not verified within frequency
  maintenance-due       daily         schedules past next_due_at
  ca-overdue            daily         due_date < today and status < RESOLVED
  hopper-reconciliation daily at hopper.reconciliationRunTime (can be run manually)
  approvals-digest      hourly        pending SRV / payment / payroll / transfer approvals
  integrity-check       nightly       traceability and ledger consistency
  maintenance.purge-expired  02:15    expired refresh tokens and idempotency keys   ← Phase 1 ✅
```

Notification types = `notification_type` enum (all ten in the brief + raking overdue, payroll approval, maintenance due, quality hold). Recipients resolved by permission (e.g. `SRV_AWAITING_APPROVAL` → users with `srv:approve`). `dedupe_key` (e.g. `ferm-overdue:<batchId>`) with the unique `(user_id, dedupe_key)` prevents alert storms. Failed jobs retry with exponential backoff (pg-boss `retryLimit`/`retryBackoff`) and then land in a dead-letter queue visible to SUPER_ADMIN. Realtime push uses PostgreSQL `LISTEN/NOTIFY` so it works across the web and worker processes without Redis.

Phase 1 delivers the relay, the `domain-events` consumer (logs events) and the housekeeping schedule; Phase 2 adds `calibration-due` (hourly, logs scales needing verification); the notification rules, channels and SSE endpoint arrive in Phase 7.

## 13. Reporting architecture

- **Reports module** exposes read-only query services per domain (`ProcurementReports`, `ProductionReports`, `DryingReports`, `WarehouseReports`, `WorkforceReports`, `FinanceReports`, `QualityReports`, `YieldReports`). Plain parameterised SQL with typed row mappers for aggregates (`date_trunc` in the station timezone); never mutate.
- **Filters** common to all: date range, lot, supplier, grade (+ status where relevant). Validated by a shared Zod `reportFilter` schema.
- **Web view**: JSON → dashboard cards, MUI tables, charts.
- **Exports**: `POST /reports/exports` enqueues a pg-boss `reports` job → worker renders **PDFKit** (vouchers, SRV, bin card, payroll sheet, lot passport, tabular reports) or **ExcelJS** (streaming workbook, one sheet per section, numeric cells typed) → stored via the storage adapter as `documents(category=REPORT)` → `report_jobs` COMPLETED → in-app notification with download link. Small documents (single SRV/voucher PDF) render synchronously in the request.
- PDFKit chosen over headless Chromium: small memory footprint (fits a Render starter instance), deterministic layout.
- **Report catalogue**: Daily (cherry purchased, expenditure, funds disbursed, hopper intake, floaters, sinkers, washed, Grade 1/2, beds, moisture, warehouse receipts) · Weekly (revenue/expenditure, outturn, temporary labour, warehouse balance, quality stats, production stats) · Monthly (purchasing, production, inventory, finance, payroll, expenses, yield, quality, supplier stats) · Yield by lot/supplier/day/week/month/grade.
- **Performance**: indexes in §6.5; if monthly queries become slow, add materialized daily summary tables refreshed by a pg-boss job (Phase 9 decision based on measurements, not upfront).
- "Revenue" in the weekly report: the brief lists no sales module, so revenue is limited to recorded `cash_transactions` IN entries (e.g. funding). Flagged in §19.

## 14. Security architecture

| Area | Design |
|---|---|
| Passwords | argon2id; rules from `auth.passwordPolicy` (PROVISIONAL: ≥ 10 chars, a letter, a digit, not containing the username); forced change on first login and after an admin reset (every other endpoint answers 403 `PASSWORD_CHANGE_REQUIRED`); lockout after `auth.maxFailedLogins` (5) for `auth.lockoutMinutes` (15); unknown usernames take the same time as wrong passwords. |
| Tokens | Access JWT (HS256, `auth.accessTokenTtl` = 15 min, `sub`, `iss`, `jti`), held in browser memory only. Refresh token: random 256-bit, stored as SHA-256, httpOnly cookie scoped to `/api/v1/auth`, `auth.refreshTokenTtl` = 7 d, rotated on every use; presenting a rotated token revokes the whole family and is audited. Logout, password change, deactivation and admin reset revoke sessions. Status, roles and permissions are read from the DB on every request, so changes apply immediately. |
| Cookies across Render hosts | `*.onrender.com` is on the public-suffix list, so a Static Site and a Web Service on onrender.com are cross-site: use `REFRESH_COOKIE_SAMESITE=none` + `REFRESH_COOKIE_SECURE=true`. With a custom domain (`app.example.com` + `api.example.com`) use `strict`. |
| Authorization | Route registry: deny by default (`access` is mandatory; test asserts the public list), any-of permission codes, checked before validation. Scope policies in services (SoD removed, see §11.3). |
| Input | Zod strict schemas (unknown fields rejected), max lengths, enum checks, decimal-string patterns; JSON body limit 1 MB. All SQL parameterised; sort columns mapped through whitelists. |
| Transport & headers | TLS terminated by Render; `helmet` (HSTS, noSniff, frameguard, …); CORS allowlist from `CORS_ORIGINS` with credentials; `trust proxy` = 1 on Render. Static Site security headers set in `render.yaml`. |
| Rate limiting | `express-rate-limit`: 600 req/min per IP on the API, 20/min on `/auth/*`. In-memory store (single instance); switch to a PostgreSQL-backed store if the API is scaled horizontally. |
| Idempotency | `Idempotency-Key` on money/stock commands, stored in `idempotency_keys` (24 h), per user + route; mismatched body → 422. |
| Files | Type by magic bytes (PDF/PNG/JPEG/WebP only), size limit (`MAX_UPLOAD_MB`), SHA-256, random keys, private bucket; downloads only through the API (LOCAL stream / 5-minute presigned S3 URL); readers = uploader or `file:read`. |
| Audit | Hash-chained `audit_logs` written in the same transaction; append-only trigger; LOGIN / LOGIN_FAILED / LOGOUT / settings / role changes recorded; `GET /audit-logs/verify` recomputes the chain. |
| Secrets | `.env` never committed (`.gitignore`; `.env.example` only); env validated at boot (refuses the placeholder JWT secret in production); on Render secrets live in the service's environment / an Environment Group. |
| Data | Render PostgreSQL automated backups (point-in-time recovery on paid plans) + a scheduled `pg_dump` to the S3 bucket (Phase 9); monthly restore drill documented; bucket versioning on. |
| Supply chain | `npm audit` in CI, Dependabot, lockfiles committed, Node version pinned (`engines`). |

## 15. Testing architecture

| Level | Tooling | Scope |
|---|---|---|
| Unit | Jest (ts-jest, ESM) | Every `domain/` function: purchase totals & rounding, quality rule evaluation & percent sum, scale verification, moisture classification, reconciliation, outturn, payroll, inventory ledger math, state machines (every allowed and forbidden transition), SoD policy, permission catalog vs matrix, settings registry, numbering, decimal helpers. |
| Integration | Jest + Supertest against a **real PostgreSQL** database that global setup drops, re-creates, migrates and seeds on every run | Auth flows (lockout, rotation, reuse detection, forced change), users/roles, settings, audit chain (concurrency + tamper detection), files, idempotency, outbox → pg-boss, sequences under concurrency, DB constraints/triggers. Later: Purchase → Payment → Lot, Lot → … → SRV → Inventory; rollback on injected failure; two payments for one voucher in parallel → exactly one succeeds; parallel stock issues never go negative. |
| Authorization | Generated matrix test: reads every registered route's `access` and the seeded role_permissions, then calls every endpoint as every role asserting 403 exactly where the matrix says so. Plus 401 for every non-public route without a token, and a fixed list of public routes. Runs as SUPER_ADMIN plus a no-permission and a read-only test role. |
| E2E | Supertest "station day" scenario (register supplier → … → SRV above 11.5 % blocked → dry further → SRV approved → bin card → transfer → release). Frontend E2E with Playwright added in Phase 8. |
| Database | Migrations apply on an empty database in every test run and in CI; checksum guard; constraint/trigger tests. |
| Frontend | Vitest + Testing Library: permission-gated rendering, navigation by role, formatting, API error handling. |

Phase exit gate (CI and local): `tsc --noEmit` (backend + frontend), ESLint, migrations apply on an empty DB, unit + integration + authorization tests green, OpenAPI builds, both apps build.

## 16. Deployment architecture (Render)

### 16.1 Services (`render.yaml` Blueprint)

| Render resource | What runs | Commands |
|---|---|---|
| **PostgreSQL** `cws-db` (PostgreSQL 16) | All business data + pg-boss schema | — |
| **Web Service** `cws-api` (Node 22) | Express API + in-process worker | build `npm ci && npm run build` · start `npm run start:render` (= migrate → seed → server; the migrator's advisory lock makes concurrent starts safe). On paid plans the migrate/seed step can move to a *pre-deploy command*. Health check `/api/v1/health/ready`. |
| **Static Site** `cws-web` | Vite build of the React app | build `npm ci && npm run build` · publish `dist` · rewrite `/*` → `/index.html` · `VITE_API_BASE_URL` = API URL |
| Background Worker `cws-worker` (optional) | `npm run start:worker` | Add when job volume grows; then `RUN_WORKER_IN_PROCESS=false` on the API. |
| S3-compatible bucket (external) | Uploaded documents, generated reports, DB dumps | `STORAGE_DRIVER=s3`, `S3_*` env vars. |

- Render's free Web Service sleeps when idle and the free database expires; production needs paid instances (always-on API so scheduled jobs run on time).
- Environments: `development` (local), `staging` and `production` (separate Render projects/Blueprint instances). Config purely by environment variables.
- Observability: pino JSON to stdout → Render logs (forward to a log service if needed); request ids in every response; queue depth/failed jobs visible in `pgboss.job` (pgAdmin) and, in Phase 9, an admin page.

### 16.2 Local development
`docker-compose.yml` starts PostgreSQL 16 and pgAdmin 4 only; the API (`npm run dev`, tsx watch) and the frontend (`npm run dev`, Vite proxying `/api` → `:4000`) run on the host.

### 16.3 CI/CD (GitHub)
GitHub Actions on every push/PR: install → typecheck → lint → unit + integration tests against a `postgres:16` service container (migrations on an empty DB) → OpenAPI generation → frontend typecheck, lint, tests, build. Render auto-deploys `main` after CI passes (Render "auto-deploy: after CI checks pass").

### 16.4 pgAdmin
- Local: http://localhost:5050 (credentials in `docker-compose.yml`), server `postgres:5432`.
- Render: add a server in pgAdmin with the **External Database URL** host/port/user/password, SSL mode `require`; allow your IP in the database's access control list. Use a read-only role for ad-hoc queries (`db/roles.sql` creates `cws_readonly`). Never edit ledger tables by hand — the triggers will refuse, by design.

## 17. Development roadmap

| Phase | Deliverables | Exit criteria |
|---|---|---|
| 1 Foundation ✅ | Repo, config validation, SQL migrations (full schema + constraints), migration runner, seed (roles, permissions, settings, admin), auth (login/refresh/logout/lockout/forced change), users/roles/employees, permission route registry, audit log (+ verify), settings (+ confirm), files, outbox + pg-boss worker skeleton, idempotency, sequences, health, error envelope, Swagger, logging; frontend shell (login, change password, layout, nav by permission, dashboard shell, users, roles, settings, audit log pages); Render Blueprint, CI | Checklist in §15 green; authorization matrix test for Phase 1 routes |
| 2 Procurement ✅ | Suppliers (+docs), quality inspections/rules/holds, equipment & scales & daily verification, purchase vouchers (full state machine, PDF), payments, cash ledger, lot creation hook | Purchase → Payment → Lot integration tests; SoD tests |
| 3 Production | Lots & events, hopper + flotation + reconciliation, pulping + machine checks + maintenance, fermentation (+ monitor jobs), washing, grading (child lots) | Lot → … → Grading integration tests |
| 4 Drying | Beds (QR), batches, bed assignment, raking + monitor, moisture, defects, final verification; mobile screens | Drying rules & alerts tested |
| 5 Warehouse | Warehouses/sections/stacks, SRV (+PDF, approval), inventory ledger, bin cards (+PDF), transfers, adjustments, reversals, traceability API + lot passport UI, QR resolver | Drying → Warehouse → Inventory tests; ledger concurrency tests |
| 6 Workforce | Worker roles, workers, groups/capitas, assignments, attendance (+signature/thumbprint upload), payroll, rations/SIV | Payroll calc & approval chain tests |
| 7 Controls | Expenses, finance summaries, audits (unannounced generation), corrective actions (+auto triggers wiring), full notification rules & channels (in-app SSE via LISTEN/NOTIFY), approval inbox | CA trigger tests; notification tests |
| 8 Reporting | Daily/weekly/monthly report services, dashboards, PDF/Excel export jobs, yield reports | Report totals reconcile with ledgers in tests; Playwright smoke |
| 9 Production readiness | Security review, index/EXPLAIN review, load test, backups & restore drill, monitoring, runbooks, user docs | Go-live checklist signed off; all PROVISIONAL settings confirmed |

## 18. Folder structure

```
coffee-washing-station/
├── .github/workflows/ci.yml
├── render.yaml                     Render Blueprint (DB + API web service + static site)
├── docker-compose.yml              local PostgreSQL 16 + pgAdmin 4
├── README.md
├── docs/ ARCHITECTURE.md  (RUNBOOK.md, SETTINGS.md, BACKUP.md in Phase 9)
├── backend/
│   ├── db/
│   │   ├── migrations/ 0001_enums.sql … 0012_platform_support.sql
│   │   └── roles.sql               optional least-privilege roles (cws_app, cws_readonly)
│   ├── src/
│   │   ├── server.ts  worker.ts  app.ts  container.ts  logger.ts  load-env.ts
│   │   ├── config/ env.ts
│   │   ├── db/ pool.ts  migrator.ts  migrate.ts  seed-lib.ts  seed.ts
│   │   ├── http/ api.ts (route registry)  schemas.ts  error-handler.ts  idempotency.ts  openapi.ts  types.ts
│   │   ├── common/ errors.ts  decimal.ts  util.ts  policies/ segregation-of-duties.ts (scope.ts in Phase 6)
│   │   ├── core/ audit-log/ settings/ sequences/ outbox/ queue/ storage/ (lot-events/ inventory-ledger/ cash-ledger/ later)
│   │   ├── jobs/ worker.ts         pg-boss handlers and schedules
│   │   ├── openapi/ generate.ts
│   │   └── modules/ access/ auth/ users/ settings/ audit-log/ files/ health/  (suppliers/ quality/ … per phase)
│   │         └── <module>/ x.routes.ts  x.service.ts  (x.repo.ts)  domain/
│   ├── test/ unit/  integration/  helpers/ (global setup, app factory, users & tokens)
│   ├── package.json  tsconfig.json  jest.config.js  eslint.config.js  .env.example
└── frontend/
    ├── src/ api/ auth/ components/ layouts/ pages/ (admin/) routes/ utils/ test/  navigation.tsx  theme.ts  App.tsx  main.tsx
    ├── public/
    ├── index.html  package.json  vite.config.ts  tsconfig.json  eslint.config.js  .env.example
```

## 19. Risks, edge cases and open questions

**Open questions (need your answer or the manual):**
1. **Manual not attached.** Please upload it; I will reconcile this design (terminology, forms, signatures, thresholds) before Phase 2.
2. **Lot granularity.** The brief says every purchased batch gets its own Lot ID (one voucher → one lot). Many stations combine a day’s purchases into one processing lot at the hopper. If the manual does that, we need a MERGE lineage (many parents → one child). The schema supports single-parent splits now; merge would add a `LotLineage` table.
3. **Floaters.** The brief records floaters kg but not what happens to them (separate lot? rejected? sold?). Default: recorded as quantity only, no child lot.
4. **Who verifies a purchase voucher?** Assumed Quality Inspector (verify) and Site Manager (approve). Please confirm.
5. **Final moisture verification authority** — assumed Quality Inspector or Drying Supervisor.
6. **Revenue** — no coffee sales/dispatch pricing in the brief; “revenue” is limited to recorded cash inflows unless a sales module is added.
7. **Partial payments** — the brief implies one payment per voucher; partial/instalment payments are not supported.
8. **Currency & timezone** — assumed ETB and Africa/Addis_Ababa (PROVISIONAL settings).

9. **Hosting plan on Render** — scheduled jobs need an always-on (paid) Web Service or Background Worker; the free tier sleeps. Which Render plan and which S3-compatible provider (AWS S3, Cloudflare R2, Backblaze B2)?
10. **Custom domain** — with `app.<domain>` and `api.<domain>` the refresh cookie can be `SameSite=Strict`; on bare `*.onrender.com` hosts it must be `SameSite=None; Secure`.

**Risks & edge cases handled in design:**
- Unreliable connectivity/power at rural stations → idempotency keys, short forms, mobile screens designed for a later offline queue; server time is authoritative (clients can’t backdate beyond `ops.maxBackdateHours`).
- Day boundaries → all “daily” logic (scale verification, reconciliation, attendance, reports) uses the station timezone setting.
- Natural weight loss purchase → hopper → handled by configurable tolerance; UNSET tolerance means *every* difference is flagged (strict, never silently accepted).
- Rain/rewetting raises moisture after a good reading → final verification requires a recent reading (`finalVerificationMaxAgeHours`) and SRV rechecks the latest reading.
- One batch across several beds, or partial SRVs per batch → supported with Σ checks.
- Concurrency (double payment, double stock issue, two operators on one tank/bed) → partial unique indexes + row locks + optimistic versions.
- Small staff making SoD impossible on some days → SoD is not bypassable; the site must assign a second authorized user (policy decision surfaced to management, not hidden in code).
- Corrections after posting → reversals only; voiding a voucher whose lot is already in processing is blocked and routed to a Corrective Action.
- Raking alerts at night → monitor only within `drying.activeHours` (UNSET → raking alerts disabled until configured).
- Audit log growth → bigint identity, indexed, partition by month in Phase 9 if volume requires. The hash chain is serialised by an advisory lock held until commit — negligible at station volumes, revisit if write throughput ever matters.
- Single API instance on Render → rate limits and the settings cache are in memory; if the API is scaled out, move rate limiting to PostgreSQL and keep `RUN_WORKER_IN_PROCESS=true` on exactly one instance (or use the Background Worker).
- Parallel refresh from several browser tabs → the SPA refreshes single-flight per tab and tabs share the cookie; a true race can trigger reuse detection and sign the user out (safe failure).
- QR codes photographed and shared → tokens only resolve for authenticated users with read permission.
- Setting changes mid-season → snapshots on records keep history explainable.

## 20. Assumptions and configurable settings

`source`: **MANUAL** = value given in the brief/manual · **PROVISIONAL** = engineering default, shown on a “settings to confirm” banner until a Site Manager confirms it · **UNSET** = must be set; fallback behaviour noted · **CONFIRMED** (runtime) = changed or explicitly confirmed through `PUT /settings/:key` (reason + audit). The registry in `backend/src/core/settings/registry.ts` holds the default, source and validator of every key; `numbering.*` is one JSON setting `numbering.formats`.

| Key | Default | Source | Behaviour |
|---|---|---|---|
| `station.timezone` | Africa/Addis_Ababa | PROVISIONAL | Day boundaries |
| `finance.currency` | ETB | PROVISIONAL | Display/exports |
| `finance.roundingMode` | HALF_UP | PROVISIONAL | Money/weight rounding |
| `numbering.*` | `PV-YYYY-000001`, `SRV-…`, `LOT-YYMMDD-0001`, child `<lot>-<grade>` | PROVISIONAL | Document numbers |
| `quality.percentSumTolerance` | 0.5 | PROVISIONAL | Red + green + overripe ≈ 100 |
| `QualitySetting` rules | none | UNSET | No automatic rejection until rules are configured; inspector decides |
| `scale.verificationFrequencyHours` | 24 | MANUAL (daily) | Validity window |
| `scale.verificationToleranceKg` | — | UNSET | Inspector records PASS/FAIL manually until set |
| `scale.unverifiedPolicy` | BLOCK | PROVISIONAL | BLOCK or WARN |
| `purchase.lotCreationTrigger` | ON_PAYMENT | MANUAL (workflow order) | or ON_APPROVAL |
| `payment.requiresApproval` | true | PROVISIONAL | Payment approval step |
| `hopper.reconciliationTolerancePct` | 0 | UNSET → strict | Flag any difference |
| `hopper.flotationBalanceTolerancePct` | 0 | UNSET → strict | Floaters + sinkers vs intake |
| `hopper.reconciliationRunTime` | 20:00 | PROVISIONAL | Daily job |
| `pulping.dailyInspectionPolicy` | BLOCK | PROVISIONAL | BLOCK/WARN |
| `fermentation.minHours` / `maxHours` | 24 / 48 | MANUAL (typical) | Expected window |
| `fermentation.approachingLeadHours` | 2 | PROVISIONAL | Alert before max |
| `fermentation.requireMucilageCompleteToEnd` | true | PROVISIONAL | Completion gate |
| `fermentation.sweetnessScale`, `acidityScale` | — | UNSET | Labels only |
| `grading.outputTolerancePct` | 0 | UNSET → strict | Σ grades ≤ washed output |
| `drying.rakingIntervalMinutes` | 30 | MANUAL | Raking monitor |
| `drying.activeHours` | — | UNSET | Raking alerts off until set |
| `moisture.targetMinPct` / `targetMaxPct` | 10.5 / 11.5 | MANUAL | Classification & alerts |
| `moisture.warehouseMaxPct` | 11.5 | MANUAL | SRV hard block |
| `moisture.finalVerificationMaxAgeHours` | — | UNSET | Required before final verification is allowed |
| `defect.correctiveActionThresholdPct` | — | UNSET | No auto CA until set |
| `inventory.adjustmentRequiresApproval` | true | PROVISIONAL | |
| `inventory.discrepancyCaThresholdPct` | 0 | UNSET → strict | Any adjustment raises CA recommendation |
| `srv.requiresManagerApproval` | true | MANUAL (field) | |
| `workforce.workersPerCapitaMin` / `Max` | 20 / 30 | MANUAL (approx.) | Warning only |
| `payroll.dayCountStatuses` | [PRESENT] | PROVISIONAL | Which attendance counts as a day |
| `payroll.requireWorkerConfirmation` | true | PROVISIONAL | Signature/thumbprint before PAID |
| `audit.unannouncedFrequency` | WEEKLY | MANUAL | Generator job |
| `audit.unannouncedAreas` | all six areas | MANUAL | |
| `controls.correctiveActionMode` | RECOMMEND | PROVISIONAL | AUTO_CREATE/RECOMMEND |
| `ca.defaultDueDays` | — | UNSET | Due date entered manually |
| `notifications.emailEnabled` / `smsEnabled` | false / false | PROVISIONAL | |
| `ops.maxBackdateHours` | 24 | PROVISIONAL | Limit on backdated entries |
| `auth.accessTokenTtl` / `refreshTokenTtl` | 15m / 7d | PROVISIONAL | |
| `auth.maxFailedLogins` / `lockoutMinutes` | 5 / 15 | PROVISIONAL | |
| `auth.passwordPolicy` | min 10, letter + digit | PROVISIONAL | New and changed passwords |

**Assumptions** (all reversible via settings or the matrix): single station per deployment (multi-station would add a `Station` scope later); one quality inspection per voucher; one payment per voucher; grading outputs become child lots; Grade 1 / Grade 2 seeded as parchment grades and extendable; Employees are permanent staff, Workers are temporary staff; Capitas are Workers with an optional login.
