import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Link, MenuItem, Stack, TextField, Typography } from '@mui/material';
import type { GridColDef } from '@mui/x-data-grid';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { idempotencyKey, PAYMENT_METHODS, paymentsApi, purchasesApi, type Voucher, type VoucherCommand } from '../../api/procurement';
import {
  columns as col, DataTable, ErrorAlert, Field, JourneyStepper, MoneyText, SectionCard, StatusChip, WeightText, type ApprovalAction, type TimelineItem,
} from '../../components';
import { DetailTemplate } from '../../templates';
import { formatDateTime, humanize } from '../../utils/format';

interface Action { cmd: VoucherCommand; label: string; permission: string; reason: boolean; color?: 'primary' | 'error' | 'warning' | 'success' }

const ACTIONS: Record<string, Action[]> = {
  DRAFT: [
    { cmd: 'submit', label: 'Submit for verification', permission: 'purchase:submit', reason: false },
    { cmd: 'cancel', label: 'Cancel', permission: 'purchase:cancel', reason: true, color: 'error' },
  ],
  PENDING_VERIFICATION: [
    { cmd: 'verify', label: 'Verify', permission: 'purchase:verify', reason: false, color: 'success' },
    { cmd: 'return', label: 'Return to draft', permission: 'purchase:return', reason: true, color: 'warning' },
    { cmd: 'cancel', label: 'Cancel', permission: 'purchase:cancel', reason: true, color: 'error' },
  ],
  VERIFIED: [
    { cmd: 'approve', label: 'Approve', permission: 'purchase:approve', reason: false, color: 'success' },
    { cmd: 'return', label: 'Return to draft', permission: 'purchase:return', reason: true, color: 'warning' },
    { cmd: 'cancel', label: 'Cancel', permission: 'purchase:cancel', reason: true, color: 'error' },
  ],
  APPROVED: [{ cmd: 'void', label: 'Void', permission: 'purchase:void', reason: true, color: 'error' }],
};

function PaymentDialog({ voucher, onClose }: { voucher: Voucher; onClose: () => void }) {
  const qc = useQueryClient();
  const [method, setMethod] = useState('CASH');
  const [ref, setRef] = useState('');
  const [key] = useState(idempotencyKey);
  const m = useMutation({
    mutationFn: () => paymentsApi.create({ voucherId: voucher.id, method, referenceNo: ref.trim() || null }, key),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['purchases'] }); qc.invalidateQueries({ queryKey: ['payments'] }); onClose(); },
  });
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Prepare payment</DialogTitle>
      <DialogContent>
        <ErrorAlert error={m.error} />
        <Typography sx={{ mb: 2 }}>{voucher.supplierNameSnap} · {voucher.voucherNo}</Typography>
        <Typography variant="kpi" component="p"><MoneyText value={voucher.totalAmount} /></Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>The full voucher total.</Typography>
        <Stack spacing={2}>
          <TextField select label="Method" value={method} onChange={(e) => setMethod(e.target.value)}>
            {PAYMENT_METHODS.map((p) => <MenuItem key={p} value={p}>{humanize(p)}</MenuItem>)}
          </TextField>
          {method !== 'CASH' && <TextField label="Reference number" value={ref} onChange={(e) => setRef(e.target.value)} required />}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={m.isPending || (method !== 'CASH' && !ref.trim())} onClick={() => m.mutate()}>Create payment</Button>
      </DialogActions>
    </Dialog>
  );
}

const FLOW = ['DRAFT', 'PENDING_VERIFICATION', 'VERIFIED', 'APPROVED', 'PAID'] as const;

/**
 * Voucher detail (spec §7): status flow Draft → Verified → Approved → Paid, key
 * figures, weighings and payments; workflow commands in the ApprovalBar, shown per
 * status and permission (the API re-checks every command).
 */
