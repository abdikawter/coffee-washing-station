import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import ScaleIcon from '@mui/icons-material/Scale';
import {
  Alert, Box, Button, Card, CardContent, Divider, IconButton, MenuItem, Stack, TextField, Typography,
} from '@mui/material';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { idempotencyKey, purchasesApi, qualityApi, scalesApi, type Supplier } from '../../api/procurement';
import { ErrorAlert, PageHeader } from '../../components/common';
import { SupplierPicker } from '../../components/SupplierPicker';
import { add, formatNumber, isDecimal, multiplyMoney, subtract } from '../../utils/decimal';
import { formatDateTime } from '../../utils/format';

interface WeighingRow { scaleId: string; grossKg: string; tareKg: string }

const emptyRow = (scaleId = ''): WeighingRow => ({ scaleId, grossKg: '', tareKg: '0' });

/**
 * Tablet-friendly weighing form: supplier → accepted inspection → scale readings.
 * Net weights and amounts shown here are previews; the server computes the
 * voucher totals and checks every scale's verification.
 */
export function NewVoucherPage() {
  const navigate = useNavigate();
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [inspectionId, setInspectionId] = useState('');
  const [coffeeTypeId, setCoffeeTypeId] = useState('');
  const [price, setPrice] = useState('');
  const [rows, setRows] = useState<WeighingRow[]>([emptyRow()]);
  const [key] = useState(idempotencyKey);

  const inspections = useQuery({
    queryKey: ['inspections', 'available', supplier?.id],
    queryFn: () => qualityApi.inspections({ page: 1, pageSize: 50, supplierId: supplier!.id, available: true }),
    enabled: !!supplier,
  });
  const types = useQuery({ queryKey: ['coffee-types'], queryFn: qualityApi.coffeeTypes });
  const scales = useQuery({ queryKey: ['scales'], queryFn: scalesApi.list });
  const activeTypes = types.data?.filter((t) => t.isActive) ?? [];
  const typeId = coffeeTypeId || activeTypes[0]?.id || '';
  const usableScales = scales.data?.filter((s) => s.status === 'OPERATIONAL') ?? [];

  const lines = rows.map((r) => ({ ...r, net: isDecimal(r.grossKg) && isDecimal(r.tareKg || '0') ? subtract(r.grossKg, r.tareKg || '0') : null }));
  const valid = lines.every((l) => l.scaleId && l.net && !l.net.startsWith('-') && l.net !== '0.000');
  const totalKg = valid ? add(lines.map((l) => l.net!)) : null;
  const totalAmount = totalKg && isDecimal(price, 2) ? multiplyMoney(totalKg, price) : null;
  const inspection = inspections.data?.data.find((i) => i.id === inspectionId);
  const unverified = useMemo(
    () => [...new Set(rows.map((r) => r.scaleId))].map((id) => scales.data?.find((s) => s.id === id)).filter((s) => s && !s.verification.verified),
    [rows, scales.data],
  );

  const m = useMutation({
    mutationFn: () => purchasesApi.create({
      qualityInspectionId: inspectionId, coffeeTypeId: typeId, pricePerKg: price,
      items: [{ weighings: rows.map((r) => ({ scaleId: r.scaleId, grossKg: r.grossKg, tareKg: r.tareKg || '0' })) }],
    }, key),
    onSuccess: (v) => navigate(`/purchases/${v.id}`, { replace: true }),
  });
  const setRow = (i: number, patch: Partial<WeighingRow>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <>
      <PageHeader title="New purchase voucher" subtitle="Weigh the accepted cherry and create the voucher draft"
        actions={<Button component={RouterLink} to="/purchases">Back to list</Button>} />
      <ErrorAlert error={m.error ?? inspections.error ?? scales.error} />
      <Stack spacing={2} sx={{ maxWidth: 900 }}>
        <Card variant="outlined">
          <CardContent>
            <Typography variant="overline">1 · Supplier and inspection</Typography>
            <Stack spacing={2} sx={{ mt: 1 }}>
              <SupplierPicker value={supplier} onChange={(s) => { setSupplier(s); setInspectionId(''); }} />
              {supplier && (
                inspections.data?.data.length === 0
                  ? <Alert severity="warning">No accepted, unused inspection for this supplier. The quality inspector must inspect the cherry first.</Alert>
                  : (
                    <TextField select label="Accepted quality inspection" value={inspectionId} onChange={(e) => setInspectionId(e.target.value)}>
                      {inspections.data?.data.map((i) => (
                        <MenuItem key={i.id} value={i.id}>{i.inspectionNo} · {formatDateTime(i.inspectedAt)} · red {i.redRipePct} % {i.gradeCode ? `· ${i.gradeCode}` : ''}</MenuItem>
                      ))}
                    </TextField>
                  )
              )}
              {inspection?.ruleEvaluation.outcome === 'WARN' && <Alert severity="warning">This inspection carries a quality warning.</Alert>}
            </Stack>
          </CardContent>
        </Card>

        <Card variant="outlined">
          <CardContent>
            <Typography variant="overline">2 · Coffee and price</Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mt: 1 }}>
              <TextField select fullWidth label="Coffee type" value={typeId} onChange={(e) => setCoffeeTypeId(e.target.value)}>
                {activeTypes.map((t) => <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>)}
              </TextField>
              <TextField fullWidth label="Price per kg" value={price} onChange={(e) => setPrice(e.target.value)} error={!!price && !isDecimal(price, 2)}
                slotProps={{ htmlInput: { inputMode: 'decimal', style: { fontSize: 22 } } }} />
            </Stack>
          </CardContent>
        </Card>

        <Card variant="outlined">
          <CardContent>
            <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
              <Typography variant="overline">3 · Weighings</Typography>
              <Button startIcon={<AddIcon />} onClick={() => setRows([...rows, emptyRow(rows[rows.length - 1]?.scaleId)])}>Add weighing</Button>
            </Stack>
            {usableScales.length === 0 && <Alert severity="error" sx={{ my: 1 }}>No scale is in service.</Alert>}
            {unverified.length > 0 && (
              <Alert severity="warning" sx={{ my: 1 }} action={<Button color="inherit" size="small" component={RouterLink} to="/scales">Scales</Button>}>
                {unverified.map((s) => s!.code).join(', ')} not verified — the voucher will be refused (or flagged, if the site allows weighing on unverified scales).
              </Alert>
            )}
            <Stack spacing={2} divider={<Divider flexItem />} sx={{ mt: 1 }}>
              {lines.map((l, i) => (
                <Stack key={i} direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' } }}>
                  <TextField select label="Scale" value={l.scaleId} onChange={(e) => setRow(i, { scaleId: e.target.value })} sx={{ minWidth: 160 }}
                    slotProps={{ input: { startAdornment: <ScaleIcon fontSize="small" sx={{ mr: 1 }} /> } }}>
                    {usableScales.map((s) => <MenuItem key={s.id} value={s.id}>{s.code}{s.verification.verified ? '' : ' (not verified)'}</MenuItem>)}
                  </TextField>
                  <TextField label="Gross kg" value={l.grossKg} onChange={(e) => setRow(i, { grossKg: e.target.value })} error={!!l.grossKg && !isDecimal(l.grossKg)}
                    slotProps={{ htmlInput: { inputMode: 'decimal', style: { fontSize: 22 } } }} />
                  <TextField label="Tare kg" value={l.tareKg} onChange={(e) => setRow(i, { tareKg: e.target.value })}
                    slotProps={{ htmlInput: { inputMode: 'decimal', style: { fontSize: 22 } } }} sx={{ maxWidth: { sm: 140 } }} />
                  <Box sx={{ minWidth: 110 }}>
                    <Typography variant="caption" color="text.secondary">Net</Typography>
                    <Typography variant="h6" color={l.net?.startsWith('-') ? 'error' : undefined}>{l.net ? `${formatNumber(l.net, 3)} kg` : '—'}</Typography>
                  </Box>
                  <IconButton aria-label="Remove weighing" disabled={rows.length === 1} onClick={() => setRows(rows.filter((_, j) => j !== i))}><DeleteIcon /></IconButton>
                </Stack>
              ))}
            </Stack>
          </CardContent>
        </Card>

        <Card variant="outlined" sx={{ bgcolor: 'action.hover' }}>
          <CardContent>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={4} sx={{ alignItems: { sm: 'center' } }}>
              <Box><Typography variant="caption">Total weight</Typography><Typography variant="h5">{totalKg ? `${formatNumber(totalKg, 3)} kg` : '—'}</Typography></Box>
              <Box sx={{ flexGrow: 1 }}><Typography variant="caption">Total amount (preview)</Typography><Typography variant="h5">{totalAmount ? formatNumber(totalAmount) : '—'}</Typography></Box>
              <Button variant="contained" size="large" disabled={!supplier || !inspectionId || !typeId || !isDecimal(price, 2) || !valid || m.isPending} onClick={() => m.mutate()}>
                Save draft
              </Button>
            </Stack>
          </CardContent>
        </Card>
      </Stack>
    </>
  );
}
