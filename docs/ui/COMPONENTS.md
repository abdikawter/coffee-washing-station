# Shared UI components

Spec: [`UI_REFRESH_SPEC.md`](../UI_REFRESH_SPEC.md) §4. Import everything from `src/components` (barrel `index.ts`).
Pages use these instead of ad-hoc markup; colours come only from the theme.

```tsx
import { DataTable, FilterBar, PageHeader, StatusChip, columns, useTableQuery, useUrlFilters } from '../../components';
```

## PageHeader
Title (h1), subtitle, breadcrumbs, a badge and actions. Sticky under the app bar (`sticky={false}` to turn off).
```tsx
<PageHeader title="PV-2026-0012" badge={<StatusChip status={v.status} domain="voucher" />}
  breadcrumbs={[{ label: 'Purchases', to: '/purchases' }, { label: v.number }]}
  actions={<Button variant="contained" component={RouterLink} to="/purchases/new">New voucher</Button>} />
```

## StatusChip
Every status goes through this chip. `domain` picks the colour map in `theme/status.ts`; the label defaults to the humanized value.
```tsx
<StatusChip status="PENDING_VERIFICATION" domain="voucher" />   // amber "Pending verification"
```

## MoneyText, WeightText, PercentText
Show decimal strings without float maths. Defaults: money 2 dp + "ETB", weight 3 dp + "kg", percent 2 dp + "%". Values round half away from zero.
```tsx
<MoneyText value={v.totalAmount} />   <WeightText value={lot.currentWeightKg} dp={0} />   <PercentText value={s.outturnPct} hideUnit />
```

## KpiCard
Dashboard figure with an optional change vs the previous period (`goodWhen` sets green/red), sparkline and link.
```tsx
<KpiCard label="Cherry bought today" value={s.todayKg} unit="kg" change={{ value: s.changePct, label: 'vs yesterday' }}
  sparkline={s.last14Days} to="/purchases" loading={q.isLoading} />
```

## DataTable + FilterBar (list page template)
Filters, page, page size and sort are all kept in the URL (`?status=APPROVED&page=2&sort=-createdAt`).
`useTableQuery().apiParams` matches the API (`page` is 1-based). Only `sortFields` (the API's sort whitelist) can be sorted.
```tsx
const { table, apiParams } = useTableQuery();
const { get } = useUrlFilters();
const q = useQuery({ queryKey: ['vouchers', apiParams, get('status'), get('search')],
  queryFn: () => purchasesApi.list({ ...apiParams, status: get('status') || undefined, search: get('search') || undefined }) });

<FilterBar filters={[
  { type: 'search', key: 'search', label: 'Search number or supplier' },
  { type: 'select', key: 'status', label: 'Status', options: VOUCHER_STATUSES.map((s) => ({ value: s, label: humanize(s) })) },
  { type: 'dateRange', key: 'date' },               // writes ?from=YYYY-MM-DD&to=YYYY-MM-DD
]} />
<DataTable label="Purchase vouchers" loading={q.isLoading} rows={q.data?.data ?? []}
  columns={[
    { field: 'number', headerName: 'Number', flex: 1 },
    columns.status('status', 'Status', 'voucher'),
    columns.money('totalAmount', 'Total (ETB)'),
    columns.dateTime('createdAt', 'Created'),
  ]}
  server={{ state: table, rowCount: q.data?.meta.total ?? 0, sortFields: ['number', 'createdAt'] }}
  rowTo={(r) => `/purchases/${r.id}`}
  empty={{ title: 'No vouchers yet', action: { label: 'Create voucher', to: '/purchases/new' } }} />
```
Leave out `server` for small lists that the API returns whole (roles, settings); the grid then pages and sorts on the client.
The toolbar has a column picker, a density switch and CSV export (the rows on screen).

## SectionCard
Groups one section of a form or detail page. `disablePadding` for tables that touch the edges.
```tsx
<SectionCard title="Weighings" actions={<Button>Add</Button>}>…</SectionCard>
```

## EmptyState
```tsx
<EmptyState title="No vouchers yet" message="Vouchers appear here once weighing starts." action={{ label: 'Create voucher', to: '/purchases/new' }} />
```

## JourneyStepper
Lot stages in order with the current one highlighted; weight and date for the stages already reached. Horizontal on desktop, vertical on phones.
```tsx
<JourneyStepper current={lot.currentStage} blocked={lot.status === 'ON_HOLD'}
  stages={LOT_STAGES.map((code) => ({ code, weightKg: byStage[code]?.weightKg, date: byStage[code]?.date }))} />
```

## Timeline
Vertical list of events (lot events, approvals, audit trail). The caller sets the order.
```tsx
<Timeline items={events.map((e) => ({ id: e.id, title: humanize(e.type), at: e.occurredAt, by: e.username, tone: 'info' }))} />
```

## ProgressRing
Circular progress with a centre label; `tone` uses the status meaning (amber near max, red over max).
```tsx
<ProgressRing value={(hours / maxHours) * 100} label={`${hours} h`} caption={`of ${min}–${max} h`} tone={statusTone(b.timing.state, 'fermentationTiming')} />
```

## ApprovalBar (detail page template)
Sticky bottom bar. An action shows only when `allowed` (document state) and the user holds `permission`.
`requiresReason` opens the reason dialog; `confirm` asks first. Errors are shown in the bar or dialog.
```tsx
<ApprovalBar hint="Waiting for approval" actions={[
  { key: 'approve', label: 'Approve', primary: true, permission: 'purchase:approve', allowed: v.status === 'VERIFIED',
    run: () => approve.mutateAsync({ version: v.version }) },
  { key: 'return', label: 'Return to draft', requiresReason: true, permission: 'purchase:verify', allowed: v.status === 'VERIFIED',
    run: (reason) => returnToDraft.mutateAsync({ version: v.version, reason: reason! }) },
]} />
```

## ConfirmDialog, ReasonDialog
`ConfirmDialog` for yes/no; `ReasonDialog` when a written, audited reason is required (at least 3 characters). Both stay open and show the error if `onConfirm` rejects.

## FieldScreen (field screen template)
One task per screen on a phone: big title, inputs ≥ 56 px, buttons ≥ 48 px, a full-width submit pinned to the bottom. Enter submits.
```tsx
<FieldScreen title="Record moisture" subtitle={`Bed ${bed.code}`} backTo="/drying" submitLabel="Save reading"
  onSubmit={save} busy={m.isPending} submitDisabled={!isDecimal(value)}>
  <TextField label="Moisture %" value={value} onChange={(e) => setValue(e.target.value)} slotProps={{ htmlInput: decimalInput }} />
</FieldScreen>
```
