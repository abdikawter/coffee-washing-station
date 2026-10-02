import {
  Box, Button, Card, CardContent, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Paper, Stack, Tab, Table, TableBody, TableCell,
  TableContainer, TableHead, TablePagination, TableRow, Tabs, TextField, Typography,
} from '@mui/material';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { cashApi, idempotencyKey, paymentsApi, type Payment, type PaymentCommand, type PaymentStatus } from '../../api/procurement';
import { Can } from '../../auth/Can';
import { useAuth } from '../../auth/useAuth';
import { ErrorAlert, Field, Loading, PageHeader, StatusChip } from '../../components/common';
import { ReasonDialog } from '../../components/ReasonDialog';
import { formatNumber, isDecimal } from '../../utils/decimal';
import { formatDateTime, humanize } from '../../utils/format';

const QUEUES: { value: PaymentStatus | ''; label: string }[] = [
  { value: 'PENDING_APPROVAL', label: 'To approve' }, { value: 'APPROVED', label: 'To pay out' }, { value: 'PAID', label: 'Paid' },
  { value: '', label: 'All' },
];

const COMMANDS: { cmd: PaymentCommand; label: string; permission: string; from: PaymentStatus; reason: boolean; color: 'success' | 'error' | 'primary' }[] = [
  { cmd: 'approve', label: 'Approve', permission: 'payment:approve', from: 'PENDING_APPROVAL', reason: false, color: 'success' },
  { cmd: 'reject', label: 'Reject', permission: 'payment:approve', from: 'PENDING_APPROVAL', reason: true, color: 'error' },
  { cmd: 'disburse', label: 'Pay out', permission: 'payment:disburse', from: 'APPROVED', reason: false, color: 'primary' },
  { cmd: 'reverse', label: 'Reverse', permission: 'payment:reverse', from: 'PAID', reason: true, color: 'error' },
];

function PaymentsQueue() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const [status, setStatus] = useState<PaymentStatus | ''>('PENDING_APPROVAL');
  const [page, setPage] = useState(0);
  const [confirm, setConfirm] = useState<{ p: Payment; c: (typeof COMMANDS)[number] } | null>(null);
  const q = useQuery({
    queryKey: ['payments', { status, page }],
    queryFn: () => paymentsApi.list({ page: page + 1, pageSize: 25, status: status || undefined }),
    placeholderData: keepPreviousData,
  });
  const run = useMutation({
    mutationFn: ({ p, c, reason }: { p: Payment; c: (typeof COMMANDS)[number]; reason?: string }) => paymentsApi.command(p.id, c.cmd, idempotencyKey(), reason),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['payments'] }); qc.invalidateQueries({ queryKey: ['purchases'] }); qc.invalidateQueries({ queryKey: ['cash'] }); },
  });
  return (
    <>
      <Tabs value={status} onChange={(_, v) => { setStatus(v); setPage(0); }} sx={{ mb: 2 }}>
        {QUEUES.map((x) => <Tab key={x.label} value={x.value} label={x.label} />)}
      </Tabs>
      <ErrorAlert error={q.error ?? run.error} />
      <Paper variant="outlined">
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow><TableCell>Payment</TableCell><TableCell>Voucher</TableCell><TableCell>Supplier</TableCell><TableCell align="right">Amount</TableCell><TableCell>Method</TableCell><TableCell>Cashier</TableCell><TableCell>Status</TableCell><TableCell /></TableRow>
            </TableHead>
            <TableBody>
              {q.isLoading && <TableRow><TableCell colSpan={8}><Loading /></TableCell></TableRow>}
              {q.data?.data.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>{p.paymentNo}<Typography variant="caption" component="div" color="text.secondary">{formatDateTime(p.paidAt ?? p.createdAt)}</Typography></TableCell>
                  <TableCell><Button size="small" component={RouterLink} to={`/purchases/${p.voucherId}`}>{p.voucherNo}</Button></TableCell>
                  <TableCell>{p.supplierName}</TableCell>
                  <TableCell align="right">{formatNumber(p.amount)}</TableCell>
                  <TableCell>{humanize(p.method)}{p.referenceNo ? ` · ${p.referenceNo}` : ''}</TableCell>
                  <TableCell>{p.cashierName}</TableCell>
                  <TableCell><StatusChip status={p.status} label={humanize(p.status)} />{(p.rejectReason ?? p.reversalReason) && <Typography variant="caption" component="div">{p.rejectReason ?? p.reversalReason}</Typography>}</TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                      {COMMANDS.filter((c) => c.from === p.status && can(c.permission)).map((c) => (
                        <Button key={c.cmd} size="small" variant={c.reason ? 'outlined' : 'contained'} color={c.color} disabled={run.isPending}
                          onClick={() => (c.reason || c.cmd === 'disburse' ? setConfirm({ p, c }) : run.mutate({ p, c }))}>{c.label}</Button>
                      ))}
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
              {q.data?.data.length === 0 && <TableRow><TableCell colSpan={8}><Typography color="text.secondary" sx={{ p: 2 }}>Nothing in this queue.</Typography></TableCell></TableRow>}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination component="div" count={q.data?.meta.total ?? 0} page={page} rowsPerPage={25} rowsPerPageOptions={[25]} onPageChange={(_, p) => setPage(p)} />
      </Paper>
      {confirm?.c.reason && (
        <ReasonDialog open title={`${confirm.c.label} ${confirm.p.paymentNo}`} confirmLabel={confirm.c.label} danger onClose={() => setConfirm(null)}
          message={confirm.c.cmd === 'reverse' ? 'A reversal entry is posted to the cash ledger and the voucher returns to APPROVED.' : undefined}
          onConfirm={(reason) => run.mutateAsync({ ...confirm, reason })} />
      )}
      {confirm && !confirm.c.reason && (
        <Dialog open onClose={() => setConfirm(null)} fullWidth maxWidth="xs">
          <DialogTitle>Pay out {confirm.p.paymentNo}</DialogTitle>
          <DialogContent>
            <Typography>Hand <b>{formatNumber(confirm.p.amount)}</b> to {confirm.p.supplierName} ({humanize(confirm.p.method)}) and confirm.</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>This posts the cash ledger entry, marks the voucher PAID and creates the lot.</Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setConfirm(null)}>Cancel</Button>
            <Button variant="contained" onClick={() => { run.mutate(confirm); setConfirm(null); }}>Confirm payment</Button>
          </DialogActions>
        </Dialog>
      )}
    </>
  );
}

