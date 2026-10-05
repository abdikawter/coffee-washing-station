import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import ScaleIcon from '@mui/icons-material/Scale';
import { Alert, Box, Button, Card, CardContent, IconButton, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { idempotencyKey, purchasesApi, qualityApi, scalesApi, type Supplier } from '../../api/procurement';
import { MoneyText, SectionCard, WeightText } from '../../components';
import { FormTemplate } from '../../templates';
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

  const ready = !!supplier && !!inspectionId && !!typeId && isDecimal(price, 2) && valid;
  const dirty = Boolean(supplier || price || rows.some((r) => r.grossKg));
  const big = { inputMode: 'decimal', style: { fontSize: 22 } } as const;

  return (
    <FormTemplate title="New purchase voucher" subtitle="Weigh the accepted cherry and create the voucher draft"
      breadcrumbs={[{ label: 'Purchasing', to: '/purchases' }, { label: 'New voucher' }]}
      submitLabel="Save draft" busy={m.isPending} error={m.error ?? inspections.error ?? scales.error} dirty={dirty} cancelTo="/purchases"
      onSubmit={() => { if (ready) m.mutate(); }}
      summary={(
        <Stack direction="row" spacing={3} aria-live="polite">
          <Box>
            <Typography variant="caption" color="text.secondary">Total net weight</Typography>
            <Typography variant="h5" component="p" sx={{ fontVariantNumeric: 'tabular-nums' }}>{totalKg ? <WeightText value={totalKg} /> : '—'}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">Total amount (preview)</Typography>
            <Typography variant="h5" component="p" sx={{ fontVariantNumeric: 'tabular-nums' }}>{totalAmount ? <MoneyText value={totalAmount} /> : '—'}</Typography>
          </Box>
        </Stack>
      )}>
      <SectionCard title="1 · Supplier and inspection">
        <Stack spacing={2}>
          <SupplierPicker value={supplier} onChange={(sp) => { setSupplier(sp); setInspectionId(''); }} />
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
      </SectionCard>

      <SectionCard title="2 · Coffee and price">
        <Stack spacing={2}>
          <TextField select fullWidth label="Coffee type" value={typeId} onChange={(e) => setCoffeeTypeId(e.target.value)}>
            {activeTypes.map((t) => <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>)}
          </TextField>
          <TextField fullWidth label="Price per kg (ETB)" value={price} onChange={(e) => setPrice(e.target.value)} error={!!price && !isDecimal(price, 2)}
            helperText={price && !isDecimal(price, 2) ? 'Up to 2 decimals' : ' '} slotProps={{ htmlInput: big }} />
        </Stack>
      </SectionCard>

      <Box sx={{ gridColumn: '1 / -1' }}>
        <SectionCard title="3 · Weighings" subtitle="Net = gross − tare, per weighing. The server recomputes every total."
          actions={<Button startIcon={<AddIcon />} onClick={() => setRows([...rows, emptyRow(rows[rows.length - 1]?.scaleId)])}>Add weighing</Button>}>
          {usableScales.length === 0 && <Alert severity="error" sx={{ mb: 2 }}>No scale is in service.</Alert>}
          {unverified.length > 0 && (
            <Alert severity="warning" sx={{ mb: 2 }} action={<Button color="inherit" size="small" component={RouterLink} to="/scales">Scales</Button>}>
              {unverified.map((sc) => sc!.code).join(', ')} not verified — the voucher will be refused (or flagged, if the site allows weighing on unverified scales).
            </Alert>
          )}
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', lg: 'repeat(2, minmax(0, 1fr))' } }}>
            {lines.map((l, i) => (
              <Card key={i} component="article" aria-label={`Weighing ${i + 1}`} sx={{ bgcolor: 'background.default' }}>
                <CardContent sx={{ '&:last-child': { pb: 2 } }}>
                  <Stack direction="row" sx={{ alignItems: 'center', mb: 1.5 }}>
                    <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>Weighing {i + 1}</Typography>
                    <IconButton aria-label={`Remove weighing ${i + 1}`} disabled={rows.length === 1} onClick={() => setRows(rows.filter((_, j) => j !== i))}><DeleteIcon /></IconButton>
                  </Stack>
                  <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr 1fr', sm: '1.2fr 1fr 1fr' } }}>
                    <TextField select label="Scale" value={l.scaleId} onChange={(e) => setRow(i, { scaleId: e.target.value })} sx={{ gridColumn: { xs: '1 / -1', sm: 'auto' } }}
                      slotProps={{ input: { startAdornment: <ScaleIcon fontSize="small" sx={{ mr: 1 }} /> } }}>
                      {usableScales.map((sc) => <MenuItem key={sc.id} value={sc.id}>{sc.code}{sc.verification.verified ? '' : ' (not verified)'}</MenuItem>)}
                    </TextField>
                    <TextField label="Gross kg" value={l.grossKg} onChange={(e) => setRow(i, { grossKg: e.target.value })} error={!!l.grossKg && !isDecimal(l.grossKg)} slotProps={{ htmlInput: big }} />
                    <TextField label="Tare kg" value={l.tareKg} onChange={(e) => setRow(i, { tareKg: e.target.value })} error={!!l.tareKg && !isDecimal(l.tareKg)} slotProps={{ htmlInput: big }} />
                  </Box>
                  <Stack direction="row" spacing={1} sx={{ mt: 1.5, alignItems: 'baseline', justifyContent: 'flex-end' }}>
                    <Typography variant="body2" color="text.secondary">Net</Typography>
                    <Typography variant="kpi" component="p" color={l.net?.startsWith('-') ? 'error' : undefined}>{l.net ? formatNumber(l.net, 3) : '—'}</Typography>
                    <Typography variant="subtitle1" color="text.secondary">kg</Typography>
                  </Stack>
                </CardContent>
              </Card>
            ))}
          </Box>
        </SectionCard>
      </Box>
    </FormTemplate>
  );
}
