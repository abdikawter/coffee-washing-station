import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { lotsApi, processingApi, type LotEvent } from '../api/processing';
import { paymentsApi, purchasesApi, qualityApi, scalesApi, type PurchaseSummary, type QualityRule, type Scale } from '../api/procurement';
import { JsonDiff } from '../pages/admin/AuditLogPage';
import { DashboardPage } from '../pages/DashboardPage';
import { journeyFromEvents } from '../pages/processing/LotDetailPage';
import { InspectionFormPage, triggeredRules } from '../pages/procurement/InspectionFormPage';
import { PaymentsPage } from '../pages/procurement/PaymentsPage';
import { scaleCheck } from '../pages/procurement/ScalesPage';
import { setup, where } from './render';

const page = <T,>(data: T[]) => ({ data, meta: { page: 1, pageSize: 5, total: data.length } });

beforeEach(() => vi.restoreAllMocks());

describe('dashboard (spec §7)', () => {
  const summary: PurchaseSummary = {
    date: '2026-10-05', todayVouchers: 3, todayKg: '1200.000', todayAmount: '54000.00', yesterdayKg: '1000.000', yesterdayAmount: '45000.00',
    paidTodayAmount: '18000.50', paidTodayCount: 2, draft: 1, pendingVerification: 2, verified: 1, approved: 0,
    daily: Array.from({ length: 14 }, (_, i) => ({ date: `2026-09-${String(17 + i).padStart(2, '0')}`, kg: '100.000', amount: '4500.00', avgPricePerKg: '45.00' })),
  };

  it('shows today vs yesterday, paid today, waiting documents and alerts per permission', async () => {
    vi.spyOn(purchasesApi, 'summary').mockResolvedValue(summary);
    vi.spyOn(purchasesApi, 'list').mockResolvedValue(page([{ id: 'v1', voucherNo: 'PV-0009', supplierName: 'Almaz', totalWeightKg: '400.000', totalAmount: '18000.00', status: 'VERIFIED' }]) as never);
    vi.spyOn(paymentsApi, 'list').mockResolvedValue(page([]) as never);
    vi.spyOn(lotsApi, 'board').mockResolvedValue([{ stage: 'FERMENTATION', lots: [{}, {}] }] as never);
    vi.spyOn(qualityApi, 'holds').mockResolvedValue({ data: [], meta: { page: 1, pageSize: 1, total: 4 } });
    vi.spyOn(scalesApi, 'list').mockResolvedValue([{ id: 's1', code: 'SC-01', verification: { verified: false, reason: 'EXPIRED', validUntil: null } }] as never);
    vi.spyOn(processingApi, 'batches').mockResolvedValue(page([{ id: 'b1', tankCode: 'T-2', lotNumber: 'LOT-1', maxDurationHours: '48', timing: { state: 'OVERDUE', elapsedHours: '50.5', maxEndAt: '2026-10-05T05:00:00Z' } }]) as never);
    vi.spyOn(processingApi, 'reconciliations').mockResolvedValue(page([]) as never);

    setup(<DashboardPage />, { permissions: ['purchase:read', 'purchase:approve', 'lot:read', 'quality:hold-read', 'scale:read', 'fermentation:read', 'reconciliation:read'] });

    const kpis = await screen.findByRole('region', { name: 'Key figures' });
    await waitFor(() => expect(within(kpis).getByText('1,200')).toBeInTheDocument());
    expect(within(kpis).getByTestId('kpi-change')).toHaveTextContent('▲ 20.0 % vs yesterday (up)');
    expect(within(kpis).getByText('18,000.50')).toBeInTheDocument();
    expect(await within(kpis).findByText('4')).toBeInTheDocument(); // open holds

    const waiting = screen.getByRole('region', { name: 'Waiting for you' });
    expect(await within(waiting).findByRole('link', { name: /Approve PV-0009/ })).toHaveAttribute('href', '/purchases/v1');
    expect(purchasesApi.list).toHaveBeenCalledWith({ page: 1, pageSize: 5, status: 'VERIFIED' });
    expect(purchasesApi.list).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'PENDING_VERIFICATION' })); // no purchase:verify

    const alerts = screen.getByRole('region', { name: 'Alerts' });
    expect(await within(alerts).findByText('Scale SC-01 not verified')).toBeInTheDocument();
    expect(within(alerts).getByText('Tank T-2 · LOT-1')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Table' }));
    expect(screen.getByRole('table', { name: 'Cherry bought per day' })).toBeInTheDocument();
  });
});

