import AddIcon from '@mui/icons-material/Add';
import {
  Alert, Box, Button, Card, CardActions, CardContent, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel,
  Link, MenuItem, Stack, Tab, Tabs, TextField, Typography, useTheme,
} from '@mui/material';
import { SparkLineChart } from '@mui/x-charts/SparkLineChart';
import type { GridColDef } from '@mui/x-data-grid';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import dayjs from 'dayjs';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import { lotsApi, processingApi, type Batch, type BoardLot, type CaResult, type Mucilage, type Reconciliation, type TimingState, type Unit, type UnitKind } from '../../api/processing';
import { qualityApi } from '../../api/procurement';
import { Can } from '../../auth/Can';
import { useAuth } from '../../auth/useAuth';
import {
  DataTable, EmptyState, ErrorAlert, Field, Loading, PercentText, ProgressRing, ReasonDialog, SectionCard, StatusChip, WeightText,
} from '../../components';
import { ListTemplate } from '../../templates';
import { statusTone } from '../../theme';
import { add, formatNumber, isDecimal, subtract } from '../../utils/decimal';
import { formatDateTime, humanize, STATION_TIMEZONE } from '../../utils/format';

const kgField = (v: string) => !v || isDecimal(v);
const TIMING_LABEL: Record<TimingState, string> = { BEFORE_MIN: 'Fermenting', IN_WINDOW: 'Ready window', APPROACHING_MAX: 'Approaching max', OVERDUE: 'Overdue' };

function caMessage(ca: CaResult | null | undefined): string | null {
  if (!ca) return null;
  return ca.correctiveAction ? `Corrective action ${ca.correctiveAction.caNumber} was opened.` : 'A corrective action was recommended to the site manager.';
}

/** Generic step dialog: a title, fields, a submit that resolves to an optional message to show afterwards. */
function StepDialog({ title, children, valid, onSubmit, onClose }: {
  title: string; children: ReactNode; valid: boolean; onSubmit: () => Promise<string | null | void>; onClose: () => void;
}) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: onSubmit,
    onSuccess: (msg) => {
      for (const k of ['lots', 'fermentation', 'units', 'reconciliations']) qc.invalidateQueries({ queryKey: [k] });
      if (!msg) onClose();
    },
  });
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <ErrorAlert error={m.error} />
        {m.data ? <Alert severity="warning">{m.data}</Alert> : <Stack spacing={2} sx={{ mt: 1 }}>{children}</Stack>}
      </DialogContent>
      <DialogActions>
        {m.data ? <Button variant="contained" onClick={onClose}>Done</Button> : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="contained" size="large" disabled={!valid || m.isPending} onClick={() => m.mutate()}>Save</Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}

function UnitSelect({ kind, value, onChange, label }: { kind: UnitKind; value: string; onChange: (v: string) => void; label: string }) {
  const q = useQuery({ queryKey: ['units', kind], queryFn: () => processingApi.units(kind) });
  return (
    <TextField select label={label} value={value} onChange={(e) => onChange(e.target.value)} helperText={q.data?.length === 0 ? 'None registered — see the Setup tab' : ' '}>
      {q.data?.map((u) => (
        <MenuItem key={u.id} value={u.id} disabled={u.status !== 'OPERATIONAL' || !!u.activeBatch}>
          {u.code} · {u.name}{u.capacityKg ? ` · ${formatNumber(u.capacityKg, 0)} kg` : ''}{u.status !== 'OPERATIONAL' ? ` (${humanize(u.status)})` : u.activeBatch ? ` (in use: ${u.activeBatch.lot_number})` : ''}
        </MenuItem>
      ))}
    </TextField>
  );
}

const kgInput = (label: string, value: string, set: (v: string) => void, helper?: string) => (
  <TextField label={label} value={value} onChange={(e) => set(e.target.value)} error={!kgField(value)} helperText={helper ?? ' '}
    slotProps={{ htmlInput: { inputMode: 'decimal', style: { fontSize: 20 } } }} />
);

// ---------------------------------------------------------------- step dialogs

function IntakeDialog({ lot, onClose }: { lot: BoardLot; onClose: () => void }) {
  const [hopperId, setHopperId] = useState('');
  const [kg, setKg] = useState(lot.currentWeightKg);
  return (
    <StepDialog title={`Hopper intake · ${lot.lotNumber}`} valid={!!hopperId && isDecimal(kg)} onClose={onClose}
      onSubmit={async () => { const r = await processingApi.intake({ lotId: lot.id, hopperId, intakeKg: kg }); return r.warnings.length ? r.warnings.join('; ') : null; }}>
      <Typography variant="body2">Purchased: {formatNumber(lot.originalCherryWeightKg, 3)} kg. Weigh what actually goes into the hopper.</Typography>
      <UnitSelect kind="hoppers" label="Hopper" value={hopperId} onChange={setHopperId} />
      {kgInput('Intake (kg)', kg, setKg)}
    </StepDialog>
  );
}

