import UploadFileIcon from '@mui/icons-material/UploadFile';
import { Box, Button, Stack, TextField, Typography, useTheme } from '@mui/material';
import { LineChart } from '@mui/x-charts/LineChart';
import type { GridColDef } from '@mui/x-data-grid';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { filesApi, suppliersApi, type SupplierHistory, type SupplierStatus } from '../../api/procurement';
import { Can } from '../../auth/Can';
import { columns as col, DataTable, ErrorAlert, Field, KpiCard, ReasonDialog, SectionCard, StatusChip } from '../../components';
import { DetailTemplate } from '../../templates';
import { formatNumber } from '../../utils/decimal';
import { formatDateTime, humanize } from '../../utils/format';
import { SupplierFormDialog } from './SuppliersPage';

type Voucher = SupplierHistory['vouchers'][number];
type Payment = SupplierHistory['payments'][number];
type Inspection = SupplierHistory['inspections'][number];

/** Mean of the inspections' red-ripe percentages, 1 dp — an on-screen summary, not a stored business value. */
function averagePct(values: string[]): string | null {
  if (!values.length) return null;
  return (values.reduce((n, v) => n + Number(v), 0) / values.length).toFixed(1);
}

/** Red-ripe % per inspection, oldest first — single series. */
function QualityChart({ inspections }: { inspections: Inspection[] }) {
  const theme = useTheme();
  const rows = [...inspections].sort((a, b) => a.inspectedAt.localeCompare(b.inspectedAt));
  if (rows.length < 2) return <Typography variant="body2" color="text.secondary">The chart appears after two inspections.</Typography>;
  return (
    <LineChart
      height={220}
      xAxis={[{ scaleType: 'point', data: rows.map((r) => r.inspectionNo), tickLabelInterval: (_v, i) => i % Math.ceil(rows.length / 6) === 0 }]}
      yAxis={[{ min: 0, max: 100, label: 'Red ripe %', width: 56 }]}
      series={[{ data: rows.map((r) => Number(r.redRipePct)), label: 'Red ripe %', color: theme.vars?.palette.success.main, showMark: true, valueFormatter: (v) => (v === null ? '—' : `${formatNumber(String(v), 1)} %`) }]}
      grid={{ horizontal: true }}
      hideLegend
      margin={{ left: 0, right: 8, top: 16, bottom: 0 }}
    />
  );
}

function Documents({ supplierId }: { supplierId: string }) {
  const qc = useQueryClient();
  const [docType, setDocType] = useState('ID card');
  const docs = useQuery({ queryKey: ['suppliers', supplierId, 'documents'], queryFn: () => suppliersApi.documents(supplierId) });
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const d = await filesApi.upload(file, 'SUPPLIER_ID');
      await suppliersApi.addDocument(supplierId, d.id, docType);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['suppliers', supplierId, 'documents'] }),
  });
  type Doc = NonNullable<typeof docs.data>[number];
  const columns: GridColDef<Doc>[] = [
    { field: 'docType', headerName: 'Type', minWidth: 140 },
    { field: 'originalName', headerName: 'File', flex: 1, minWidth: 200 },
    col.dateTime<Doc>('createdAt', 'Added'),
  ];
  return (
    <Stack spacing={2}>
      <ErrorAlert error={docs.error ?? upload.error} />
      <Can permission="supplier:update">
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' } }}>
          <TextField size="small" label="Document type" value={docType} onChange={(e) => setDocType(e.target.value)} />
          <Button component="label" variant="outlined" startIcon={<UploadFileIcon />} disabled={upload.isPending || docType.trim().length < 2}>
            Upload (PDF / image)
            <input hidden type="file" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={(e) => { const file = e.target.files?.[0]; if (file) upload.mutate(file); e.target.value = ''; }} />
          </Button>
        </Stack>
      </Can>
      <DataTable label="Documents" loading={docs.isLoading} rows={docs.data ?? []} columns={columns} empty={{ title: 'No documents yet' }} />
    </Stack>
  );
}

