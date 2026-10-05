import { Box, Button, Chip, MenuItem, Stack, Tab, Tabs, TextField, Typography } from '@mui/material';
import type { GridColDef } from '@mui/x-data-grid';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import { cashApi, idempotencyKey, paymentsApi, type CashTransaction, type Payment, type PaymentCommand, type PaymentStatus } from '../../api/procurement';
import { Can } from '../../auth/Can';
import { useAuth } from '../../auth/useAuth';
import {
  columns as col, ConfirmDialog, DataTable, ErrorAlert, KpiCard, MoneyText, ReasonDialog, SectionCard, useTableQuery,
} from '../../components';
import { ListTemplate } from '../../templates';
import { isDecimal } from '../../utils/decimal';
import { humanize } from '../../utils/format';

const QUEUES: { value: PaymentStatus | 'ALL'; label: string }[] = [
  { value: 'PENDING_APPROVAL', label: 'To approve' }, { value: 'APPROVED', label: 'To pay out' }, { value: 'PAID', label: 'Paid' }, { value: 'ALL', label: 'All' },
];

type Command = { cmd: PaymentCommand; label: string; permission: string; from: PaymentStatus; reason: boolean; color: 'primary' | 'error' };
const COMMANDS: Command[] = [
  { cmd: 'approve', label: 'Approve', permission: 'payment:approve', from: 'PENDING_APPROVAL', reason: false, color: 'primary' },
  { cmd: 'reject', label: 'Reject', permission: 'payment:approve', from: 'PENDING_APPROVAL', reason: true, color: 'error' },
  { cmd: 'disburse', label: 'Pay out', permission: 'payment:disburse', from: 'APPROVED', reason: false, color: 'primary' },
  { cmd: 'reverse', label: 'Reverse', permission: 'payment:reverse', from: 'PAID', reason: true, color: 'error' },
];

function useQueueCount(status: PaymentStatus) {
  return useQuery({ queryKey: ['payments', 'count', status], queryFn: () => paymentsApi.list({ page: 1, pageSize: 1, status }), select: (r) => r.meta.total });
}