function FlotationDialog({ lot, onClose }: { lot: BoardLot; onClose: () => void }) {
  const [floaters, setFloaters] = useState('');
  const [sinkers, setSinkers] = useState('');
  const total = isDecimal(floaters) && isDecimal(sinkers) ? add([floaters, sinkers]) : null;
  return (
    <StepDialog title={`Flotation · ${lot.lotNumber}`} valid={isDecimal(floaters) && isDecimal(sinkers)} onClose={onClose}
      onSubmit={async () => {
        const r = await processingApi.flotation(lot.openIntakeId!, { floatersKg: floaters, sinkersKg: sinkers });
        return r.balance.withinTolerance ? null : `Floaters + sinkers differ from the intake by ${r.balance.differenceKg} kg (${r.balance.differencePct} %). ${caMessage(r.correctiveAction) ?? ''}`;
      }}>
      <Typography variant="body2">Intake: {formatNumber(lot.currentWeightKg, 3)} kg. Floaters are removed; sinkers continue to pulping.</Typography>
      {kgInput('Floaters (kg)', floaters, setFloaters)}
      {kgInput('Sinkers (kg)', sinkers, setSinkers, total ? `Total ${total} kg · difference ${subtract(total, lot.currentWeightKg)} kg` : undefined)}
    </StepDialog>
  );
}

function PulpDialog({ lot, onClose }: { lot: BoardLot; onClose: () => void }) {
  const [machineId, setMachineId] = useState('');
  const [output, setOutput] = useState('');
  return (
    <StepDialog title={`Pulping · ${lot.lotNumber}`} valid={!!machineId && kgField(output)} onClose={onClose}
      onSubmit={async () => {
        const r = await processingApi.pulp({ lotId: lot.id, machineId, outputKg: output || null });
        return r.inspectionProblem ? `Pulped without a passing machine inspection (${r.inspectionProblem}). ${caMessage(r.correctiveAction) ?? ''}` : null;
      }}>
      <Typography variant="body2">Input: {formatNumber(lot.currentWeightKg, 3)} kg of sinkers. The machine needs today's passing inspection.</Typography>
      <UnitSelect kind="pulping/machines" label="Pulping machine" value={machineId} onChange={setMachineId} />
      {kgInput('Output (kg) — optional now', output, setOutput, 'Leave empty and record the output when the run ends')}
    </StepDialog>
  );
}

function PulpOutputDialog({ lot, onClose }: { lot: BoardLot; onClose: () => void }) {
  const [output, setOutput] = useState('');
  return (
    <StepDialog title={`Pulping output · ${lot.lotNumber}`} valid={isDecimal(output)} onClose={onClose}
      onSubmit={async () => { await processingApi.completePulping(lot.openPulpingId!, output); }}>
      <Typography variant="body2">Input was {formatNumber(lot.currentWeightKg, 3)} kg.</Typography>
      {kgInput('Output (kg)', output, setOutput)}
    </StepDialog>
  );
}

function FermentDialog({ lot, onClose }: { lot: BoardLot; onClose: () => void }) {
  const [tankId, setTankId] = useState('');
  return (
    <StepDialog title={`Start fermentation · ${lot.lotNumber}`} valid={!!tankId} onClose={onClose}
      onSubmit={async () => { await processingApi.startFermentation({ lotId: lot.id, tankId }); }}>
      <Typography variant="body2">{formatNumber(lot.currentWeightKg, 3)} kg of pulped coffee. The duration window comes from the settings (typically 24–48 h).</Typography>
      <UnitSelect kind="fermentation/tanks" label="Tank (free tanks only)" value={tankId} onChange={setTankId} />
    </StepDialog>
  );
}

function WashDialog({ lot, onClose }: { lot: BoardLot; onClose: () => void }) {
  const [output, setOutput] = useState('');
  const [density, setDensity] = useState('');
  return (
    <StepDialog title={`Washing · ${lot.lotNumber}`} valid={isDecimal(output)} onClose={onClose}
      onSubmit={async () => { await processingApi.wash({ lotId: lot.id, outputKg: output, densitySeparation: density.trim() || null }); }}>
      <Typography variant="body2">Input: {formatNumber(lot.currentWeightKg, 3)} kg.</Typography>
      {kgInput('Washed output (kg)', output, setOutput)}
      <TextField label="Density separation notes (optional)" value={density} onChange={(e) => setDensity(e.target.value)} />
    </StepDialog>
  );
}