/** Supplier profile (spec §7): header with code, QR and status; totals; quality chart; purchases, payments, inspections, documents. */
export function SupplierProfilePage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const theme = useTheme();
  const [editing, setEditing] = useState(false);
  const [statusTo, setStatusTo] = useState<SupplierStatus | null>(null);
  const q = useQuery({ queryKey: ['suppliers', id], queryFn: () => suppliersApi.get(id) });
  const history = useQuery({ queryKey: ['suppliers', id, 'history'], queryFn: () => suppliersApi.history(id) });
  const s = q.data;
  const h = history.data;

  const voucherCols: GridColDef<Voucher>[] = [
    { field: 'voucherNo', headerName: 'Voucher', minWidth: 150 },
    { field: 'voucherDate', headerName: 'Date', minWidth: 120 },
    col.weight<Voucher>('totalWeightKg', 'Cherry (kg)'),
    col.money<Voucher>('totalAmount', 'Amount (ETB)'),
    col.status<Voucher>('status', 'Status', 'voucher'),
  ];
  const paymentCols: GridColDef<Payment>[] = [
    { field: 'paymentNo', headerName: 'Payment', minWidth: 150 },
    { field: 'voucherNo', headerName: 'Voucher', minWidth: 150 },
    col.money<Payment>('amount', 'Amount (ETB)'),
    col.status<Payment>('status', 'Status', 'payment'),
    col.dateTime<Payment>('paidAt', 'Paid'),
  ];
  const inspectionCols: GridColDef<Inspection>[] = [
    { field: 'inspectionNo', headerName: 'Inspection', minWidth: 150 },
    col.dateTime<Inspection>('inspectedAt', 'When'),
    col.percent<Inspection>('redRipePct', 'Red ripe (%)'),
    col.status<Inspection>('decision', 'Decision', 'inspection'),
  ];

  return (
    <>
    <DetailTemplate
      title={s?.fullName ?? 'Supplier'}
      subtitle={s && [s.supplierCode, s.village, s.phone].filter(Boolean).join(' · ')}
      breadcrumbs={[{ label: 'Suppliers', to: '/suppliers' }, { label: s?.supplierCode ?? '…' }]}
      status={s && <StatusChip status={s.status} domain="supplier" />}
      loading={q.isLoading}
      error={q.error}
      actions={s && <>
        <Can permission="supplier:status">
          {(['ACTIVE', 'SUSPENDED', 'INACTIVE'] as const).filter((x) => x !== s.status).map((x) => (
            <Button key={x} variant="outlined" color={x === 'ACTIVE' ? 'primary' : 'error'} onClick={() => setStatusTo(x)}>
              {x === 'ACTIVE' ? 'Activate' : x === 'SUSPENDED' ? 'Suspend' : 'Deactivate'}
            </Button>
          ))}
        </Can>
        <Can permission="supplier:update"><Button variant="contained" onClick={() => setEditing(true)}>Edit</Button></Can>
      </>}
      tabs={s ? [
        {
          key: 'overview', label: 'Overview',
          content: (
            <Stack spacing={3}>
              <ErrorAlert error={history.error} />
              <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(3, 1fr)' } }}>
                <KpiCard label="Cherry bought (all time)" value={h?.totals.purchasedKg} unit="kg" loading={history.isLoading} hint={h && `${h.totals.vouchers} vouchers`} />
                <KpiCard label="Paid (all time)" value={h?.totals.paidAmount} unit="ETB" dp={2} loading={history.isLoading} />
                <KpiCard label="Average red ripe" value={h ? averagePct(h.inspections.map((i) => i.redRipePct)) : null} unit="%" dp={1} loading={history.isLoading}
                  hint={h && `${h.inspections.length} inspection${h.inspections.length === 1 ? '' : 's'}`} />
              </Box>
              <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: '1fr', md: '2fr 1fr' }, alignItems: 'start' }}>
                <SectionCard title="Quality history">{h && <QualityChart inspections={h.inspections} />}</SectionCard>
                <SectionCard title="Details">
                  <Stack spacing={2}>
                    <Box sx={{ alignSelf: 'center', p: 1.5, bgcolor: theme.palette.common.white, borderRadius: 1, lineHeight: 0 }}>
                      <QRCodeSVG value={s.qrToken} size={128} fgColor={theme.palette.common.black} bgColor={theme.palette.common.white} title={`QR code of ${s.supplierCode}`} />
                    </Box>
                    <Field label="ID document">{s.identificationType ? `${humanize(s.identificationType)} ${s.identificationNo ?? ''}` : null}</Field>
                    <Field label="Address">{s.address}</Field>
                    <Field label="Registered">{formatDateTime(s.createdAt)}</Field>
                    {s.statusReason && <Field label="Status reason">{s.statusReason}</Field>}
                  </Stack>
                </SectionCard>
              </Box>
            </Stack>
          ),
        },
        { key: 'purchases', label: 'Purchases', count: h?.vouchers.length, content: <DataTable label="Purchases" loading={history.isLoading} rows={h?.vouchers ?? []} columns={voucherCols} rowTo={(v) => `/purchases/${v.id}`} empty={{ title: 'No purchases yet' }} /> },
        { key: 'payments', label: 'Payments', count: h?.payments.length, content: <DataTable label="Payments" loading={history.isLoading} rows={h?.payments ?? []} columns={paymentCols} empty={{ title: 'No payments yet' }} /> },
        { key: 'inspections', label: 'Inspections', count: h?.inspections.length, content: <DataTable label="Inspections" loading={history.isLoading} rows={h?.inspections ?? []} columns={inspectionCols} empty={{ title: 'No inspections yet' }} /> },
        { key: 'documents', label: 'Documents', content: <Documents supplierId={s.id} /> },
      ] : []}
    />
    {editing && s && <SupplierFormDialog supplier={s} onClose={() => { setEditing(false); qc.invalidateQueries({ queryKey: ['suppliers', id] }); }} />}
    {statusTo && s && (
      <ReasonDialog open title={`Set ${s.fullName} to ${humanize(statusTo)}`} message="Only ACTIVE suppliers can be inspected and bought from."
        confirmLabel="Change status" danger={statusTo !== 'ACTIVE'} onClose={() => setStatusTo(null)}
        onConfirm={async (reason) => { await suppliersApi.setStatus(s.id, statusTo, reason); await qc.invalidateQueries({ queryKey: ['suppliers'] }); }} />
    )}
    </>
  );
}
