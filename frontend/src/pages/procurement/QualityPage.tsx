import AddIcon from '@mui/icons-material/Add';
import {
  Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, MenuItem, Paper, Radio, RadioGroup, Stack, Switch, Tab,
  Table, TableBody, TableCell, TableContainer, TableHead, TablePagination, TableRow, Tabs, TextField, Typography,
} from '@mui/material';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { qualityApi, type Hold, type QualityRule, type Supplier } from '../../api/procurement';
import { useAuth } from '../../auth/useAuth';
import { Can } from '../../auth/Can';
import { ErrorAlert, Loading, PageHeader, StatusChip } from '../../components/common';
import { ReasonDialog } from '../../components/ReasonDialog';
import { SupplierPicker } from '../../components/SupplierPicker';
import { add, isDecimal } from '../../utils/decimal';
import { formatDateTime, humanize } from '../../utils/format';

const METRICS = ['RED_RIPE_PCT', 'GREEN_UNRIPE_PCT', 'OVERRIPE_DAMAGED_PCT'] as const;
const OPERATORS = { LT: '<', LTE: '≤', GT: '>', GTE: '≥' } as const;
const pctOk = (v: string) => isDecimal(v, 2) && Number(v) >= 0 && Number(v) <= 100;

// ---------------------------------------------------------------- inspections

function InspectionDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [red, setRed] = useState('');
  const [green, setGreen] = useState('');
  const [over, setOver] = useState('');
  const [gradeId, setGradeId] = useState('');
  const [decision, setDecision] = useState<'ACCEPTED' | 'REJECTED'>('ACCEPTED');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const grades = useQuery({ queryKey: ['grades', 'CHERRY'], queryFn: () => qualityApi.grades('CHERRY') });
  const m = useMutation({
    mutationFn: () => qualityApi.inspect({
      supplierId: supplier!.id, redRipePct: red, greenUnripePct: green, overripeDamagedPct: over, decision,
      qualityGradeId: gradeId || null, rejectionReason: decision === 'REJECTED' ? reason : null, notes: notes.trim() || null,
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inspections'] }),
  });
  const all = [red, green, over];
  const sum = all.every(pctOk) ? add(all, 2) : null;
  const valid = !!supplier && all.every(pctOk) && (decision === 'ACCEPTED' || reason.trim().length >= 3);

  if (m.data) {
    const r = m.data;
    return (
      <Dialog open onClose={onClose} fullWidth maxWidth="sm">
        <DialogTitle>Inspection {r.inspectionNo}</DialogTitle>
        <DialogContent>
          <Alert severity={r.decision === 'ACCEPTED' ? (r.ruleEvaluation.outcome === 'WARN' ? 'warning' : 'success') : 'error'} sx={{ mb: 2 }}>
            {r.decision === 'ACCEPTED' ? 'Cherry ACCEPTED — the purchasing clerk can now weigh and create the voucher.' : `Cherry REJECTED: ${r.rejectionReason}`}
            {r.ruleEvaluation.forcedRejection && ' (a REJECT rule overrode the decision)'}
          </Alert>
          {r.ruleEvaluation.results.filter((x) => x.triggered).map((x) => <Typography key={x.name} variant="body2">• {x.name} ({x.action})</Typography>)}
        </DialogContent>
        <DialogActions><Button variant="contained" onClick={onClose}>Done</Button></DialogActions>
      </Dialog>
    );
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Cherry quality inspection</DialogTitle>
      <DialogContent>
        <ErrorAlert error={m.error} />
        <Stack spacing={2} sx={{ mt: 1 }}>
          <SupplierPicker value={supplier} onChange={setSupplier} />
          <Stack direction="row" spacing={2}>
            {([['Red ripe %', red, setRed], ['Green / unripe %', green, setGreen], ['Overripe / damaged %', over, setOver]] as const).map(([label, v, set]) => (
              <TextField key={label} label={label} value={v} onChange={(e) => set(e.target.value)} error={!!v && !pctOk(v)}
                slotProps={{ htmlInput: { inputMode: 'decimal' } }} fullWidth />
            ))}
          </Stack>
          {sum && <Typography variant="body2" color={Math.abs(Number(sum) - 100) > 0.5 ? 'error' : 'text.secondary'}>Sum: {sum} % (must be 100 within the configured tolerance)</Typography>}
          <TextField select label="Cherry grade (optional)" value={gradeId} onChange={(e) => setGradeId(e.target.value)}>
            <MenuItem value="">—</MenuItem>
            {grades.data?.filter((g) => g.isActive).map((g) => <MenuItem key={g.id} value={g.id}>{g.code} · {g.name}</MenuItem>)}
          </TextField>
          <RadioGroup row value={decision} onChange={(e) => setDecision(e.target.value as 'ACCEPTED' | 'REJECTED')}>
            <FormControlLabel value="ACCEPTED" control={<Radio />} label="Accept" />
            <FormControlLabel value="REJECTED" control={<Radio />} label="Reject" />
          </RadioGroup>
          {decision === 'REJECTED' && <TextField label="Rejection reason" value={reason} onChange={(e) => setReason(e.target.value)} required />}
          <TextField label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} multiline minRows={2} />
          <Typography variant="caption" color="text.secondary">Active quality rules are applied by the server: a REJECT rule rejects the cherry even if you accept it.</Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={!valid || m.isPending} onClick={() => m.mutate()}>Record inspection</Button>
      </DialogActions>
    </Dialog>
  );
}