function GradeDialog({ lot, onClose }: { lot: BoardLot; onClose: () => void }) {
  const grades = useQuery({ queryKey: ['grades', 'PARCHMENT'], queryFn: () => qualityApi.grades('PARCHMENT') });
  const [weights, setWeights] = useState<Record<string, string>>({});
  const filled = Object.entries(weights).filter(([, w]) => w.trim() !== '');
  const valid = filled.length > 0 && filled.every(([, w]) => isDecimal(w));
  const total = valid ? add(filled.map(([, w]) => w)) : null;
  return (
    <StepDialog title={`Grading · ${lot.lotNumber}`} valid={valid} onClose={onClose}
      onSubmit={async () => {
        const r = await processingApi.grade({ lotId: lot.id, outputs: filled.map(([gradeId, weightKg]) => ({ gradeId, weightKg })) });
        return `Created grade lots: ${r.children.map((c) => `${c.lotNumber} (${c.weightKg} kg)`).join(', ')}.`;
      }}>
      <Typography variant="body2">Washed: {formatNumber(lot.currentWeightKg, 3)} kg. Each grade becomes its own lot.</Typography>
      {grades.data?.filter((g) => g.isActive).map((g) => (
        <TextField key={g.id} label={`${g.code} · ${g.name} (kg)`} value={weights[g.id] ?? ''} onChange={(e) => setWeights({ ...weights, [g.id]: e.target.value })}
          error={!kgField(weights[g.id] ?? '')} slotProps={{ htmlInput: { inputMode: 'decimal', style: { fontSize: 20 } } }} />
      ))}
      {total && <Typography variant="body2" color="text.secondary">Total {total} kg of {lot.currentWeightKg} kg washed</Typography>}
    </StepDialog>
  );
}

// ---------------------------------------------------------------- board

type Step = { label: string; permission: string; dialog: (lot: BoardLot, close: () => void) => ReactNode } | { info: string; to?: string };

function nextStep(l: BoardLot): Step {
  switch (l.currentStage) {
    case 'PURCHASED': return { label: 'Hopper intake', permission: 'hopper:record', dialog: (lot, c) => <IntakeDialog lot={lot} onClose={c} /> };
    case 'HOPPER': return { label: 'Flotation', permission: 'hopper:record', dialog: (lot, c) => <FlotationDialog lot={lot} onClose={c} /> };
    case 'FLOTATION': return { label: 'Pulp', permission: 'pulping:record', dialog: (lot, c) => <PulpDialog lot={lot} onClose={c} /> };
    case 'PULPING': return l.openPulpingId
      ? { label: 'Record output', permission: 'pulping:record', dialog: (lot, c) => <PulpOutputDialog lot={lot} onClose={c} /> }
      : { label: 'Start fermentation', permission: 'fermentation:record', dialog: (lot, c) => <FermentDialog lot={lot} onClose={c} /> };
    case 'FERMENTATION': return l.fermentation?.status === 'COMPLETED'
      ? { label: 'Wash', permission: 'washing:record', dialog: (lot, c) => <WashDialog lot={lot} onClose={c} /> }
      : { info: `Fermenting · ${l.fermentation?.batch_number ?? ''}`, to: '/processing?tab=fermentation' };
    case 'WASHING': return { label: 'Grade', permission: 'grading:record', dialog: (lot, c) => <GradeDialog lot={lot} onClose={c} /> };
    default: return { info: l.type === 'GRADE_SPLIT' ? 'Ready for drying (Phase 4)' : '' };
  }
}

