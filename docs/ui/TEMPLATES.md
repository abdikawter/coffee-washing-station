# Page templates

Spec: [`UI_REFRESH_SPEC.md`](../UI_REFRESH_SPEC.md) §5. **Every page uses one of these five.** Import from `src/templates`;
the building blocks inside them are in [COMPONENTS.md](COMPONENTS.md).

```tsx
import { DashboardTemplate, DetailTemplate, FieldScreen, FormTemplate, ListTemplate, PanelList } from '../../templates';
```

| # | Template | Use for |
|---|---|---|
| 1 | `ListTemplate` | Any list of records (suppliers, vouchers, lots, users) |
| 2 | `DetailTemplate` | One record's own page (`/lots/:id`), workflow documents |
| 3 | `FormTemplate` | Create / edit screens on desktop or tablet |
| 4 | `FieldScreen` | One task on a phone in the field (moisture, raking, weighing) |
| 5 | `DashboardTemplate` | Dashboards and summary pages |

## 1. ListTemplate
PageHeader with a "New …" button (shown only with `create.permission`) → FilterBar → your `DataTable` → optional quick-view drawer.
```tsx
const [peek, setPeek] = useState<Supplier | null>(null);
<ListTemplate title="Suppliers" error={q.error}
  create={{ label: 'New supplier', to: '/suppliers/new', permission: 'supplier:create' }}
  filters={[{ type: 'search', key: 'search', label: 'Search name, code or phone' }, { type: 'select', key: 'status', label: 'Status', options }]}
  quickView={{ open: Boolean(peek), title: peek?.fullName ?? '', to: `/suppliers/${peek?.id}`, onClose: () => setPeek(null), children: <SupplierSummary s={peek} /> }}>
  <DataTable label="Suppliers" … onRowClick={setPeek} />   {/* or rowTo={(r) => `/suppliers/${r.id}`} to go straight to the page */}
</ListTemplate>
```

## 2. DetailTemplate
Summary card (number, status, key figures, header actions) → tabs (open tab kept in `?tab=`) → History timeline beside the tabs (below on phones) → `ApprovalBar` for workflow documents. Pass `loading` / `error` from the query.
```tsx
<DetailTemplate title={v.number} status={<StatusChip status={v.status} domain="voucher" />} loading={q.isLoading} error={q.error}
  breadcrumbs={[{ label: 'Purchases', to: '/purchases' }, { label: v.number }]}
  actions={<Button href={pdfUrl}>Print</Button>}
  figures={[{ label: 'Supplier', value: v.supplierName }, { label: 'Net weight', value: <WeightText value={v.totalNetKg} /> }, { label: 'Total', value: <MoneyText value={v.totalAmount} /> }]}
  tabs={[{ key: 'items', label: 'Items', count: v.items.length, content: <Items v={v} /> }, { key: 'documents', label: 'Documents', content: … }]}
  timeline={events}
  approval={{ hint: 'Waiting for approval', actions: [...] }} />
```

## 3. FormTemplate
SectionCards in a two-column grid (one on phones); a wide card takes `sx={{ gridColumn: '1 / -1' }}`. Sticky Save bar with Cancel.
`dirty` (React Hook Form `formState.isDirty`) shows "Unsaved changes", asks before Cancel and warns when the tab is closed or reloaded.
For long forms pass `steps` instead of children: each step's `validate` (e.g. `() => trigger(['supplierId'])`) runs before Next.
```tsx
<FormTemplate title="New supplier" breadcrumbs={…} onSubmit={handleSubmit(save)} submitLabel="Create supplier"
  busy={m.isPending} error={m.error} dirty={formState.isDirty} cancelTo="/suppliers">
  <SectionCard title="Identity">…</SectionCard>
  <SectionCard title="Contact">…</SectionCard>
</FormTemplate>
```
Note: the app uses `BrowserRouter`, so leaving through the side menu is not blocked. Only Cancel and closing or reloading the tab warn.

## 4. FieldScreen
See [COMPONENTS.md → FieldScreen](COMPONENTS.md#fieldscreen-field-screen-template). One task, inputs ≥ 56 px, numeric keypad via `decimalInput`, one big confirm button.

## 5. DashboardTemplate
KPI row (2 per row on phones, up to 5 on desktop) → charts row (first chart wider) → "Waiting for you" and "Alerts" panels. `PanelList` renders the panel rows, with an empty message and a loading skeleton.
```tsx
<DashboardTemplate title="Today" subtitle={today}
  kpis={[<KpiCard key="kg" label="Cherry bought today" value={s.todayKg} unit="kg" change={…} to="/purchases" />, …]}
  charts={[<SectionCard key="trend" title="Cherry per day (14 days)"><LineChart … /></SectionCard>]}
  waiting={<PanelList loading={q.isLoading} emptyText="Nothing waiting for you" items={approvals.map((a) => ({ id: a.id, primary: a.number, secondary: a.summary, badge: <StatusChip … />, to: a.url }))} />}
  alerts={<PanelList emptyText="No alerts" items={alerts} />} />
```