function InspectionsTab() {
  const [page, setPage] = useState(0);
  const [decision, setDecision] = useState('');
  const [creating, setCreating] = useState(false);
  const q = useQuery({
    queryKey: ['inspections', { page, decision }],
    queryFn: () => qualityApi.inspections({ page: page + 1, pageSize: 25, decision: decision || undefined }),
    placeholderData: keepPreviousData,
  });
  return (
    <>
      <Stack direction="row" spacing={2} sx={{ mb: 2, justifyContent: 'space-between' }}>
        <TextField size="small" select label="Decision" value={decision} onChange={(e) => { setDecision(e.target.value); setPage(0); }} sx={{ minWidth: 160 }}>
          <MenuItem value="">All</MenuItem><MenuItem value="ACCEPTED">Accepted</MenuItem><MenuItem value="REJECTED">Rejected</MenuItem>
        </TextField>
        <Can permission="quality:inspect"><Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreating(true)}>New inspection</Button></Can>
      </Stack>
      <ErrorAlert error={q.error} />
      <Paper variant="outlined">
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Inspection</TableCell><TableCell>When</TableCell><TableCell>Supplier</TableCell>
                <TableCell align="right">Red / green / overripe %</TableCell><TableCell>Decision</TableCell><TableCell>Voucher</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {q.isLoading && <TableRow><TableCell colSpan={6}><Loading /></TableCell></TableRow>}
              {q.data?.data.map((i) => (
                <TableRow key={i.id}>
                  <TableCell>{i.inspectionNo}</TableCell>
                  <TableCell>{formatDateTime(i.inspectedAt)}</TableCell>
                  <TableCell>{i.supplierName} <Typography variant="caption" color="text.secondary">{i.supplierCode}</Typography></TableCell>
                  <TableCell align="right">{i.redRipePct} / {i.greenUnripePct} / {i.overripeDamagedPct}</TableCell>
                  <TableCell>
                    <StatusChip status={i.decision} label={humanize(i.decision)} />
                    {i.ruleEvaluation.outcome === 'WARN' && <StatusChip status="WARN" label="Warning" />}
                  </TableCell>
                  <TableCell>{i.voucherNo ?? (i.decision === 'ACCEPTED' ? 'Available' : '—')}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination component="div" count={q.data?.meta.total ?? 0} page={page} rowsPerPage={25} rowsPerPageOptions={[25]} onPageChange={(_, p) => setPage(p)} />
      </Paper>
      {creating && <InspectionDialog onClose={() => setCreating(false)} />}
    </>
  );
}

// ---------------------------------------------------------------- holds

function HoldsTab() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('ACTIVE');
  const [placing, setPlacing] = useState(false);
  const [lotNumber, setLotNumber] = useState('');
  const [releasing, setReleasing] = useState<Hold | null>(null);
  const q = useQuery({ queryKey: ['holds', status], queryFn: () => qualityApi.holds({ page: 1, pageSize: 100, status: status || undefined }) });
  return (
    <>
      <Stack direction="row" spacing={2} sx={{ mb: 2, justifyContent: 'space-between' }}>
        <TextField size="small" select label="Status" value={status} onChange={(e) => setStatus(e.target.value)} sx={{ minWidth: 160 }}>
          <MenuItem value="">All</MenuItem><MenuItem value="ACTIVE">Active</MenuItem><MenuItem value="RELEASED">Released</MenuItem>
        </TextField>
        <Can permission="quality:hold">
          <Stack direction="row" spacing={1}>
            <TextField size="small" label="Lot number" value={lotNumber} onChange={(e) => setLotNumber(e.target.value)} />
            <Button variant="contained" color="error" disabled={lotNumber.trim().length < 3} onClick={() => setPlacing(true)}>Place hold</Button>
          </Stack>
        </Can>
      </Stack>
      <Alert severity="info" sx={{ mb: 2 }}>A hold stops every processing step of the lot and of its grade lots until it is released.</Alert>
      <ErrorAlert error={q.error} />
      <Paper variant="outlined">
        <TableContainer>
          <Table size="small">
            <TableHead><TableRow><TableCell>Lot</TableCell><TableCell>Stage</TableCell><TableCell>Reason</TableCell><TableCell>Placed</TableCell><TableCell>Status</TableCell><TableCell /></TableRow></TableHead>
            <TableBody>
              {q.isLoading && <TableRow><TableCell colSpan={6}><Loading /></TableCell></TableRow>}
              {q.data?.data.map((h) => (
                <TableRow key={h.id}>
                  <TableCell>{h.lotNumber}</TableCell>
                  <TableCell>{humanize(h.stage)}</TableCell>
                  <TableCell>{h.reason}{h.releaseNotes && <Typography variant="caption" component="div" color="text.secondary">Released: {h.releaseNotes}</Typography>}</TableCell>
                  <TableCell>{formatDateTime(h.placedAt)} · {h.placedByName}</TableCell>
                  <TableCell><StatusChip status={h.status === 'ACTIVE' ? 'ON_HOLD' : 'RELEASED'} label={humanize(h.status)} /></TableCell>
                  <TableCell align="right">{h.status === 'ACTIVE' && <Can permission="quality:hold-release"><Button size="small" onClick={() => setReleasing(h)}>Release</Button></Can>}</TableCell>
                </TableRow>
              ))}
              {q.data?.data.length === 0 && <TableRow><TableCell colSpan={6}><Typography color="text.secondary" sx={{ p: 2 }}>No holds.</Typography></TableCell></TableRow>}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
      {placing && (
        <ReasonDialog open title={`Hold lot ${lotNumber.trim()}`} confirmLabel="Place hold" danger onClose={() => setPlacing(false)}
          onConfirm={async (reason) => { await qualityApi.placeHold(lotNumber.trim(), reason); setLotNumber(''); await qc.invalidateQueries({ queryKey: ['holds'] }); }} />
      )}
      {releasing && (
        <ReasonDialog open title={`Release hold on ${releasing.lotNumber}`} message="Describe why the lot may continue." confirmLabel="Release" onClose={() => setReleasing(null)}
          onConfirm={async (notes) => { await qualityApi.releaseHold(releasing.id, notes); await qc.invalidateQueries({ queryKey: ['holds'] }); }} />
      )}
    </>
  );
}

// ---------------------------------------------------------------- rules & reference data

function RuleDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [r, setR] = useState<Omit<QualityRule, 'id' | 'isActive'>>({ name: '', metric: 'GREEN_UNRIPE_PCT', operator: 'GT', threshold: '', action: 'REJECT', description: null });
  const m = useMutation({ mutationFn: () => qualityApi.createRule(r), onSuccess: () => { qc.invalidateQueries({ queryKey: ['quality-rules'] }); onClose(); } });
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>New quality rule</DialogTitle>
      <DialogContent>
        <ErrorAlert error={m.error} />
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField label="Name" value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} />
          <Stack direction="row" spacing={2}>
            <TextField select fullWidth label="Metric" value={r.metric} onChange={(e) => setR({ ...r, metric: e.target.value as QualityRule['metric'] })}>
              {METRICS.map((x) => <MenuItem key={x} value={x}>{humanize(x)}</MenuItem>)}
            </TextField>
            <TextField select label="Operator" value={r.operator} onChange={(e) => setR({ ...r, operator: e.target.value as QualityRule['operator'] })} sx={{ minWidth: 100 }}>
              {Object.entries(OPERATORS).map(([k, v]) => <MenuItem key={k} value={k}>{v}</MenuItem>)}
            </TextField>
            <TextField label="Threshold %" value={r.threshold} onChange={(e) => setR({ ...r, threshold: e.target.value })} error={!!r.threshold && !pctOk(r.threshold)} sx={{ maxWidth: 140 }} />
          </Stack>
          <TextField select label="Action" value={r.action} onChange={(e) => setR({ ...r, action: e.target.value as QualityRule['action'] })}>
            <MenuItem value="REJECT">Reject the cherry</MenuItem><MenuItem value="WARN">Warn only</MenuItem>
          </TextField>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={r.name.trim().length < 3 || !pctOk(r.threshold) || m.isPending} onClick={() => m.mutate()}>Create</Button>
      </DialogActions>
    </Dialog>
  );
}