function Board() {
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['lots', 'board'], queryFn: lotsApi.board, refetchInterval: 30_000 });
  const [open, setOpen] = useState<{ lot: BoardLot; step: Extract<Step, { label: string }> } | null>(null);
  return (
    <>
      <ErrorAlert error={q.error} />
      {q.isLoading && <Loading />}
      <Box sx={{ display: 'grid', gridAutoFlow: 'column', gridAutoColumns: { xs: '85%', sm: '45%', md: 'minmax(230px, 1fr)' }, gap: 2, overflowX: 'auto', pb: 1 }}>
        {q.data?.map((column) => (
          <Box key={column.stage} component="section" aria-label={`${humanize(column.stage)}: ${column.lots.length} lots`}
            sx={{ p: 1.5, bgcolor: 'action.hover', borderRadius: 3, minHeight: 200 }}>
            <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 1.5, px: 0.5 }}>
              <Typography variant="subtitle2" component="h2">{humanize(column.stage)}</Typography>
              <Chip size="small" label={column.lots.length} />
            </Stack>
            <Stack spacing={1}>
              {column.lots.length === 0 && <Typography variant="caption" color="text.secondary" sx={{ px: 0.5 }}>No lots</Typography>}
              {column.lots.map((l) => {
                const step = nextStep(l);
                return (
                  <Card key={l.id} component="article" sx={{ borderLeft: 4, borderLeftColor: l.onHold ? 'error.main' : 'divider' }}>
                    <CardContent sx={{ pb: 1 }}>
                      <Link component={RouterLink} to={`/lots/${l.id}`} variant="body2" sx={{ fontWeight: 600 }}>{l.lotNumber}</Link>
                      <Typography variant="caption" component="div" color="text.secondary">
                        {l.supplierName ?? ''}{l.gradeCode ? ` · ${l.gradeCode}` : ''}
                      </Typography>
                      <Typography variant="body2" sx={{ mt: 0.5 }}><WeightText value={l.currentWeightKg} dp={0} /></Typography>
                      {l.onHold && <Box sx={{ mt: 0.5 }}><StatusChip status="ON_HOLD" domain="lot" /></Box>}
                    </CardContent>
                    <CardActions sx={{ pt: 0, px: 2, pb: 1.5 }}>
                      {'label' in step
                        ? can(step.permission) && <Button size="small" variant="contained" disabled={l.onHold} onClick={() => setOpen({ lot: l, step })}>{step.label}</Button>
                        : step.to ? <Button size="small" component={RouterLink} to={step.to}>{step.info}</Button> : <Typography variant="caption" color="text.secondary">{step.info}</Typography>}
                    </CardActions>
                  </Card>
                );
              })}
            </Stack>
          </Box>
        ))}
      </Box>
      {open && open.step.dialog(open.lot, () => setOpen(null))}
    </>
  );
}

// ---------------------------------------------------------------- fermentation

function MeasureDialog({ batch, onClose }: { batch: Batch; onClose: () => void }) {
  const [f, setF] = useState({ temperatureC: '', ph: '', sweetness: '', acidity: '', mucilageAssessment: 'NOT_ASSESSED' as Mucilage });
  const num = (v: string) => !v || /^-?\d{1,4}(\.\d{1,2})?$/.test(v);
  return (
    <StepDialog title={`Measurement · ${batch.batchNumber}`} valid={num(f.temperatureC) && num(f.ph) && num(f.sweetness) && num(f.acidity)} onClose={onClose}
      onSubmit={async () => {
        await processingApi.measure(batch.id, {
          temperatureC: f.temperatureC || null, ph: f.ph || null, sweetness: f.sweetness || null, acidity: f.acidity || null, mucilageAssessment: f.mucilageAssessment,
        });
      }}>
      <Stack direction="row" spacing={2}>
        <TextField label="Temperature °C" value={f.temperatureC} onChange={(e) => setF({ ...f, temperatureC: e.target.value })} slotProps={{ htmlInput: { inputMode: 'decimal' } }} />
        <TextField label="pH" value={f.ph} onChange={(e) => setF({ ...f, ph: e.target.value })} slotProps={{ htmlInput: { inputMode: 'decimal' } }} />
      </Stack>
      <Stack direction="row" spacing={2}>
        <TextField label="Sweetness" value={f.sweetness} onChange={(e) => setF({ ...f, sweetness: e.target.value })} slotProps={{ htmlInput: { inputMode: 'decimal' } }} />
        <TextField label="Acidity" value={f.acidity} onChange={(e) => setF({ ...f, acidity: e.target.value })} slotProps={{ htmlInput: { inputMode: 'decimal' } }} />
      </Stack>
      <TextField select label="Mucilage" value={f.mucilageAssessment} onChange={(e) => setF({ ...f, mucilageAssessment: e.target.value as Mucilage })}>
        <MenuItem value="NOT_ASSESSED">Not assessed</MenuItem><MenuItem value="INCOMPLETE">Still on the beans</MenuItem><MenuItem value="COMPLETE">Completely broken down</MenuItem>
      </TextField>
    </StepDialog>
  );
}