function CashTab() {
  const qc = useQueryClient();
  const [page, setPage] = useState(0);
  const [form, setForm] = useState({ type: 'CASH_FUNDING' as 'CASH_FUNDING' | 'CASH_RETURN', amount: '', description: '' });
  const summary = useQuery({ queryKey: ['cash', 'summary'], queryFn: cashApi.summary });
  const list = useQuery({ queryKey: ['cash', page], queryFn: () => cashApi.list({ page: page + 1, pageSize: 25 }), placeholderData: keepPreviousData });
  const record = useMutation({
    mutationFn: () => cashApi.record(form, idempotencyKey()),
    onSuccess: () => { setForm({ ...form, amount: '', description: '' }); qc.invalidateQueries({ queryKey: ['cash'] }); },
  });
  return (
    <>
      <ErrorAlert error={summary.error ?? list.error ?? record.error} />
      <Card variant="outlined" sx={{ mb: 2 }}>
        <CardContent>
          <Stack direction="row" spacing={4}>
            <Field label="Cash on hand"><Typography variant="h5">{formatNumber(summary.data?.balance)}</Typography></Field>
            <Field label="In today">{formatNumber(summary.data?.inToday)}</Field>
            <Field label="Out today">{formatNumber(summary.data?.outToday)}</Field>
          </Stack>
        </CardContent>
      </Card>
      <Can permission="cash:record">
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} sx={{ mb: 2 }}>
          <TextField size="small" select label="Entry" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as typeof form.type })} sx={{ minWidth: 160 }}>
            <MenuItem value="CASH_FUNDING">Funding (in)</MenuItem><MenuItem value="CASH_RETURN">Return (out)</MenuItem>
          </TextField>
          <TextField size="small" label="Amount" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} error={!!form.amount && !isDecimal(form.amount, 2)} />
          <TextField size="small" label="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} sx={{ flexGrow: 1 }} />
          <Button variant="contained" disabled={!isDecimal(form.amount, 2) || form.description.trim().length < 3 || record.isPending} onClick={() => record.mutate()}>Record</Button>
        </Stack>
      </Can>
      <Paper variant="outlined">
        <TableContainer>
          <Table size="small">
            <TableHead><TableRow><TableCell>Entry</TableCell><TableCell>When</TableCell><TableCell>Type</TableCell><TableCell>Description</TableCell><TableCell align="right">In</TableCell><TableCell align="right">Out</TableCell><TableCell>Cashier</TableCell></TableRow></TableHead>
            <TableBody>
              {list.data?.data.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>{t.txnNumber}</TableCell><TableCell>{formatDateTime(t.txnDate)}</TableCell><TableCell>{humanize(t.type)}</TableCell>
                  <TableCell>{t.description}</TableCell>
                  <TableCell align="right">{t.direction === 'IN' ? formatNumber(t.amount) : ''}</TableCell>
                  <TableCell align="right">{t.direction === 'OUT' ? formatNumber(t.amount) : ''}</TableCell>
                  <TableCell>{t.cashierName}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination component="div" count={list.data?.meta.total ?? 0} page={page} rowsPerPage={25} rowsPerPageOptions={[25]} onPageChange={(_, p) => setPage(p)} />
      </Paper>
    </>
  );
}

/** Supplier payment queue (approve → pay out → reverse) and the cash ledger. */
export function PaymentsPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState<'payments' | 'cash'>('payments');
  return (
    <>
      <PageHeader title="Payments" subtitle="One payment per approved voucher: prepare → approve → pay out." />
      {can('cash:read') && (
        <Box sx={{ mb: 2 }}>
          <Tabs value={tab} onChange={(_, v) => setTab(v)}><Tab value="payments" label="Supplier payments" /><Tab value="cash" label="Cash ledger" /></Tabs>
        </Box>
      )}
      {tab === 'payments' ? <PaymentsQueue /> : <CashTab />}
    </>
  );
}
