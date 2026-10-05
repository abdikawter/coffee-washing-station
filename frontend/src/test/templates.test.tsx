import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { KpiCard, SectionCard, StatusChip } from '../components';
import { DashboardTemplate, DetailTemplate, FormTemplate, ListTemplate, PanelList } from '../templates';
import { setup, where } from './render';

describe('ListTemplate', () => {
  it('shows "New …" only with permission, plus filters and the table', () => {
    const page = (permissions: string[]) => setup(
      <ListTemplate title="Suppliers" create={{ label: 'New supplier', to: '/suppliers/new', permission: 'supplier:create' }}
        filters={[{ type: 'search', key: 'search', label: 'Search suppliers' }]}>
        <table aria-label="Suppliers table" />
      </ListTemplate>, { permissions });
    const { unmount } = page([]);
    expect(screen.queryByRole('link', { name: 'New supplier' })).not.toBeInTheDocument();
    expect(screen.getByRole('search')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Suppliers table' })).toBeInTheDocument();
    unmount();
    page(['supplier:create']);
    expect(screen.getByRole('link', { name: 'New supplier' })).toHaveAttribute('href', '/suppliers/new');
  });

  it('opens a quick-view drawer with a link to the full page', async () => {
    const onClose = vi.fn();
    setup(<ListTemplate title="Suppliers" quickView={{ open: true, title: 'SUP-001 · Abebe', to: '/suppliers/1', onClose, children: <p>Kebele 03</p> }}>
      <div /></ListTemplate>);
    const drawer = screen.getByRole('dialog', { name: 'SUP-001 · Abebe' });
    expect(within(drawer).getByText('Kebele 03')).toBeInTheDocument();
    expect(within(drawer).getByRole('link', { name: 'Open full page' })).toHaveAttribute('href', '/suppliers/1');
    await userEvent.click(within(drawer).getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('DetailTemplate', () => {
  const page = (url = '/purchases/1') => setup(
    <DetailTemplate title="PV-0001" status={<StatusChip status="VERIFIED" domain="voucher" />}
      breadcrumbs={[{ label: 'Purchases', to: '/purchases' }, { label: 'PV-0001' }]}
      figures={[{ label: 'Supplier', value: 'Abebe' }, { label: 'Net weight', value: '1,200 kg' }]}
      tabs={[
        { key: 'overview', label: 'Overview', content: <p>overview body</p> },
        { key: 'items', label: 'Items', count: 3, content: <p>items body</p> },
      ]}
      timeline={[{ id: 'e1', title: 'Verified', at: '2026-10-05T07:00:00Z' }]}
      approval={{ actions: [{ key: 'approve', label: 'Approve', allowed: true, primary: true, run: vi.fn() }] }}
    />, { url });

  it('shows the summary card, first tab, history and the approval bar', () => {
    page();
    expect(screen.getByRole('heading', { level: 1, name: 'PV-0001' })).toBeInTheDocument();
    expect(screen.getByText('Verified', { selector: '.MuiChip-label' })).toBeInTheDocument();
    expect(screen.getByText('Net weight').nextSibling).toHaveTextContent('1,200 kg');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('overview body');
    expect(screen.getByRole('region', { name: 'History' })).toHaveTextContent('Verified');
    expect(screen.getByRole('toolbar', { name: 'Document actions' })).toBeInTheDocument();
  });

  it('keeps the open tab in the URL', async () => {
    page();
    await userEvent.click(screen.getByRole('tab', { name: /Items/ }));
    expect(where()).toBe('/purchases/1?tab=items');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('items body');
  });

  it('opens the tab named in the URL and shows loading', () => {
    const { unmount } = page('/purchases/1?tab=items');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('items body');
    unmount();
    setup(<DetailTemplate title="PV-0001" tabs={[]} loading />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  });
});

describe('FormTemplate', () => {
  it('submits from the sticky bar', async () => {
    const onSubmit = vi.fn();
    setup(<FormTemplate title="New supplier" onSubmit={onSubmit} submitLabel="Create supplier"><SectionCard title="Identity"><input aria-label="Name" /></SectionCard></FormTemplate>);
    expect(screen.getByRole('region', { name: 'Identity' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Create supplier' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('asks before discarding unsaved changes and warns on tab close', async () => {
    setup(<FormTemplate title="New supplier" onSubmit={vi.fn()} dirty cancelTo="/suppliers"><div /></FormTemplate>, { url: '/suppliers/new' });
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    const dialog = await screen.findByRole('dialog', { name: 'Discard changes?' });
    expect(where()).toBe('/suppliers/new');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(where()).toBe('/suppliers'));
  });

  it('leaves straight away when nothing changed', async () => {
    setup(<FormTemplate title="New supplier" onSubmit={vi.fn()} cancelTo="/suppliers"><div /></FormTemplate>, { url: '/suppliers/new' });
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(where()).toBe('/suppliers');
  });

  it('runs a wizard: Next validates, the last step submits', async () => {
    const onSubmit = vi.fn();
    let valid = false;
    setup(<FormTemplate title="New voucher" onSubmit={onSubmit} submitLabel="Submit voucher" steps={[
      { label: 'Supplier', content: <p>step one</p>, validate: () => valid },
      { label: 'Weighing', content: <p>step two</p> },
    ]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('step one')).toBeInTheDocument(); // blocked by validation
    valid = true;
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('step two')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('step one')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await userEvent.click(screen.getByRole('button', { name: 'Submit voucher' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

describe('DashboardTemplate', () => {
  it('lays out KPIs, charts and the two action panels', () => {
    setup(<DashboardTemplate title="Dashboard"
      kpis={[<KpiCard key="a" label="Cherry bought today" value="1200" unit="kg" />, <KpiCard key="b" label="Open holds" value={2} />]}
      charts={[<SectionCard key="c" title="Cherry per day"><div /></SectionCard>]}
      waiting={<PanelList emptyText="Nothing waiting" items={[{ id: 'v1', primary: 'PV-0001', secondary: 'Abebe · 1,200 kg', to: '/purchases/v1', badge: <StatusChip status="VERIFIED" domain="voucher" /> }]} />}
      alerts={<PanelList emptyText="No alerts" items={[]} />}
    />);
    expect(screen.getByRole('region', { name: 'Key figures' })).toHaveTextContent('Cherry bought today');
    expect(screen.getByRole('region', { name: 'Cherry per day' })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Waiting for you' })).getByRole('link')).toHaveAttribute('href', '/purchases/v1');
    expect(screen.getByRole('region', { name: 'Alerts' })).toHaveTextContent('No alerts');
  });
});