/** Temperature readings of a batch as a small trend line (single series, labelled). */
function MeasurementsMini({ batchId }: { batchId: string }) {
  const theme = useTheme();
  const q = useQuery({ queryKey: ['fermentation', batchId], queryFn: () => processingApi.batch(batchId), refetchInterval: 120_000 });
  const ms = [...(q.data?.measurements ?? [])].sort((a, b) => a.measuredAt.localeCompare(b.measuredAt));
  const temps = ms.filter((m) => m.temperatureC !== null).map((m) => Number(m.temperatureC));
  const last = ms[ms.length - 1];
  if (!last) return <Typography variant="caption" color="text.secondary">No measurements yet</Typography>;
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" component="div">
        Last: {[last.temperatureC && `${last.temperatureC} °C`, last.ph && `pH ${last.ph}`, humanize(last.mucilageAssessment)].filter(Boolean).join(' · ')} ({formatDateTime(last.measuredAt)})
      </Typography>
      {temps.length > 1 && (
        <Box aria-label={`Temperature trend: ${temps.join(', ')} °C`} role="img">
          <SparkLineChart data={temps} height={32} color={theme.vars?.palette.info.main} showTooltip valueFormatter={(v) => (v === null ? '' : `${v} °C`)} />
        </Box>
      )}
    </Box>
  );
}

/** One card per tank (spec §7): ring of hours elapsed vs the max, amber near max, red over max. */
function FermentationTab() {
  const q = useQuery({ queryKey: ['fermentation', 'active'], queryFn: () => processingApi.batches({ page: 1, pageSize: 50, status: 'IN_PROGRESS' }), refetchInterval: 60_000 });
  const qc = useQueryClient();
  const [measuring, setMeasuring] = useState<Batch | null>(null);
  const [completing, setCompleting] = useState<Batch | null>(null);
  const complete = useMutation({
    mutationFn: (b: Batch) => processingApi.completeFermentation(b.id, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['fermentation'] }); qc.invalidateQueries({ queryKey: ['lots'] }); },
  });
  return (
    <>
      <ErrorAlert error={q.error ?? complete.error} />
      {q.isLoading && <Loading />}
      {q.data?.data.length === 0 && <EmptyState title="No fermentation in progress" message="Start fermentation from the board once a lot is pulped." />}
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(3, minmax(0, 1fr))' } }}>
        {q.data?.data.map((b) => {
          const tone = statusTone(b.timing.state, 'fermentationTiming');
          const pct = (Number(b.timing.elapsedHours) / Number(b.maxDurationHours)) * 100;
          return (
            <Card key={b.id} component="article" aria-label={`Tank ${b.tankCode}`} sx={{ display: 'flex', flexDirection: 'column' }}>
              <CardContent sx={{ flexGrow: 1 }}>
                <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                  <Typography variant="h6" component="h2">Tank {b.tankCode}</Typography>
                  <StatusChip status={b.timing.state} domain="fermentationTiming" label={TIMING_LABEL[b.timing.state]} />
                </Stack>
                <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                  <ProgressRing value={pct} tone={tone} label={`${formatNumber(b.timing.elapsedHours, 0)} h`} caption={`of ${formatNumber(b.minDurationHours, 0)}–${formatNumber(b.maxDurationHours, 0)} h`}
                    ariaLabel={`Fermentation time of tank ${b.tankCode}`} />
                  <Stack spacing={0.5} sx={{ minWidth: 0 }}>
                    <Link component={RouterLink} to={`/lots/${b.lotId}`} variant="body2" sx={{ fontWeight: 600 }}>{b.lotNumber}</Link>
                    <Typography variant="caption" color="text.secondary">{b.batchNumber}</Typography>
                    <Typography variant="body2"><WeightText value={b.inputKg} dp={0} /></Typography>
                    <Typography variant="caption" color="text.secondary">Max at {formatDateTime(b.timing.maxEndAt)}</Typography>
                  </Stack>
                </Stack>
                <Box sx={{ mt: 1.5 }}><MeasurementsMini batchId={b.id} /></Box>
              </CardContent>
              <CardActions sx={{ px: 2, pb: 2 }}>
                <Can permission={['fermentation:record', 'fermentation:assess']}><Button variant="outlined" onClick={() => setMeasuring(b)}>Measure</Button></Can>
                <Can permission="fermentation:record">
                  <Button variant="contained" disabled={complete.isPending}
                    onClick={() => (b.timing.state === 'BEFORE_MIN' ? setCompleting(b) : complete.mutate(b))}>Complete</Button>
                </Can>
              </CardActions>
            </Card>
          );
        })}
      </Box>
      {measuring && <MeasureDialog batch={measuring} onClose={() => setMeasuring(null)} />}
      {completing && (
        <ReasonDialog open title={`Complete ${completing.batchNumber} early`} message={`Only ${completing.timing.elapsedHours} h of the minimum ${completing.minDurationHours} h.`}
          confirmLabel="Complete" onClose={() => setCompleting(null)}
          onConfirm={async (reason) => { await processingApi.completeFermentation(completing.id, { reason }); await qc.invalidateQueries({ queryKey: ['fermentation'] }); await qc.invalidateQueries({ queryKey: ['lots'] }); }} />
      )}
    </>
  );
}

