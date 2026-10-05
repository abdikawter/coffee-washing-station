import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { Principal } from '../api/types';
import { AuthContext, hasPermission, type AuthState } from '../auth/AuthContext';
import {
  ApprovalBar, columns, ConfirmDialog, DataTable, EmptyState, FieldScreen, FilterBar, JourneyStepper, KpiCard, MoneyText,
  PageHeader, PercentText, ProgressRing, SectionCard, StatusChip, Timeline, useTableQuery, WeightText,
} from '../components';
import { ColorModeProvider, COLOR_MODES, useColorMode } from '../theme';

function ModeName() {
  return <output data-testid="mode">{useColorMode().mode}</output>;
}

const user = (permissions: string[]): Principal => ({
  id: 'u1', username: 'u', fullName: 'Test User', email: null, mustChangePassword: false, roles: [], permissions,
});

/** Shows the current URL so tests can assert what FilterBar / DataTable wrote. */
function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname}{l.search}</output>;
}

function setup(ui: ReactNode, { permissions = [] as string[], url = '/' } = {}) {
  const u = user(permissions);
  const auth: AuthState = { user: u, initializing: false, login: vi.fn(), logout: vi.fn(), changePassword: vi.fn(), can: (p) => hasPermission(u, p) };
  return render(
    <MemoryRouter initialEntries={[url]}>
      <AuthContext.Provider value={auth}>
        <ColorModeProvider>
          <Routes><Route path="*" element={<>{ui}<Where /></>} /></Routes>
        </ColorModeProvider>
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}
const where = () => screen.getByTestId('where').textContent;

describe('StatusChip', () => {
  it('colours by domain and humanizes the label', () => {
    setup(<><StatusChip status="ACTIVE" domain="supplier" /><StatusChip status="ACTIVE" domain="hold" label="Hold active" /><StatusChip status="PENDING_VERIFICATION" domain="voucher" /></>);
    expect(screen.getByText('Active').closest('[data-tone]')).toHaveAttribute('data-tone', 'success');
    expect(screen.getByText('Hold active').closest('[data-tone]')).toHaveAttribute('data-tone', 'error');
    expect(screen.getByText('Pending verification').closest('[data-tone]')).toHaveAttribute('data-tone', 'warning');
  });
});

describe('MoneyText / WeightText / PercentText', () => {
  it('format decimal strings with units and show — when empty', () => {
    setup(<><span data-testid="m"><MoneyText value="12345.5" /></span><span data-testid="w"><WeightText value="1234.5" /></span>
      <span data-testid="p"><PercentText value="62.456" dp={1} /></span><span data-testid="e"><WeightText value={null} /></span></>);
    expect(screen.getByTestId('m')).toHaveTextContent('12,345.50ETB');
    expect(screen.getByTestId('w')).toHaveTextContent('1,234.500kg');
    expect(screen.getByTestId('p')).toHaveTextContent('62.5%');
    expect(screen.getByTestId('e')).toHaveTextContent(/^—$/);
  });
});

describe('KpiCard', () => {
  it('shows the figure, a coloured change and links to the list', () => {
    setup(<KpiCard label="Cherry bought today" value="15230.4" unit="kg" change={{ value: '-3', label: 'vs yesterday' }} to="/purchases" sparkline={[1, 2, 3]} />);
    expect(screen.getByText('15,230')).toBeInTheDocument();
    const change = screen.getByTestId('kpi-change');
    expect(change).toHaveTextContent('▼ 3.0 % vs yesterday (down)');
    expect(screen.getByRole('link')).toHaveAttribute('href', '/purchases');
  });

  it('shows a skeleton while loading', () => {
    setup(<KpiCard label="Paid today" value={null} loading />);
    expect(screen.queryByTestId('kpi-change')).not.toBeInTheDocument();
    expect(document.querySelector('.MuiSkeleton-root')).toBeInTheDocument();
  });
});

describe('PageHeader / SectionCard / EmptyState', () => {
  it('render title, breadcrumbs, actions, sections and the next step', () => {
    setup(<>
      <PageHeader title="Voucher PV-0001" breadcrumbs={[{ label: 'Purchases', to: '/purchases' }, { label: 'PV-0001' }]} actions={<button>Print</button>} />
      <SectionCard title="Items"><p>body</p></SectionCard>
      <EmptyState title="No vouchers yet" action={{ label: 'Create voucher', to: '/purchases/new' }} />
    </>);
    expect(screen.getByRole('heading', { level: 1, name: 'Voucher PV-0001' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Purchases' })).toHaveAttribute('href', '/purchases');
    expect(screen.getByText('PV-0001', { selector: '[aria-current="page"]' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Items' })).toHaveTextContent('body');
    expect(screen.getByRole('link', { name: 'Create voucher' })).toHaveAttribute('href', '/purchases/new');
  });
});

describe('JourneyStepper', () => {
  it('marks the current stage and shows details only for stages reached', () => {
    setup(<JourneyStepper orientation="horizontal" current="PULPING" stages={[
      { code: 'PURCHASED', weightKg: '1000.000', date: '2026-10-01' },
      { code: 'PULPING', weightKg: '950.5' },
      { code: 'FERMENTATION', weightKg: '900' },
    ]} />);
    expect(screen.getByText('Pulping').closest('[aria-current="step"]')).toBeInTheDocument();
    expect(screen.getByText('1,000 kg · 01 Oct')).toBeInTheDocument();
    expect(screen.getByText('951 kg')).toBeInTheDocument();
    expect(screen.queryByText('900 kg')).not.toBeInTheDocument();
  });
});

describe('Timeline', () => {
  it('lists events in the given order, or an empty message', () => {
    const { unmount } = setup(<Timeline items={[
      { id: '1', title: 'Approved', at: '2026-10-05T07:00:00Z', by: 'Abebe', tone: 'success' },
      { id: '2', title: 'Created', at: '2026-10-04T07:00:00Z' },
    ]} />);
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Approved');
    expect(items[0]).toHaveTextContent('05 Oct 2026, 10:00 · Abebe'); // station time (UTC+3)
    expect(items[1]).toHaveTextContent('Created');
    unmount();
    setup(<Timeline items={[]} emptyText="No events" />);
    expect(screen.getByText('No events')).toBeInTheDocument();
  });
});

describe('ProgressRing', () => {
  it('clamps the ring to 100 % and keeps the label', () => {
    setup(<ProgressRing value={130} label="52 h" caption="of 24–48 h" tone="error" ariaLabel="Fermentation time" />);
    const ring = screen.getByRole('progressbar', { name: 'Fermentation time' });
    expect(ring).toHaveAttribute('aria-valuenow', '100');
    expect(ring).toHaveAttribute('data-tone', 'error');
    expect(screen.getByText('52 h')).toBeInTheDocument();
  });
});

describe('ApprovalBar', () => {
  it('shows only allowed, permitted actions and collects a reason', async () => {
    const reject = vi.fn().mockResolvedValue(undefined);
    setup(<ApprovalBar hint="Waiting for approval" actions={[
      { key: 'approve', label: 'Approve', allowed: true, permission: 'purchase:approve', primary: true, run: vi.fn() },
      { key: 'reject', label: 'Reject', allowed: true, permission: 'purchase:verify', requiresReason: true, danger: true, run: reject },
      { key: 'pay', label: 'Pay', allowed: false, run: vi.fn() },
    ]} />, { permissions: ['purchase:verify'] });
    const bar = screen.getByRole('toolbar', { name: 'Document actions' });
    expect(within(bar).queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(within(bar).queryByRole('button', { name: 'Pay' })).not.toBeInTheDocument();
    await userEvent.click(within(bar).getByRole('button', { name: 'Reject' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Wrong weight');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(reject).toHaveBeenCalledWith('Wrong weight'));
  });

  it('renders nothing when no action is available', () => {
    setup(<ApprovalBar actions={[{ key: 'a', label: 'Approve', allowed: false, run: vi.fn() }]} />);
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
  });
});

describe('ConfirmDialog', () => {
  it('stays open and shows the error when the action fails', async () => {
    const onClose = vi.fn();
    setup(<ConfirmDialog open title="Disburse payment" onClose={onClose} onConfirm={() => Promise.reject(new Error('Cash box closed'))} />);
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText(/Cash box closed|unexpected/i)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('FieldScreen', () => {
  it('submits from the big button unless disabled', async () => {
    const onSubmit = vi.fn();
    const { rerender } = setup(<FieldScreen title="Record moisture" submitLabel="Save reading" onSubmit={onSubmit}><input aria-label="Moisture" /></FieldScreen>);
    await userEvent.click(screen.getByRole('button', { name: 'Save reading' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    rerender(<MemoryRouter><ColorModeProvider><FieldScreen title="Record moisture" submitLabel="Save reading" submitDisabled onSubmit={onSubmit}><input /></FieldScreen></ColorModeProvider></MemoryRouter>);
    expect(screen.getByRole('button', { name: 'Save reading' })).toBeDisabled();
  });
});

describe('FilterBar', () => {
  it('writes filters to the URL and resets the page', async () => {
    setup(<FilterBar filters={[
      { type: 'search', key: 'search', label: 'Search suppliers' },
      { type: 'select', key: 'status', label: 'Status', options: [{ value: 'ACTIVE', label: 'Active' }] },
    ]} />, { url: '/suppliers?page=3' });
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Status' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Active' }));
    expect(where()).toBe('/suppliers?status=ACTIVE');
    await userEvent.type(screen.getByLabelText('Search suppliers'), 'abebe');
    await waitFor(() => expect(where()).toBe('/suppliers?status=ACTIVE&search=abebe'));
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(where()).toBe('/suppliers');
  });
});

interface Row { id: string; number: string; status: string; totalAmount: string; createdAt: string }
const rows: Row[] = [{ id: 'a', number: 'PV-0001', status: 'APPROVED', totalAmount: '1500', createdAt: '2026-10-05T07:00:00Z' }];
const cols = [
  { field: 'number', headerName: 'Number' },
  columns.status<Row>('status', 'Status', 'voucher'),
  columns.money<Row>('totalAmount', 'Total (ETB)'),
  columns.dateTime<Row>('createdAt', 'Created'),
];

function ServerTable({ data = rows }: { data?: Row[] }) {
  const { table, apiParams } = useTableQuery();
  return <>
    <output data-testid="api">{JSON.stringify(apiParams)}</output>
    <DataTable label="Vouchers" rows={data} columns={cols} server={{ state: table, rowCount: data.length ? 60 : 0, sortFields: ['number', 'createdAt'] }}
      rowTo={(r) => `/purchases/${r.id}`} empty={{ title: 'No vouchers yet' }} />
  </>;
}

describe('DataTable', () => {
  it('maps URL paging/sort to API params and sorts only whitelisted columns', async () => {
    setup(<ServerTable />, { url: '/purchases?page=2&sort=-createdAt' });
    expect(JSON.parse(screen.getByTestId('api').textContent!)).toEqual({ page: 2, pageSize: 25, sort: '-createdAt' });
    expect(await screen.findByText('PV-0001')).toBeInTheDocument();
    expect(screen.getByText('Approved')).toBeInTheDocument();
    expect(screen.getByText('1,500.00')).toBeInTheDocument();

    await userEvent.click(screen.getByText('Number'));
    expect(where()).toBe('/purchases?sort=number'); // new sort → back to page 1
    await userEvent.click(screen.getByText('Total (ETB)')); // not in the API whitelist
    expect(where()).toBe('/purchases?sort=number');
  });

  it('opens the record page on row click and shows the empty state', async () => {
    const { unmount } = setup(<ServerTable />, { url: '/purchases' });
    await userEvent.click(await screen.findByText('PV-0001'));
    expect(where()).toBe('/purchases/a');
    unmount();
    setup(<ServerTable data={[]} />, { url: '/purchases' });
    expect(await screen.findByText('No vouchers yet')).toBeInTheDocument();
  });
});

describe('every component renders in each colour mode', () => {
  it.each(COLOR_MODES)('%s', (mode) => {
    localStorage.setItem('cws.colorMode', mode);
    try {
      act(() => {
        setup(<>
          <PageHeader title="All" badge={<StatusChip status="PAID" domain="voucher" />} />
          <KpiCard label="Kg" value="10" sparkline={[1, 2]} change={{ value: '5' }} />
          <SectionCard title="S"><MoneyText value="1" /><WeightText value="2" /><PercentText value="3" /></SectionCard>
          <JourneyStepper stages={[{ code: 'PURCHASED' }, { code: 'HOPPER' }]} current="HOPPER" blocked />
          <Timeline items={[{ id: '1', title: 'Event', at: '2026-10-05T07:00:00Z', tone: 'warning' }]} />
          <ProgressRing value={50} label="24 h" tone="neutral" />
          <EmptyState title="Empty" />
          <ApprovalBar actions={[{ key: 'x', label: 'Submit', allowed: true, run: vi.fn() }]} />
          <DataTable label="T" rows={rows} columns={cols} />
          <ModeName />
        </>);
      });
      expect(screen.getByRole('heading', { name: 'All' })).toBeInTheDocument();
      expect(screen.getByTestId('mode')).toHaveTextContent(mode);
    } finally {
      localStorage.removeItem('cws.colorMode');
    }
  });
});
