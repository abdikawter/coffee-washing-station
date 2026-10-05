import { Box, Table, TableBody, TableCell, TableHead, TableRow, ToggleButton, ToggleButtonGroup, useTheme } from '@mui/material';
import { BarChart } from '@mui/x-charts/BarChart';
import { LineChart } from '@mui/x-charts/LineChart';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { lotsApi, processingApi } from '../api/processing';
import { paymentsApi, purchasesApi, qualityApi, scalesApi, type PurchaseSummary } from '../api/procurement';
import { useAuth } from '../auth/useAuth';
import { KpiCard, MoneyText, SectionCard, StatusChip, WeightText } from '../components';
import { DashboardTemplate, PanelList, type PanelItem } from '../templates';
import { formatNumber, percentChange } from '../utils/decimal';
import { formatDateTime, humanize, STATION_TIMEZONE } from '../utils/format';

/** "05 Oct" for a business date (YYYY-MM-DD); the raw value if it is not a valid date. */
const dayLabel = (d: string) => {
  const date = new Date(`${d}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? d : new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' }).format(date);
};

/**
 * Last 14 days: kg bought per day and the average price per kg as two separate
 * single-series charts (never one chart with two y-axes), with a table view.
 */
function PurchaseTrend({ daily }: { daily: PurchaseSummary['daily'] }) {
  const theme = useTheme();
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const days = daily.map((d) => dayLabel(d.date));
  // Chart libraries plot numbers; these are display-only conversions of the API's decimal strings.
  const kg = daily.map((d) => Number(d.kg));
  const price = daily.map((d) => (d.avgPricePerKg === null ? null : Number(d.avgPricePerKg)));
  const grid = { horizontal: true };
  const toggle = (
    <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, v: 'chart' | 'table' | null) => v && setView(v)} aria-label="View">
      <ToggleButton value="chart">Chart</ToggleButton>
      <ToggleButton value="table">Table</ToggleButton>
    </ToggleButtonGroup>
  );
  return (
    <SectionCard title="Cherry bought, last 14 days" subtitle="Cancelled and voided vouchers are not counted." actions={toggle}>
      {view === 'table' ? (
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small" aria-label="Cherry bought per day">
            <TableHead><TableRow><TableCell>Day</TableCell><TableCell align="right">Cherry (kg)</TableCell><TableCell align="right">Amount (ETB)</TableCell><TableCell align="right">Avg price (ETB/kg)</TableCell></TableRow></TableHead>
            <TableBody>
              {[...daily].reverse().map((d) => (
                <TableRow key={d.date}>
                  <TableCell>{dayLabel(d.date)}</TableCell>
                  <TableCell align="right"><WeightText value={d.kg} dp={0} hideUnit /></TableCell>
                  <TableCell align="right"><MoneyText value={d.amount} hideUnit /></TableCell>
                  <TableCell align="right">{d.avgPricePerKg ? <MoneyText value={d.avgPricePerKg} hideUnit /> : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      ) : (
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '3fr 2fr' } }}>
          <BarChart
            height={240}
            xAxis={[{ scaleType: 'band', data: days, tickLabelInterval: (_v, i) => i % 2 === daily.length % 2 }]}
            yAxis={[{ label: 'kg', width: 56 }]}
            series={[{ data: kg, label: 'Cherry (kg)', color: theme.vars?.palette.primary.main, valueFormatter: (v) => (v === null ? '—' : `${formatNumber(String(v), 0)} kg`) }]}
            borderRadius={4}
            grid={grid}
            hideLegend
            margin={{ left: 0, right: 8, top: 16, bottom: 0 }}
          />
          <LineChart
            height={240}
            xAxis={[{ scaleType: 'point', data: days, tickLabelInterval: (_v, i) => i % 3 === 0 }]}
            yAxis={[{ label: 'ETB / kg', width: 56 }]}
            series={[{ data: price, label: 'Average price (ETB/kg)', color: theme.vars?.palette.secondary.main, connectNulls: false, showMark: true, valueFormatter: (v) => (v === null ? 'No purchases' : `${formatNumber(String(v), 2)} ETB/kg`) }]}
            grid={grid}
            hideLegend
            margin={{ left: 0, right: 8, top: 16, bottom: 0 }}
          />
        </Box>
      )}
    </SectionCard>
  );
}

function useVouchers(status: string, enabled: boolean) {
  return useQuery({ queryKey: ['dashboard', 'purchases', status], enabled, refetchInterval: 60_000, queryFn: () => purchasesApi.list({ page: 1, pageSize: 5, status }) });
}
function usePayments(status: string, enabled: boolean) {
  return useQuery({ queryKey: ['dashboard', 'payments', status], enabled, refetchInterval: 60_000, queryFn: () => paymentsApi.list({ page: 1, pageSize: 5, status }) });
}

/** Documents waiting for the user's own next step, per their permissions. */
function useWaiting() {
  const { can } = useAuth();
  const toVerify = useVouchers('PENDING_VERIFICATION', can('purchase:verify'));
  const toApprove = useVouchers('VERIFIED', can('purchase:approve'));
  const payToApprove = usePayments('PENDING_APPROVAL', can('payment:approve'));
  const toPay = usePayments('APPROVED', can('payment:disburse'));
  const items: PanelItem[] = [
    ...(toVerify.data?.data ?? []).map((v) => ({ id: `v${v.id}`, primary: `Verify ${v.voucherNo}`, secondary: `${v.supplierName} · ${formatNumber(v.totalWeightKg, 0)} kg`, badge: <StatusChip status={v.status} domain="voucher" />, to: `/purchases/${v.id}` })),
    ...(toApprove.data?.data ?? []).map((v) => ({ id: `a${v.id}`, primary: `Approve ${v.voucherNo}`, secondary: `${v.supplierName} · ${formatNumber(v.totalAmount)} ETB`, badge: <StatusChip status={v.status} domain="voucher" />, to: `/purchases/${v.id}` })),
    ...(payToApprove.data?.data ?? []).map((p) => ({ id: `p${p.id}`, primary: `Approve payment ${p.paymentNo}`, secondary: `${p.supplierName} · ${formatNumber(p.amount)} ETB`, badge: <StatusChip status={p.status} domain="payment" />, to: `/purchases/${p.voucherId}` })),
    ...(toPay.data?.data ?? []).map((p) => ({ id: `d${p.id}`, primary: `Pay out ${p.paymentNo}`, secondary: `${p.supplierName} · ${formatNumber(p.amount)} ETB`, badge: <StatusChip status={p.status} domain="payment" />, to: `/payments?status=APPROVED` })),
  ];
  const any = can(['purchase:verify', 'purchase:approve', 'payment:approve', 'payment:disburse']);
  return { items, any, loading: [toVerify, toApprove, payToApprove, toPay].some((q) => q.isLoading && q.fetchStatus !== 'idle') };
}

/** Things that need attention: unverified scales, tanks near / over max time, reconciliation differences. */
function useAlerts() {
  const { can } = useAuth();
  const scales = useQuery({ queryKey: ['scales'], queryFn: scalesApi.list, enabled: can('scale:read'), refetchInterval: 120_000 });
  const tanks = useQuery({
    queryKey: ['dashboard', 'fermentation'], enabled: can('fermentation:read'), refetchInterval: 60_000,
    queryFn: () => processingApi.batches({ page: 1, pageSize: 50, status: 'IN_PROGRESS' }),
  });
  const recon = useQuery({
    queryKey: ['dashboard', 'reconciliation'], enabled: can('reconciliation:read'), refetchInterval: 300_000,
    queryFn: () => processingApi.reconciliations({ page: 1, pageSize: 5, status: 'DISCREPANCY' }),
  });
  const items: PanelItem[] = [
    ...(scales.data ?? []).filter((s) => !s.verification.verified).map((s) => ({
      id: `s${s.id}`, primary: `Scale ${s.code} not verified`, secondary: humanize(s.verification.reason ?? 'NEVER_VERIFIED'),
      badge: <StatusChip status="FAIL" domain="checkResult" label="Not verified" />, to: '/scales',
    })),
    ...(tanks.data?.data ?? []).filter((b) => b.timing.state === 'APPROACHING_MAX' || b.timing.state === 'OVERDUE').map((b) => ({
      id: `f${b.id}`, primary: `Tank ${b.tankCode} · ${b.lotNumber}`, secondary: `${formatNumber(b.timing.elapsedHours, 1)} h of max ${formatNumber(b.maxDurationHours, 0)} h · max at ${formatDateTime(b.timing.maxEndAt)}`,
      badge: <StatusChip status={b.timing.state} domain="fermentationTiming" />, to: '/processing?tab=fermentation',
    })),
    ...(recon.data?.data ?? []).map((r) => ({
      id: `r${r.id}`, primary: `Hopper reconciliation ${dayLabel(r.reconDate)}`, secondary: `Difference ${formatNumber(r.differenceKg, 0)} kg (${formatNumber(r.differencePct, 1)} %)`,
      badge: <StatusChip status={r.status} domain="reconciliation" />, to: '/processing?tab=reconciliation',
    })),
  ];
  const any = can(['scale:read', 'fermentation:read', 'reconciliation:read']);
  return { items, any, loading: [scales, tanks, recon].some((q) => q.isLoading && q.fetchStatus !== 'idle') };
}

/** Dashboard (spec §7): today's figures, the 14-day trend, what is waiting for the user and alerts. */
export function DashboardPage() {
  const { user, can } = useAuth();
  const summary = useQuery({ queryKey: ['purchases', 'summary'], queryFn: purchasesApi.summary, enabled: can('purchase:read'), refetchInterval: 60_000 });
  const board = useQuery({ queryKey: ['lots', 'board'], queryFn: lotsApi.board, enabled: can('lot:read'), refetchInterval: 60_000 });
  const holds = useQuery({ queryKey: ['dashboard', 'holds'], queryFn: () => qualityApi.holds({ page: 1, pageSize: 1, status: 'ACTIVE' }), enabled: can('quality:hold-read'), refetchInterval: 120_000 });
  const waiting = useWaiting();
  const alerts = useAlerts();
  const s = summary.data;
  const today = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: STATION_TIMEZONE }).format(new Date());

  const kpis = [
    can('purchase:read') && (
      <KpiCard key="kg" label="Cherry bought today" value={s?.todayKg} unit="kg" loading={summary.isLoading} to="/purchases"
        change={s && percentChange(s.todayKg, s.yesterdayKg) !== null ? { value: percentChange(s.todayKg, s.yesterdayKg)!, label: 'vs yesterday' } : undefined}
        hint={s && `${s.todayVouchers} voucher${s.todayVouchers === 1 ? '' : 's'}`} sparkline={s?.daily.map((d) => Number(d.kg))} />
    ),
    can('purchase:read') && (
      <KpiCard key="paid" label="Paid today" value={s?.paidTodayAmount} unit="ETB" dp={2} loading={summary.isLoading} to="/payments?status=PAID"
        hint={s && `${s.paidTodayCount} payment${s.paidTodayCount === 1 ? '' : 's'}`} />
    ),
    can('purchase:read') && (
      <KpiCard key="approve" label="Vouchers awaiting approval" value={s ? s.pendingVerification + s.verified : null} loading={summary.isLoading} to="/purchases?status=VERIFIED"
        hint={s && `${s.pendingVerification} to verify · ${s.verified} to approve`} />
    ),
    can('lot:read') && (
      <KpiCard key="ferm" label="Lots in fermentation" value={board.data?.find((c) => c.stage === 'FERMENTATION')?.lots.length ?? (board.data ? 0 : null)}
        loading={board.isLoading} to="/processing?tab=fermentation" />
    ),
    can('quality:hold-read') && (
      <KpiCard key="holds" label="Open quality holds" value={holds.data?.meta.total} loading={holds.isLoading} to="/quality" hint="Blocked lots" />
    ),
  ].filter(Boolean);

  return (
    <DashboardTemplate
      title={`Welcome, ${user?.fullName.split(' ')[0] ?? ''}`}
      subtitle={today}
      kpis={kpis}
      charts={s ? [<PurchaseTrend key="trend" daily={s.daily} />] : undefined}
      waiting={waiting.any ? <PanelList loading={waiting.loading} emptyText="Nothing is waiting for you" items={waiting.items} /> : undefined}
      alerts={alerts.any ? <PanelList loading={alerts.loading} emptyText="No alerts" items={alerts.items} /> : undefined}
    />
  );
}