// ---------------------------------------------------------------- machines

function MachineCheckDialog({ machine, onClose }: { machine: Unit; onClose: () => void }) {
  const [c, setC] = useState({ discTeethOk: false, discSpacingOk: false, cleaningDone: false });
  const [spacing, setSpacing] = useState('');
  return (
    <StepDialog title={`Daily check · ${machine.code}`} valid={!spacing || /^\d{1,4}(\.\d{1,2})?$/.test(spacing)} onClose={onClose}
      onSubmit={async () => {
        const r = await processingApi.inspect(machine.id, { ...c, discSpacingMm: spacing || null });
        return r.result === 'FAIL' ? 'Recorded as FAIL: the machine should not be used until it passes.' : null;
      }}>
      {([['discTeethOk', 'Disc teeth in good condition'], ['discSpacingOk', 'Disc spacing correct'], ['cleaningDone', 'Machine cleaned']] as const).map(([k, label]) => (
        <FormControlLabel key={k} label={label} control={<Checkbox checked={c[k]} onChange={(e) => setC({ ...c, [k]: e.target.checked })} sx={{ '& svg': { fontSize: 32 } }} />} />
      ))}
      <TextField label="Disc spacing (mm, optional)" value={spacing} onChange={(e) => setSpacing(e.target.value)} />
    </StepDialog>
  );
}

function MachinesTab() {
  const q = useQuery({ queryKey: ['units', 'pulping/machines'], queryFn: () => processingApi.units('pulping/machines') });
  const [checking, setChecking] = useState<Unit | null>(null);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: STATION_TIMEZONE }).format(new Date()); // station business day
  return (
    <>
      <ErrorAlert error={q.error} />
      {q.data?.length === 0 && <EmptyState title="No pulping machines registered" message="Add them on the Setup tab." />}
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(3, minmax(0, 1fr))' } }}>
        {q.data?.map((m) => {
          const checkedToday = m.lastInspection?.inspection_date === today;
          const ok = checkedToday && m.lastInspection?.result === 'PASS';
          return (
            <Card key={m.id} component="article" aria-label={`Pulper ${m.code}`} sx={{ borderTop: 4, borderTopColor: ok ? 'success.main' : 'warning.main' }}>
              <CardContent>
                <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <Typography variant="h6" component="h2">{m.code}</Typography>
                  <StatusChip status={m.status} domain="equipment" />
                </Stack>
                <Typography color="text.secondary" variant="body2" gutterBottom>{m.name}</Typography>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mt: 1 }}>
                  {m.lastInspection
                    ? <><StatusChip status={m.lastInspection.result} domain="checkResult" /><Typography variant="body2">{checkedToday ? 'Checked today' : `Last check ${m.lastInspection.inspection_date}`}</Typography></>
                    : <Typography variant="body2" color="text.secondary">Never checked</Typography>}
                </Stack>
              </CardContent>
              <CardActions sx={{ px: 2, pb: 2 }}>
                <Can permission="pulping:record"><Button variant="contained" onClick={() => setChecking(m)} disabled={checkedToday}>{checkedToday ? 'Checked today' : 'Daily check'}</Button></Can>
              </CardActions>
            </Card>
          );
        })}
      </Box>
      {checking && <MachineCheckDialog machine={checking} onClose={() => setChecking(null)} />}
    </>
  );
}

// ---------------------------------------------------------------- reconciliation

/** Purchased vs hopper intake as two labelled bars on one scale. */
function PurchasedVsIntake({ r }: { r: Reconciliation }) {
  const max = Math.max(Number(r.purchasedCherryKg), Number(r.hopperIntakeKg), 1);
  const bar = (label: string, kg: string, color: string) => (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
        <Typography variant="caption" color="text.secondary">{label}</Typography>
        <Typography variant="caption"><WeightText value={kg} dp={0} /></Typography>
      </Stack>
      <Box sx={{ height: 10, bgcolor: 'action.hover', borderRadius: 1, overflow: 'hidden' }}>
        <Box sx={{ height: '100%', width: `${(Number(kg) / max) * 100}%`, bgcolor: color, borderRadius: 1 }} />
      </Box>
    </Box>
  );
  return <Stack spacing={1}>{bar('Purchased', r.purchasedCherryKg, 'primary.main')}{bar('Hopper intake', r.hopperIntakeKg, 'secondary.main')}</Stack>;
}