export function VoucherDetailPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const [paying, setPaying] = useState(false);
  const q = useQuery({ queryKey: ['purchases', id], queryFn: () => purchasesApi.get(id) });
  const run = useMutation({
    mutationFn: ({ a, reason }: { a: Action; reason?: string }) => purchasesApi.command(id, a.cmd, q.data!.version, reason),
    onSuccess: (v) => { qc.setQueryData(['purchases', id], v); qc.invalidateQueries({ queryKey: ['purchases'] }); },
  });
  const pdf = useMutation({
    mutationFn: () => purchasesApi.pdf(id),
    onSuccess: (blob) => window.open(URL.createObjectURL(blob), '_blank', 'noopener'),
  });

  const v = q.data;
  const livePayment = v?.payments.find((p) => ['PENDING_APPROVAL', 'APPROVED', 'PAID'].includes(p.status));
  const paid = v?.payments.find((p) => p.status === 'PAID');
  const closed = v?.status === 'CANCELLED' || v?.status === 'VOIDED';

  const approvalActions: ApprovalAction[] = v ? [
    ...(ACTIONS[v.status] ?? []).map((a, i) => ({
      key: a.cmd, label: a.label, permission: a.permission, allowed: true, requiresReason: a.reason, danger: a.color === 'error', primary: i === 0 && !a.reason,
      run: (reason?: string) => run.mutateAsync({ a, reason }),
    })),
    {
      key: 'pay', label: 'Prepare payment', permission: 'payment:create', allowed: v.status === 'APPROVED' && !livePayment, primary: true,
      run: async () => setPaying(true),
    },
  ] : [];

  type Line = { id: string; line: string; scale: string; weighedAt: string; grossKg: string; tareKg: string; netKg: string; verified: boolean };
  const weighings: Line[] = v ? v.items.flatMap((it) => it.weighings.map((w) => ({
    id: w.id, line: `#${it.lineNo}`, scale: w.scaleCode, weighedAt: w.weighedAt, grossKg: w.grossKg, tareKg: w.tareKg, netKg: w.netKg, verified: w.scaleVerified,
  }))) : [];
  const weighingCols: GridColDef<Line>[] = [
    { field: 'line', headerName: 'Line', minWidth: 70 },
    {
      field: 'scale', headerName: 'Scale', minWidth: 170,
      renderCell: (p) => <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><span>{p.row.scale}</span>{!p.row.verified && <StatusChip status="WARN" domain="inspection" label="Unverified scale" />}</Stack>,
    },
    col.dateTime<Line>('weighedAt', 'Weighed'),
    col.weight<Line>('grossKg', 'Gross (kg)'),
    col.weight<Line>('tareKg', 'Tare (kg)'),
    col.weight<Line>('netKg', 'Net (kg)'),
  ];
  type Pay = Voucher['payments'][number];
  const paymentCols: GridColDef<Pay>[] = [
    { field: 'paymentNo', headerName: 'Payment', minWidth: 150 },
    col.money<Pay>('amount', 'Amount (ETB)'),
    { field: 'method', headerName: 'Method', minWidth: 130, valueFormatter: (m: string) => humanize(m) },
    col.status<Pay>('status', 'Status', 'payment'),
    col.dateTime<Pay>('paidAt', 'Paid'),
  ];

  const timeline: TimelineItem[] = v ? [
    ...(paid?.paidAt ? [{ id: 'paid', title: `Paid · ${paid.paymentNo}`, at: paid.paidAt, by: v.cashierName, tone: 'success' as const }] : []),
    ...(v.approvedAt ? [{ id: 'approved', title: 'Approved', at: v.approvedAt, by: v.approvedByName, tone: 'success' as const }] : []),
    ...(v.verifiedAt ? [{ id: 'verified', title: 'Verified', at: v.verifiedAt, by: v.verifiedByName, tone: 'info' as const }] : []),
    ...v.items.flatMap((it) => it.weighings).slice(0, 1).map((w) => ({ id: 'weighed', title: 'Weighed and drafted', at: w.weighedAt, by: v.weighingClerkName, tone: 'neutral' as const })),
  ] : [];

  return (
    <>
      <DetailTemplate
        title={v ? `Voucher ${v.voucherNo}` : 'Voucher'}
        subtitle={v && `${v.supplierNameSnap} (${v.supplierCode}) · ${v.voucherDate}`}
        breadcrumbs={[{ label: 'Purchasing', to: '/purchases' }, { label: v?.voucherNo ?? '…' }]}
        status={v && <StatusChip status={v.status} domain="voucher" />}
        loading={q.isLoading}
        error={q.error}
        actions={<Button variant="outlined" startIcon={<PictureAsPdfIcon />} disabled={pdf.isPending} onClick={() => pdf.mutate()}>PDF</Button>}
        figures={v ? [
          { label: 'Total net weight', value: <WeightText value={v.totalWeightKg} /> },
          { label: 'Price per kg', value: <MoneyText value={v.pricePerKg} /> },
          { label: 'Total amount', value: <MoneyText value={v.totalAmount} /> },
          { label: 'Lot', value: v.lot ? <Link component={RouterLink} to={`/lots/${v.lot.id}`}>{v.lot.lotNumber}</Link> : 'Created at payment' },
        ] : []}
        tabs={v ? [
          {
            key: 'overview', label: 'Overview',
            content: (
              <Stack spacing={3}>
                <ErrorAlert error={run.error ?? pdf.error} />
                {v.scaleWarning && <Alert severity="warning">Scale warning: {v.scaleWarning}</Alert>}
                {v.cancelReason && <Alert severity="info">{humanize(v.status)}: {v.cancelReason}</Alert>}
                {!closed && (
                  <SectionCard title="Status">
                    <JourneyStepper label="Voucher status" current={v.status} stages={FLOW.map((code) => ({
                      code,
                      note: code === 'DRAFT' ? v.createdByName : code === 'VERIFIED' ? v.verifiedByName : code === 'APPROVED' ? v.approvedByName : code === 'PAID' ? v.cashierName : null,
                      date: code === 'VERIFIED' ? v.verifiedAt : code === 'APPROVED' ? v.approvedAt : code === 'PAID' ? paid?.paidAt : null,
                    }))} />
                  </SectionCard>
                )}
                <SectionCard title="Details">
                  <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(3, 1fr)' }, gap: 2 }}>
                    <Field label="Coffee">{v.coffeeTypeName}{v.gradeCode ? ` · ${v.gradeCode}` : ''}</Field>
                    <Field label="Inspection">{v.inspectionNo} · {v.qualityInspectorName}</Field>
                    <Field label="Weighing clerk">{v.weighingClerkName}</Field>
                    <Field label="Created by">{v.createdByName}</Field>
                    <Field label="Verified">{v.verifiedByName ? `${v.verifiedByName} · ${formatDateTime(v.verifiedAt)}` : null}</Field>
                    <Field label="Approved">{v.approvedByName ? `${v.approvedByName} · ${formatDateTime(v.approvedAt)}` : null}</Field>
                    <Field label="Paid by">{v.cashierName}</Field>
                    <Field label="Lot status">{v.lot ? `${humanize(v.lot.currentStage)} · ${humanize(v.lot.status)}` : null}</Field>
                  </Box>
                </SectionCard>
                {v.items.length > 1 && (
                  <SectionCard title="Lines">
                    <Stack spacing={1}>
                      {v.items.map((it) => (
                        <Typography key={it.id} variant="body2">
                          Line {it.lineNo}: {it.coffeeTypeName} · <WeightText value={it.weightKg} /> × <MoneyText value={it.pricePerKg} />/kg = <MoneyText value={it.amount} />
                        </Typography>
                      ))}
                    </Stack>
                  </SectionCard>
                )}
              </Stack>
            ),
          },
          { key: 'weighings', label: 'Weighings', count: weighings.length, content: <DataTable label="Weighings" rows={weighings} columns={weighingCols} /> },
          {
            key: 'payments', label: 'Payments', count: v.payments.length,
            content: <DataTable label="Payments" rows={v.payments} columns={paymentCols} rowTo={() => '/payments'} empty={{ title: 'No payment yet', message: 'A payment is prepared after approval.' }} />,
          },
        ] : []}
        timeline={v ? timeline : undefined}
        approval={v ? { hint: `Status: ${humanize(v.status)}`, actions: approvalActions } : undefined}
      />
      {paying && v && <PaymentDialog voucher={v} onClose={() => { setPaying(false); qc.invalidateQueries({ queryKey: ['purchases', id] }); }} />}
    </>
  );
}