function RulesTab() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const [creating, setCreating] = useState(false);
  const rules = useQuery({ queryKey: ['quality-rules'], queryFn: qualityApi.rules });
  const grades = useQuery({ queryKey: ['grades', 'all'], queryFn: () => qualityApi.grades() });
  const types = useQuery({ queryKey: ['coffee-types'], queryFn: qualityApi.coffeeTypes });
  const toggle = useMutation({
    mutationFn: (r: QualityRule) => qualityApi.updateRule(r.id, { isActive: !r.isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['quality-rules'] }),
  });
  const manage = can('quality:rules-manage');
  return (
    <>
      <Stack direction="row" sx={{ mb: 2, justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Quality rules</Typography>
        {manage && <Button variant="outlined" startIcon={<AddIcon />} onClick={() => setCreating(true)}>New rule</Button>}
      </Stack>
      <ErrorAlert error={rules.error ?? toggle.error} />
      {rules.data?.length === 0 && <Alert severity="info" sx={{ mb: 2 }}>No rules configured: the inspector decides alone (setting to confirm with the manual).</Alert>}
      <Paper variant="outlined" sx={{ mb: 3 }}>
        <Table size="small">
          <TableBody>
            {rules.data?.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{r.name}</TableCell>
                <TableCell>{humanize(r.metric)} {OPERATORS[r.operator]} {r.threshold} %</TableCell>
                <TableCell><StatusChip status={r.action === 'REJECT' ? 'REJECTED' : 'WARN'} label={humanize(r.action)} /></TableCell>
                <TableCell align="right">
                  <FormControlLabel label={r.isActive ? 'Active' : 'Inactive'} control={<Switch checked={r.isActive} disabled={!manage || toggle.isPending} onChange={() => toggle.mutate(r)} />} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>
      <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>Grades and coffee types</Typography>
      <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
        {grades.data?.map((g) => <StatusChip key={g.id} status={g.isActive ? 'ACTIVE' : 'INACTIVE'} label={`${humanize(g.stage)} ${g.code} · ${g.name}`} />)}
        {types.data?.map((t) => <StatusChip key={t.id} status={t.isActive ? 'ACTIVE' : 'INACTIVE'} label={`Type ${t.code} · ${t.name}`} />)}
      </Stack>
      {creating && <RuleDialog onClose={() => setCreating(false)} />}
    </>
  );
}

/** Quality: cherry inspections, holds, rules (ARCHITECTURE.md §9.1). */
export function QualityPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const tabs = [
    can('quality:read') && { value: 'inspections', label: 'Inspections', el: <InspectionsTab /> },
    can('quality:hold-read') && { value: 'holds', label: 'Holds', el: <HoldsTab /> },
    can('quality:rules-read') && { value: 'rules', label: 'Rules & grades', el: <RulesTab /> },
  ].filter((t): t is { value: string; label: string; el: React.ReactElement } => !!t);
  const current = tabs.find((t) => t.value === params.get('tab')) ?? tabs[0];
  return (
    <>
      <PageHeader title="Quality" subtitle="Cherry inspection before purchase, quality holds and rules" />
      <Tabs value={current?.value ?? false} onChange={(_, v) => setParams({ tab: v })} sx={{ mb: 2 }}>
        {tabs.map((t) => <Tab key={t.value} value={t.value} label={t.label} />)}
      </Tabs>
      {current?.el}
    </>
  );
}