/** Day cards (spec §7): purchased vs intake, difference %, status and review. */
function ReconciliationTab() {
  const qc = useQueryClient();
  const [date, setDate] = useState('');
  const [open, setOpen] = useState<Reconciliation | null>(null);
  const [reviewing, setReviewing] = useState<Reconciliation | null>(null);
  const q = useQuery({ queryKey: ['reconciliations'], queryFn: () => processingApi.reconciliations({ page: 1, pageSize: 60 }), placeholderData: keepPreviousData });
  const run = useMutation({ mutationFn: () => processingApi.runReconciliation(date || undefined), onSuccess: (r) => { setOpen(r); qc.invalidateQueries({ queryKey: ['reconciliations'] }); } });
  type Detail = Reconciliation['detail'][number];
  const detailCols: GridColDef<Detail>[] = [
    { field: 'lotNumber', headerName: 'Lot', minWidth: 150 },
    { field: 'purchasedKg', headerName: 'Purchased (kg)', align: 'right', headerAlign: 'right', minWidth: 130, renderCell: (p) => <WeightText value={p.row.purchasedKg} hideUnit /> },
    { field: 'intakeKg', headerName: 'Intake (kg)', align: 'right', headerAlign: 'right', minWidth: 120, renderCell: (p) => <WeightText value={p.row.intakeKg} hideUnit /> },
    { field: 'differenceKg', headerName: 'Difference', align: 'right', headerAlign: 'right', minWidth: 170, renderCell: (p) => <span><WeightText value={p.row.differenceKg} /> · <PercentText value={p.row.differencePct} dp={1} /></span> },
    { field: 'flagged', headerName: '', minWidth: 100, renderCell: (p) => p.row.flagged && <StatusChip status="DISCREPANCY" domain="reconciliation" label="Flagged" /> },
  ];
  return (
    <>
      <Can permission="reconciliation:run">
        <Stack direction="row" spacing={1} sx={{ mb: 2, alignItems: 'flex-start' }}>
          <DatePicker label="Day" value={date ? dayjs(date) : null} onChange={(d) => setDate(d && d.isValid() ? d.format('YYYY-MM-DD') : '')} disableFuture
            slotProps={{ textField: { size: 'small', helperText: 'Empty = today' }, field: { clearable: true } }} />
          <Button variant="contained" onClick={() => run.mutate()} disabled={run.isPending}>Run reconciliation</Button>
        </Stack>
      </Can>
      <ErrorAlert error={q.error ?? run.error} />
      {run.data && caMessage(run.data.correctiveAction) && <Alert severity="warning" sx={{ mb: 2 }}>{caMessage(run.data.correctiveAction)}</Alert>}
      {q.isLoading && <Loading />}
      {q.data?.data.length === 0 && <EmptyState title="No reconciliations yet" message="They also run automatically every evening." />}
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(3, minmax(0, 1fr))' } }}>
        {q.data?.data.map((r) => (
          <Card key={r.id} component="article" aria-label={`Reconciliation ${r.reconDate}`}>
            <CardContent>
              <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
                <Typography variant="h6" component="h2">{r.reconDate}</Typography>
                <StatusChip status={r.status} domain="reconciliation" />
              </Stack>
              <PurchasedVsIntake r={r} />
              <Typography variant="body2" sx={{ mt: 1.5 }}>
                Difference <strong><WeightText value={r.differenceKg} dp={0} /> · <PercentText value={r.differencePct} dp={1} /></strong>
                <Typography component="span" variant="caption" color="text.secondary"> (tolerance <PercentText value={r.tolerancePct} dp={1} />)</Typography>
              </Typography>
            </CardContent>
            <CardActions sx={{ px: 2, pb: 2 }}>
              <Button onClick={() => setOpen(r)}>Lots</Button>
              {r.status === 'DISCREPANCY' && <Can permission="reconciliation:review"><Button variant="contained" onClick={() => setReviewing(r)}>Review</Button></Can>}
            </CardActions>
          </Card>
        ))}
      </Box>
      {open && (
        <Dialog open onClose={() => setOpen(null)} fullWidth maxWidth="md">
          <DialogTitle>Reconciliation {open.reconDate}</DialogTitle>
          <DialogContent>
            {open.reviewNotes && <Alert severity="info" sx={{ mb: 2 }}>Reviewed by {open.reviewedByName}: {open.reviewNotes}</Alert>}
            <DataTable label={`Lots of ${open.reconDate}`} rows={open.detail} columns={detailCols} getRowId={(d) => d.lotNumber} empty={{ title: 'No lots that day' }} />
          </DialogContent>
          <DialogActions><Button onClick={() => setOpen(null)}>Close</Button></DialogActions>
        </Dialog>
      )}
      {reviewing && (
        <ReasonDialog open title={`Review discrepancy of ${reviewing.reconDate}`} message="Explain the difference (e.g. moisture loss, re-weighing) — recorded in the audit log."
          confirmLabel="Mark reviewed" onClose={() => setReviewing(null)}
          onConfirm={async (notes) => { await processingApi.reviewReconciliation(reviewing.id, notes); await qc.invalidateQueries({ queryKey: ['reconciliations'] }); }} />
      )}
    </>
  );
}