describe('quality inspection form (spec §7)', () => {
  const rules: QualityRule[] = [
    { id: 'r1', name: 'Too green', metric: 'GREEN_UNRIPE_PCT', operator: 'GT', threshold: '20', action: 'REJECT', isActive: true, description: null },
    { id: 'r2', name: 'Low red', metric: 'RED_RIPE_PCT', operator: 'LT', threshold: '80', action: 'WARN', isActive: true, description: null },
    { id: 'r3', name: 'Off', metric: 'RED_RIPE_PCT', operator: 'LT', threshold: '99', action: 'REJECT', isActive: false, description: null },
  ];

  it('evaluates active rules exactly', () => {
    const v = (red: string, green: string) => ({ RED_RIPE_PCT: red, GREEN_UNRIPE_PCT: green, OVERRIPE_DAMAGED_PCT: '0' });
    expect(triggeredRules(rules, v('85', '15')).map((r) => r.id)).toEqual([]);
    expect(triggeredRules(rules, v('79.99', '20')).map((r) => r.id)).toEqual(['r2']); // 20 is not > 20
    expect(triggeredRules(rules, v('70', '20.01')).map((r) => r.id)).toEqual(['r1', 'r2']);
  });

  it('shows the live sum, the composition bar and rule warnings while typing', async () => {
    vi.spyOn(qualityApi, 'grades').mockResolvedValue([]);
    vi.spyOn(qualityApi, 'rules').mockResolvedValue(rules);
    setup(<InspectionFormPage />, { permissions: ['quality:inspect', 'quality:rules-read'] });
    await userEvent.type(screen.getByLabelText('Red ripe %'), '70');
    await userEvent.type(screen.getByLabelText('Green / unripe %'), '25');
    await userEvent.type(screen.getByLabelText('Overripe / damaged %'), '4');
    expect(screen.getByText(/Sum 99\.00 % — must be 100 %/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Red ripe 70.0 %, Green / unripe 25.0 %, Overripe / damaged 4.0 %' })).toBeInTheDocument();
    expect(await screen.findByText(/break a REJECT rule/)).toBeInTheDocument();
    expect(screen.getByText(/Too green/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Overripe / damaged %'), '{backspace}5');
    expect(screen.getByText('Sum 100.00 % ✓')).toBeInTheDocument();
  });
});

describe('audit log diff (spec §7)', () => {
  it('lists every key side by side and marks the changed ones', () => {
    setup(<JsonDiff before={{ value: 0.5, source: 'PROVISIONAL', key: 'x' }} after={{ value: 1, source: 'CONFIRMED', key: 'x' }} />);
    const rows = within(screen.getByRole('table', { name: 'Changes' })).getAllByRole('row').slice(1);
    expect(rows.map((r) => r.querySelector('td')!.textContent)).toEqual(['key', 'source (changed)', 'value (changed)']);
    expect(rows[0]).not.toHaveAttribute('data-changed');
    expect(rows[2]).toHaveTextContent('0.51');
  });
});

describe('lot journey and scale board', () => {
  it('takes the weight and first date per stage from the lot events', () => {
    const ev = (stage: LotEvent['stage'], occurredAt: string, quantityKg: string | null) => ({ id: occurredAt, lotId: 'l', lotNumber: 'L', sequence: 1, eventType: 'X', stage, occurredAt, quantityKg, location: null, payload: null, userName: 'u' });
    const j = journeyFromEvents([ev('PURCHASED', '2026-10-01T08:00:00Z', '1000'), ev('HOPPER', '2026-10-02T08:00:00Z', '990'), ev('HOPPER', '2026-10-02T09:00:00Z', '985'), ev('HOPPER', '2026-10-02T10:00:00Z', null)]);
    expect(j.find((s) => s.code === 'PURCHASED')).toMatchObject({ weightKg: '1000', date: '2026-10-01T08:00:00Z' });
    expect(j.find((s) => s.code === 'HOPPER')).toMatchObject({ weightKg: '985', date: '2026-10-02T08:00:00Z' });
    expect(j.find((s) => s.code === 'PULPING')).toMatchObject({ weightKg: null, date: null });
  });

  it('classifies scales as verified, due or out of service', () => {
    const s = (status: string, verified: boolean, reason?: string) => ({ status, verification: { verified, reason, validUntil: null } }) as unknown as Scale;
    expect(scaleCheck(s('OPERATIONAL', true))).toBe('VERIFIED');
    expect(scaleCheck(s('OPERATIONAL', false, 'EXPIRED'))).toBe('DUE');
    expect(scaleCheck(s('OUT_OF_SERVICE', false, 'OUT_OF_SERVICE'))).toBe('OUT_OF_SERVICE');
  });
});

describe('payments queue (spec §7)', () => {
  it('keeps the queue in the URL and confirms pay-out with the amount shown large', async () => {
    const payment = { id: 'p1', paymentNo: 'PAY-0003', voucherId: 'v1', voucherNo: 'PV-0003', supplierCode: 'F-1', supplierName: 'Almaz', lotNumber: null, amount: '18000.50', method: 'CASH', referenceNo: null, status: 'APPROVED', cashierName: 'C', approvedByName: 'A', paidAt: null, rejectReason: null, reversalReason: null, createdAt: '2026-10-05T07:00:00Z' };
    vi.spyOn(paymentsApi, 'list').mockImplementation(async (q) => page(q.status === 'APPROVED' ? [payment] : []) as never);
    const command = vi.spyOn(paymentsApi, 'command').mockResolvedValue({ ...payment, status: 'PAID' } as never);
    setup(<PaymentsPage />, { permissions: ['payment:read', 'payment:disburse'], url: '/payments' });
    await userEvent.click(screen.getByRole('tab', { name: /To pay out/ }));
    expect(where()).toBe('/payments?status=APPROVED');
    await userEvent.click(await screen.findByRole('button', { name: 'Pay out' }));
    const dialog = await screen.findByRole('dialog', { name: 'Pay out PAY-0003' });
    expect(within(dialog).getByText('18,000.50')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm payment' }));
    await waitFor(() => expect(command).toHaveBeenCalledWith('p1', 'disburse', expect.any(String), undefined));
  });
});