/** Payment queue grouped by status (spec §7); the queue is in the URL (`?status=APPROVED`). */
function PaymentsQueue() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const { table, apiParams } = useTableQuery();
  const status = (QUEUES.find((x) => x.value === params.get('status'))?.value ?? 'PENDING_APPROVAL');
  const [confirm, setConfirm] = useState<{ p: Payment; c: Command } | null>(null);
  const counts = { PENDING_APPROVAL: useQueueCount('PENDING_APPROVAL').data, APPROVED: useQueueCount('APPROVED').data };
  const q = useQuery({
    queryKey: ['payments', apiParams, status],
    queryFn: () => paymentsApi.list({ ...apiParams, status: status === 'ALL' ? undefined : status }),
    placeholderData: keepPreviousData,
  });
  const run = useMutation({
    mutationFn: ({ p, c, reason }: { p: Payment; c: Command; reason?: string }) => paymentsApi.command(p.id, c.cmd, idempotencyKey(), reason),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['payments'] }); qc.invalidateQueries({ queryKey: ['purchases'] }); qc.invalidateQueries({ queryKey: ['cash'] }); },
  });
  const setQueue = (v: string) => setParams((prev) => {
    const next = new URLSearchParams(prev);
    for (const k of ['status', 'page', 'sort']) next.delete(k);
    if (v !== 'PENDING_APPROVAL') next.set('status', v);
    return next;
  }, { replace: true });

  const columns: GridColDef<Payment>[] = [
    { field: 'paymentNo', headerName: 'Payment', minWidth: 150 },
    {
      field: 'voucherNo', headerName: 'Voucher', minWidth: 150,
      renderCell: (p) => <Button size="small" component={RouterLink} to={`/purchases/${p.row.voucherId}`} onClick={(e) => e.stopPropagation()}>{p.row.voucherNo}</Button>,
    },
    { field: 'supplierName', headerName: 'Supplier', flex: 1, minWidth: 180 },
    col.money<Payment>('amount', 'Amount (ETB)'),
    { field: 'method', headerName: 'Method', minWidth: 150, valueGetter: (_v, p) => `${humanize(p.method)}${p.referenceNo ? ` · ${p.referenceNo}` : ''}` },
    { field: 'cashierName', headerName: 'Cashier', minWidth: 140 },
    col.status<Payment>('status', 'Status', 'payment', { minWidth: 150 }),
    { field: 'reason', headerName: 'Reason', minWidth: 180, sortable: false, valueGetter: (_v, p) => p.rejectReason ?? p.reversalReason ?? '' },
    col.dateTime<Payment>('paidAt', 'Paid'),
    {
      field: 'actions', headerName: '', sortable: false, disableExport: true, minWidth: 200, align: 'right',
      renderCell: (p) => (
        <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end', width: '100%' }}>
          {COMMANDS.filter((c) => c.from === p.row.status && can(c.permission)).map((c) => (
            <Button key={c.cmd} size="small" variant={c.reason ? 'outlined' : 'contained'} color={c.color} disabled={run.isPending}
              onClick={(e) => { e.stopPropagation(); if (c.reason || c.cmd === 'disburse') setConfirm({ p: p.row, c }); else run.mutate({ p: p.row, c }); }}>
              {c.label}
            </Button>
          ))}
        </Stack>
      ),
    },
  ];

  return (
    <>
      <Tabs value={status} onChange={(_, v: string) => setQueue(v)} variant="scrollable" sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }} aria-label="Payment queues">
        {QUEUES.map((x) => {
          const n = x.value === 'PENDING_APPROVAL' || x.value === 'APPROVED' ? counts[x.value] : undefined;
          return <Tab key={x.value} value={x.value} label={<Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><span>{x.label}</span>{n ? <Chip size="small" label={n} color="warning" sx={{ height: 20 }} /> : null}</Stack>} />;
        })}
      </Tabs>
      <ErrorAlert error={q.error ?? run.error} />
      <DataTable label="Supplier payments" loading={q.isFetching} rows={q.data?.data ?? []} columns={columns}
        server={{ state: table, rowCount: q.data?.meta.total ?? 0, sortFields: ['paymentDate', 'amount'] }}
        empty={{ title: 'Nothing in this queue' }} />
      {confirm?.c.reason && (
        <ReasonDialog open title={`${confirm.c.label} ${confirm.p.paymentNo}`} confirmLabel={confirm.c.label} danger onClose={() => setConfirm(null)}
          message={confirm.c.cmd === 'reverse' ? 'A reversal entry is posted to the cash ledger and the voucher returns to APPROVED.' : undefined}
          onConfirm={(reason) => run.mutateAsync({ ...confirm, reason })} />
      )}
      {confirm && !confirm.c.reason && (
        <ConfirmDialog open title={`Pay out ${confirm.p.paymentNo}`} confirmLabel="Confirm payment" onClose={() => setConfirm(null)}
          onConfirm={() => run.mutateAsync(confirm)}
          message={(
            <Stack spacing={1}>
              <Typography>Hand over to <strong>{confirm.p.supplierName}</strong> ({humanize(confirm.p.method)}{confirm.p.referenceNo ? ` · ${confirm.p.referenceNo}` : ''}):</Typography>
              <Typography variant="kpi" component="p" color="text.primary"><MoneyText value={confirm.p.amount} /></Typography>
              <Typography variant="body2" color="text.secondary">This posts the cash ledger entry, marks voucher {confirm.p.voucherNo} PAID and creates the lot.</Typography>
            </Stack>
          )} />
      )}
    </>
  );
}

