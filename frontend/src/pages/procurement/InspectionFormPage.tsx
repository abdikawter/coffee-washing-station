import { Alert, Box, Button, FormControlLabel, MenuItem, Radio, RadioGroup, Stack, TextField, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { qualityApi, type Inspection, type QualityMetric, type QualityRule, type Supplier } from '../../api/procurement';
import { useAuth } from '../../auth/useAuth';
import { SectionCard, StatusChip } from '../../components';
import { SupplierPicker } from '../../components/SupplierPicker';
import { DetailTemplate, FormTemplate } from '../../templates';
import { add, compare, formatNumber, isDecimal, subtract } from '../../utils/decimal';

const pctOk = (v: string) => isDecimal(v, 2) && compare(v, '0', 2) >= 0 && compare(v, '100', 2) <= 0;
/** Preview only — the server applies `quality.percentSumTolerance` (default 0.5). */
const SUM_TOLERANCE = '0.5';
const OPERATORS = { LT: '<', LTE: '≤', GT: '>', GTE: '≥' } as const;

const PARTS: { metric: QualityMetric; label: string; color: string }[] = [
  { metric: 'RED_RIPE_PCT', label: 'Red ripe', color: 'secondary.main' },
  { metric: 'GREEN_UNRIPE_PCT', label: 'Green / unripe', color: 'success.main' },
  { metric: 'OVERRIPE_DAMAGED_PCT', label: 'Overripe / damaged', color: 'primary.main' },
];

/**
 * Live stacked bar of the three percentages, each part labelled (never colour alone).
 * `compact`: a thin bar without the legend, for table rows (the accessible name keeps the numbers).
 */
export function CompositionBar({ values, compact }: { values: Record<QualityMetric, string>; compact?: boolean }) {
  const parts = PARTS.map((p) => ({ ...p, value: pctOk(values[p.metric]) ? values[p.metric] : '0' }));
  return (
    <Box>
      <Box role="img" aria-label={parts.map((p) => `${p.label} ${formatNumber(p.value, 1)} %`).join(', ')}
        sx={{ display: 'flex', height: compact ? 10 : 32, borderRadius: 1, overflow: 'hidden', bgcolor: 'action.hover', gap: '2px' }}>
        {parts.filter((p) => compare(p.value, '0', 2) > 0).map((p) => (
          <Box key={p.metric} sx={{ flexGrow: Number(p.value), flexBasis: 0, bgcolor: p.color, minWidth: 2 }} />
        ))}
      </Box>
      {!compact && <Stack direction="row" spacing={2} useFlexGap sx={{ mt: 1, flexWrap: 'wrap' }}>
        {parts.map((p) => (
          <Stack key={p.metric} direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
            <Box aria-hidden sx={{ width: 12, height: 12, borderRadius: 0.5, bgcolor: p.color }} />
            <Typography variant="body2">{p.label} <strong>{formatNumber(p.value, 1)} %</strong></Typography>
          </Stack>
        ))}
      </Stack>}
    </Box>
  );
}

/** Which active rules the entered values would trigger (the server re-evaluates on save). */
export function triggeredRules(rules: QualityRule[], values: Record<QualityMetric, string>): QualityRule[] {
  return rules.filter((r) => {
    const v = values[r.metric];
    if (!r.isActive || !pctOk(v)) return false;
    const c = compare(v, r.threshold, 2);
    return r.operator === 'LT' ? c < 0 : r.operator === 'LTE' ? c <= 0 : r.operator === 'GT' ? c > 0 : c >= 0;
  });
}

function Result({ r, onAgain }: { r: Inspection; onAgain: () => void }) {
  const severity = r.decision === 'ACCEPTED' ? (r.ruleEvaluation.outcome === 'WARN' ? 'warning' : 'success') : 'error';
  return (
    <DetailTemplate title={`Inspection ${r.inspectionNo}`} breadcrumbs={[{ label: 'Quality', to: '/quality' }, { label: r.inspectionNo }]}
      status={<StatusChip status={r.decision} domain="inspection" />}
      figures={[
        { label: 'Supplier', value: r.supplierName },
        { label: 'Red ripe', value: `${formatNumber(r.redRipePct, 1)} %` },
        { label: 'Green / unripe', value: `${formatNumber(r.greenUnripePct, 1)} %` },
        { label: 'Overripe / damaged', value: `${formatNumber(r.overripeDamagedPct, 1)} %` },
      ]}
      actions={<><Button variant="outlined" component={RouterLink} to="/quality">Back to inspections</Button><Button variant="contained" onClick={onAgain}>New inspection</Button></>}
      tabs={[{
        key: 'result', label: 'Result',
        content: (
          <Stack spacing={1}>
            <Alert severity={severity}>
              {r.decision === 'ACCEPTED' ? 'Cherry accepted — the purchasing clerk can now weigh and create the voucher.' : `Cherry rejected: ${r.rejectionReason}`}
              {r.ruleEvaluation.forcedRejection && ' (a REJECT rule overrode the decision)'}
            </Alert>
            {r.ruleEvaluation.results.filter((x) => x.triggered).map((x) => <Typography key={x.name} variant="body2">• {x.name} ({x.action})</Typography>)}
          </Stack>
        ),
      }]}
    />
  );
}

/** Cherry quality inspection before purchase (spec §7): three % inputs, live bar and sum, rule warnings inline. */
export function InspectionFormPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [values, setValues] = useState<Record<QualityMetric, string>>({ RED_RIPE_PCT: '', GREEN_UNRIPE_PCT: '', OVERRIPE_DAMAGED_PCT: '' });
  const [gradeId, setGradeId] = useState('');
  const [decision, setDecision] = useState<'ACCEPTED' | 'REJECTED'>('ACCEPTED');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [tried, setTried] = useState(false);
  const grades = useQuery({ queryKey: ['grades', 'CHERRY'], queryFn: () => qualityApi.grades('CHERRY') });
  const rules = useQuery({ queryKey: ['quality-rules'], queryFn: qualityApi.rules, enabled: can('quality:rules-read') });
  const m = useMutation({
    mutationFn: () => qualityApi.inspect({
      supplierId: supplier!.id, redRipePct: values.RED_RIPE_PCT, greenUnripePct: values.GREEN_UNRIPE_PCT, overripeDamagedPct: values.OVERRIPE_DAMAGED_PCT, decision,
      qualityGradeId: gradeId || null, rejectionReason: decision === 'REJECTED' ? reason.trim() : null, notes: notes.trim() || null,
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inspections'] }),
  });

  if (m.data) {
    return <Result r={m.data} onAgain={() => { m.reset(); setSupplier(null); setValues({ RED_RIPE_PCT: '', GREEN_UNRIPE_PCT: '', OVERRIPE_DAMAGED_PCT: '' }); setReason(''); setNotes(''); setTried(false); }} />;
  }

  const all = Object.values(values);
  const allValid = all.every(pctOk);
  const sum = allValid ? add(all, 2) : null;
  const sumOff = sum !== null && compare(subtract(sum, '100', 2).replace('-', ''), SUM_TOLERANCE, 2) > 0;
  const hits = triggeredRules(rules.data ?? [], values);
  const rejects = hits.some((r) => r.action === 'REJECT');
  const valid = !!supplier && allValid && !sumOff && (decision === 'ACCEPTED' || reason.trim().length >= 3);
  const dirty = Boolean(supplier || all.some(Boolean) || notes);

  return (
    <FormTemplate title="Cherry quality inspection" breadcrumbs={[{ label: 'Quality', to: '/quality' }, { label: 'New inspection' }]}
      submitLabel="Record inspection" busy={m.isPending} error={m.error} dirty={dirty} cancelTo="/quality"
      onSubmit={() => { setTried(true); if (valid) m.mutate(); }}>
      <Box sx={{ gridColumn: '1 / -1' }}>
        <SectionCard title="Supplier">
          <SupplierPicker value={supplier} onChange={setSupplier} />
          {tried && !supplier && <Typography variant="caption" color="error">Choose the supplier.</Typography>}
        </SectionCard>
      </Box>
      <Box sx={{ gridColumn: '1 / -1' }}>
        <SectionCard title="Cherry composition" subtitle="The three parts must add up to 100 %.">
          <Stack spacing={2.5}>
            <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' } }}>
              {PARTS.map((p) => {
                const v = values[p.metric];
                const bad = (tried || v !== '') && !pctOk(v);
                return (
                  <TextField key={p.metric} label={`${p.label} %`} value={v} onChange={(e) => setValues({ ...values, [p.metric]: e.target.value.replace(',', '.') })}
                    error={bad} helperText={bad ? '0–100, up to 2 decimals' : ' '} slotProps={{ htmlInput: { inputMode: 'decimal' } }} />
                );
              })}
            </Box>
            <CompositionBar values={values} />
            <Typography variant="body2" role="status" color={sum === null ? 'text.secondary' : sumOff ? 'error.main' : 'success.main'} sx={{ fontWeight: 600 }}>
              {sum === null ? 'Sum: enter all three values' : sumOff ? `Sum ${formatNumber(sum, 2)} % — must be 100 % (± ${SUM_TOLERANCE})` : `Sum ${formatNumber(sum, 2)} % ✓`}
            </Typography>
            {hits.length > 0 && (
              <Alert severity={rejects ? 'error' : 'warning'}>
                {rejects ? 'These values break a REJECT rule — the cherry will be rejected even if you accept it.' : 'These values trigger a warning rule.'}
                {hits.map((r) => <div key={r.id}>• {r.name}: {r.metric === 'RED_RIPE_PCT' ? 'red ripe' : r.metric === 'GREEN_UNRIPE_PCT' ? 'green' : 'overripe'} {OPERATORS[r.operator]} {formatNumber(r.threshold, 1)} % ({r.action.toLowerCase()})</div>)}
              </Alert>
            )}
          </Stack>
        </SectionCard>
      </Box>
      <Box sx={{ gridColumn: '1 / -1' }}>
        <SectionCard title="Decision">
          <Stack spacing={2}>
            <TextField select label="Cherry grade (optional)" value={gradeId} onChange={(e) => setGradeId(e.target.value)}>
              <MenuItem value="">—</MenuItem>
              {grades.data?.filter((g) => g.isActive).map((g) => <MenuItem key={g.id} value={g.id}>{g.code} · {g.name}</MenuItem>)}
            </TextField>
            <RadioGroup row value={decision} onChange={(e) => setDecision(e.target.value as 'ACCEPTED' | 'REJECTED')} aria-label="Decision">
              <FormControlLabel value="ACCEPTED" control={<Radio />} label="Accept" />
              <FormControlLabel value="REJECTED" control={<Radio />} label="Reject" />
            </RadioGroup>
            {decision === 'REJECTED' && <TextField label="Rejection reason" value={reason} onChange={(e) => setReason(e.target.value)} required
              error={tried && reason.trim().length < 3} helperText={tried && reason.trim().length < 3 ? 'At least 3 characters' : ' '} />}
            <TextField label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} multiline minRows={2} />
          </Stack>
        </SectionCard>
      </Box>
    </FormTemplate>
  );
}