// ---------------------------------------------------------------- setup

const KINDS: { kind: UnitKind; label: string; capacity: boolean }[] = [
  { kind: 'hoppers', label: 'Hoppers', capacity: true },
  { kind: 'pulping/machines', label: 'Pulping machines', capacity: false },
  { kind: 'fermentation/tanks', label: 'Fermentation tanks', capacity: true },
];

function SetupTab() {
  const [adding, setAdding] = useState<(typeof KINDS)[number] | null>(null);
  const [f, setF] = useState({ code: '', name: '', capacityKg: '', location: '' });
  return (
    <>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>Each unit is also listed under Equipment, where its maintenance and status are managed.</Typography>
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' }, alignItems: 'start' }}>
        {KINDS.map((k) => <UnitList key={k.kind} kind={k} onAdd={() => { setF({ code: '', name: '', capacityKg: '', location: '' }); setAdding(k); }} />)}
      </Box>
      {adding && (
        <StepDialog title={`Register · ${adding.label}`} onClose={() => setAdding(null)}
          valid={!!f.code.trim() && f.name.trim().length >= 2 && (!adding.capacity || isDecimal(f.capacityKg))}
          onSubmit={async () => {
            await processingApi.createUnit(adding.kind, { code: f.code, name: f.name, location: f.location.trim() || null, ...(adding.capacity ? { capacityKg: f.capacityKg } : {}) });
          }}>
          <TextField label="Code" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} helperText="e.g. H-01, P-01, T-01" />
          <TextField label="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          {adding.capacity && <TextField label="Capacity (kg)" value={f.capacityKg} onChange={(e) => setF({ ...f, capacityKg: e.target.value })} />}
          <TextField label="Location" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} />
        </StepDialog>
      )}
    </>
  );
}

function UnitList({ kind, onAdd }: { kind: (typeof KINDS)[number]; onAdd: () => void }) {
  const q = useQuery({ queryKey: ['units', kind.kind], queryFn: () => processingApi.units(kind.kind) });
  return (
    <SectionCard title={kind.label} actions={<Can permission="equipment:manage"><Button size="small" startIcon={<AddIcon />} onClick={onAdd}>Add</Button></Can>}>
      <ErrorAlert error={q.error} />
      {q.data?.length === 0 && <Typography variant="body2" color="text.secondary">None yet.</Typography>}
      <Stack spacing={1.5}>
        {q.data?.map((u) => (
          <Stack key={u.id} direction="row" spacing={1} sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <Field label={u.code}>{u.name}{u.capacityKg ? <> · <WeightText value={u.capacityKg} dp={0} /></> : null}</Field>
            <StatusChip status={u.status} domain="equipment" />
          </Stack>
        ))}
      </Stack>
    </SectionCard>
  );
}

/** Wet processing: lot board by stage and the station's hoppers, pulpers, tanks and daily reconciliation. */
export function ProcessingPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const tabs = [
    can('lot:read') && { value: 'board', label: 'Board', el: <Board /> },
    can('fermentation:read') && { value: 'fermentation', label: 'Fermentation tanks', el: <FermentationTab /> },
    can('pulping:read') && { value: 'machines', label: 'Pulper checks', el: <MachinesTab /> },
    can('reconciliation:read') && { value: 'reconciliation', label: 'Reconciliation', el: <ReconciliationTab /> },
    can(['hopper:read', 'pulping:read', 'fermentation:read']) && { value: 'setup', label: 'Setup', el: <SetupTab /> },
  ].filter((t): t is { value: string; label: string; el: React.ReactElement } => !!t);
  const current = tabs.find((t) => t.value === params.get('tab')) ?? tabs[0];
  return (
    <ListTemplate title="Wet processing" subtitle="Hopper → flotation → pulping → fermentation → washing → grading">
      <Tabs value={current?.value ?? false} onChange={(_, v: string) => setParams({ tab: v })} variant="scrollable" allowScrollButtonsMobile
        sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
        {tabs.map((t) => <Tab key={t.value} value={t.value} label={t.label} />)}
      </Tabs>
      {current?.el}
    </ListTemplate>
  );
}