function CashTab() {
  const qc = useQueryClient();
  const { table, apiParams } = useTableQuery();
  const [form, setForm] = useState({ type: 'CASH_FUNDING' as 'CASH_FUNDING' | 'CASH_RETURN', amount: '', description: '' });
  const summary = useQuery({ queryKey: ['cash', 'summary'], queryFn: cashApi.summary });
  const list = useQuery({ queryKey: ['cash', apiParams], queryFn: () => cashApi.list(apiParams), placeholderData: keepPreviousData });
  const record = useMutation({
    mutationFn: () => cashApi.record(form, idempotencyKey()),
    onSuccess: () => { setForm({ ...form, amount: '', description: '' }); qc.invalidateQueries({ queryKey: ['cash'] }); },
  });
  const columns: GridColDef<CashTransaction>[] = [
    { field: 'txnNumber', headerName: 'Entry', minWidth: 140 },
    col.dateTime<CashTransaction>('txnDate', 'When'),
    { field: 'type', headerName: 'Type', minWidth: 150, valueFormatter: (v: string) => humanize(v) },
    { field: 'description', headerName: 'Description', flex: 1, minWidth: 200 },
    col.money<CashTransaction>('in', 'In (ETB)', { valueGetter: (_v, t) => (t.direction === 'IN' ? t.amount : null), sortable: false }),
    col.money<CashTransaction>('out', 'Out (ETB)', { valueGetter: (_v, t) => (t.direction === 'OUT' ? t.amount : null), sortable: false }),
    { field: 'cashierName', headerName: 'Cashier', minWidth: 140 },
  ];
  return (
    <Stack spacing={3}>
      <ErrorAlert error={summary.error ?? list.error ?? record.error} />
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(3, 1fr)' } }}>
        <Box sx={{ gridColumn: { xs: '1 / -1', md: 'auto' } }}><KpiCard label="Cash on hand" value={summary.data?.balance} unit="ETB" dp={2} loading={summary.isLoading} /></Box>
        <KpiCard label="In today" value={summary.data?.inToday} unit="ETB" dp={2} loading={summary.isLoading} />
        <KpiCard label="Out today" value={summary.data?.outToday} unit="ETB" dp={2} loading={summary.isLoading} />
      </Box>
      <Can permission="cash:record">
        <SectionCard title="Record cash funding or return">
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
            <TextField size="small" select label="Entry" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as typeof form.type })} sx={{ minWidth: 160 }}>
              <MenuItem value="CASH_FUNDING">Funding (in)</MenuItem><MenuItem value="CASH_RETURN">Return (out)</MenuItem>
            </TextField>
            <TextField size="small" label="Amount (ETB)" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} error={!!form.amount && !isDecimal(form.amount, 2)}
              slotProps={{ htmlInput: { inputMode: 'decimal' } }} />
            <TextField size="small" label="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} sx={{ flexGrow: 1 }} />
            <Button variant="contained" disabled={!isDecimal(form.amount, 2) || form.description.trim().length < 3 || record.isPending} onClick={() => record.mutate()}>Record</Button>
          </Stack>
        </SectionCard>
      </Can>
      <DataTable label="Cash ledger" loading={list.isFetching} rows={list.data?.data ?? []} columns={columns}
        server={{ state: table, rowCount: list.data?.meta.total ?? 0, sortFields: ['txnDate'] }} empty={{ title: 'No cash entries yet' }} />
    </Stack>
  );
}

/** Supplier payment queue (approve → pay out → reverse) and the cash ledger. */
export function PaymentsPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'cash' && can('cash:read') ? 'cash' : 'payments';
  return (
    <ListTemplate title="Payments" subtitle="One payment per approved voucher: prepare → approve → pay out.">
      {can('cash:read') && (
        <Tabs value={view} onChange={(_, v: string) => setParams(v === 'cash' ? { view: 'cash' } : {})} sx={{ mb: 2 }} aria-label="Payments or cash">
          <Tab value="payments" label="Supplier payments" /><Tab value="cash" label="Cash ledger" />
        </Tabs>
      )}
      {view === 'payments' ? <PaymentsQueue /> : <CashTab />}
    </ListTemplate>
  );
}
