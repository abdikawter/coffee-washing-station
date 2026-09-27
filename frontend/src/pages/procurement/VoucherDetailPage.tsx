import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import {
  Alert, Box, Button, Card, CardContent, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useState } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import { idempotencyKey, PAYMENT_METHODS, paymentsApi, purchasesApi, type Voucher, type VoucherCommand } from '../../api/procurement';
import { useAuth } from '../../auth/useAuth';
import { ErrorAlert, Field, Loading, PageHeader, StatusChip } from '../../components/common';
import { ReasonDialog } from '../../components/ReasonDialog';
import { formatNumber } from '../../utils/decimal';
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
        <Typography sx={{ mb: 2 }}>{voucher.supplierNameSnap} · {voucher.voucherNo}<br /><b>{formatNumber(voucher.totalAmount)}</b> (the full voucher total)</Typography>
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

/** Voucher detail with the approval bar (commands shown per status and permission; SoD enforced by the API). */
export function VoucherDetailPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { can } = useAuth();
  const [pending, setPending] = useState<Action | null>(null);
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

  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorAlert error={q.error} />;
  const v = q.data;
  const actions = (ACTIONS[v.status] ?? []).filter((a) => can(a.permission));
  const livePayment = v.payments.find((p) => ['PENDING_APPROVAL', 'APPROVED', 'PAID'].includes(p.status));

  return (
    <>
      <PageHeader title={`Voucher ${v.voucherNo}`} subtitle={`${v.supplierNameSnap} (${v.supplierCode}) · ${v.voucherDate}`}
        actions={<>
          <Button onClick={() => navigate('/purchases')}>Back</Button>
          <Button variant="outlined" startIcon={<PictureAsPdfIcon />} disabled={pdf.isPending} onClick={() => pdf.mutate()}>PDF</Button>
        </>} />
      <ErrorAlert error={run.error ?? pdf.error} />
      {v.scaleWarning && <Alert severity="warning" sx={{ mb: 2 }}>Scale warning: {v.scaleWarning}</Alert>}
      {v.cancelReason && <Alert severity="info" sx={{ mb: 2 }}>{humanize(v.status)}: {v.cancelReason}</Alert>}

      <Card variant="outlined" sx={{ mb: 2 }}>
        <CardContent>
          <Stack direction="row" spacing={2} sx={{ alignItems: 'center', mb: 2 }}>
            <StatusChip status={v.status} label={humanize(v.status)} />
            <Box sx={{ flexGrow: 1 }} />
            {actions.map((a) => (
              <Button key={a.cmd} variant={a.reason ? 'outlined' : 'contained'} color={a.color ?? 'primary'} disabled={run.isPending}
                onClick={() => (a.reason ? setPending(a) : run.mutate({ a }))}>{a.label}</Button>
            ))}
            {v.status === 'APPROVED' && !livePayment && can('payment:create') && <Button variant="contained" onClick={() => setPaying(true)}>Prepare payment</Button>}
          </Stack>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' }, gap: 2 }}>
            <Field label="Total weight">{formatNumber(v.totalWeightKg, 3)} kg</Field>
            <Field label="Price per kg">{formatNumber(v.pricePerKg)}</Field>
            <Field label="Total amount"><b>{formatNumber(v.totalAmount)}</b></Field>
            <Field label="Coffee">{v.coffeeTypeName}{v.gradeCode ? ` · ${v.gradeCode}` : ''}</Field>
            <Field label="Inspection">{v.inspectionNo} · {v.qualityInspectorName}</Field>
            <Field label="Weighing clerk">{v.weighingClerkName}</Field>
            <Field label="Created by">{v.createdByName}</Field>
            <Field label="Verified">{v.verifiedByName ? `${v.verifiedByName} · ${formatDateTime(v.verifiedAt)}` : null}</Field>
            <Field label="Approved">{v.approvedByName ? `${v.approvedByName} · ${formatDateTime(v.approvedAt)}` : null}</Field>
            <Field label="Paid by">{v.cashierName}</Field>
            <Field label="Lot">{v.lot ? `${v.lot.lotNumber} · ${humanize(v.lot.status)}` : 'Created at payment'}</Field>
          </Box>
        </CardContent>
      </Card>

      <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>Weighings</Typography>
      <Card variant="outlined" sx={{ mb: 2 }}>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow><TableCell>Line / scale</TableCell><TableCell>Weighed</TableCell><TableCell align="right">Gross</TableCell><TableCell align="right">Tare</TableCell><TableCell align="right">Net (kg)</TableCell><TableCell align="right">Amount</TableCell></TableRow>
            </TableHead>
            <TableBody>
              {v.items.map((it) => (
                <Fragment key={it.id}>
                  {it.weighings.map((w) => (
                    <TableRow key={w.id}>
                      <TableCell>#{it.lineNo} · {w.scaleCode}{!w.scaleVerified && <StatusChip status="WARN" label="unverified scale" />}</TableCell>
                      <TableCell>{formatDateTime(w.weighedAt)}</TableCell>
                      <TableCell align="right">{w.grossKg}</TableCell><TableCell align="right">{w.tareKg}</TableCell><TableCell align="right">{w.netKg}</TableCell><TableCell />
                    </TableRow>
                  ))}
                  <TableRow sx={{ '& td': { fontWeight: 600 } }}>
                    <TableCell colSpan={4}>Line {it.lineNo}: {it.coffeeTypeName} × {formatNumber(it.pricePerKg)}/kg</TableCell>
                    <TableCell align="right">{formatNumber(it.weightKg, 3)}</TableCell><TableCell align="right">{formatNumber(it.amount)}</TableCell>
                  </TableRow>
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      {v.payments.length > 0 && (
        <>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>Payments</Typography>
          <Stack spacing={1}>
            {v.payments.map((p) => (
              <Stack key={p.id} direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                <Typography>{p.paymentNo}</Typography><Typography>{formatNumber(p.amount)} · {humanize(p.method)}</Typography>
                <StatusChip status={p.status} label={humanize(p.status)} />
                <Button size="small" component={RouterLink} to="/payments">Open payments</Button>
              </Stack>
            ))}
          </Stack>
        </>
      )}

      {pending && (
        <ReasonDialog open title={`${pending.label}: ${v.voucherNo}`} confirmLabel={pending.label} danger={pending.color === 'error'} onClose={() => setPending(null)}
          onConfirm={(reason) => run.mutateAsync({ a: pending, reason })} />
      )}
      {paying && <PaymentDialog voucher={v} onClose={() => { setPaying(false); qc.invalidateQueries({ queryKey: ['purchases', id] }); }} />}
    </>
  );
}
