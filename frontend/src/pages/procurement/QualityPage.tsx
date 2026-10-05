import AddIcon from '@mui/icons-material/Add';
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, List, ListItem, ListItemText, MenuItem, Stack, Switch, Tab,
  Tabs, TextField,
} from '@mui/material';
import type { GridColDef } from '@mui/x-data-grid';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import { qualityApi, type Hold, type Inspection, type QualityRule } from '../../api/procurement';
import { Can } from '../../auth/Can';
import { useAuth } from '../../auth/useAuth';
import { columns as col, DataTable, ErrorAlert, ReasonDialog, SectionCard, StatusChip, useTableQuery, useUrlFilters } from '../../components';
import { ListTemplate } from '../../templates';
import { isDecimal } from '../../utils/decimal';
import { humanize } from '../../utils/format';
import { CompositionBar } from './InspectionFormPage';

const METRICS = ['RED_RIPE_PCT', 'GREEN_UNRIPE_PCT', 'OVERRIPE_DAMAGED_PCT'] as const;
const OPERATORS = { LT: '<', LTE: '≤', GT: '>', GTE: '≥' } as const;
const pctOk = (v: string) => isDecimal(v, 2) && Number(v) >= 0 && Number(v) <= 100;

// ---------------------------------------------------------------- inspections

function InspectionsTab() {
  const { table, apiParams } = useTableQuery();
  const { get } = useUrlFilters();
  const decision = get('decision') || undefined;
  const q = useQuery({
    queryKey: ['inspections', apiParams, decision],
    queryFn: () => qualityApi.inspections({ ...apiParams, decision }),
    placeholderData: keepPreviousData,
  });
  const columns: GridColDef<Inspection>[] = [
    { field: 'inspectionNo', headerName: 'Inspection', minWidth: 150 },
    col.dateTime<Inspection>('inspectedAt', 'When'),
    { field: 'supplierName', headerName: 'Supplier', flex: 1, minWidth: 180, valueGetter: (_v, i) => `${i.supplierName} (${i.supplierCode})` },
    {
      field: 'composition', headerName: 'Red / green / overripe', minWidth: 220, sortable: false,
      valueGetter: (_v, i) => `${i.redRipePct} / ${i.greenUnripePct} / ${i.overripeDamagedPct}`,
      renderCell: (p) => <Box sx={{ width: '100%' }}><CompositionBarSmall i={p.row} /></Box>,
    },
    {
      field: 'decision', headerName: 'Decision', minWidth: 190,
      renderCell: (p) => (
        <Stack direction="row" spacing={0.5}>
          <StatusChip status={p.row.decision} domain="inspection" />
          {p.row.ruleEvaluation.outcome === 'WARN' && <StatusChip status="WARN" domain="inspection" label="Warning" />}
        </Stack>
      ),
    },
    { field: 'voucherNo', headerName: 'Voucher', minWidth: 140, valueGetter: (_v, i) => i.voucherNo ?? (i.decision === 'ACCEPTED' ? 'Available' : '—') },
  ];
  return (
    <>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2, justifyContent: 'space-between' }}>
        <InspectionFilters />
        <Can permission="quality:inspect">
          <Box><Button variant="contained" startIcon={<AddIcon />} component={RouterLink} to="/quality/inspections/new">New inspection</Button></Box>
        </Can>
      </Stack>
      <ErrorAlert error={q.error} />
      <DataTable label="Inspections" loading={q.isFetching} rows={q.data?.data ?? []} columns={columns}
        server={{ state: table, rowCount: q.data?.meta.total ?? 0, sortFields: ['inspectedAt'] }}
        empty={{ title: 'No inspections yet', message: 'Inspect cherry before it is weighed and bought.' }} />
    </>
  );
}

function InspectionFilters() {
  const { get, set } = useUrlFilters();
  return (
    <TextField size="small" select label="Decision" value={get('decision')} onChange={(e) => set({ decision: e.target.value })} sx={{ minWidth: 160 }}>
      <MenuItem value="">All</MenuItem><MenuItem value="ACCEPTED">Accepted</MenuItem><MenuItem value="REJECTED">Rejected</MenuItem>
    </TextField>
  );
}

/** Compact version of the composition bar for table rows. */
function CompositionBarSmall({ i }: { i: Inspection }) {
  return <CompositionBar compact values={{ RED_RIPE_PCT: i.redRipePct, GREEN_UNRIPE_PCT: i.greenUnripePct, OVERRIPE_DAMAGED_PCT: i.overripeDamagedPct }} />;
}

// ---------------------------------------------------------------- holds

function HoldsTab() {
  const qc = useQueryClient();
  const { get, set } = useUrlFilters();
  const status = get('holdStatus') || 'ACTIVE';
  const [placing, setPlacing] = useState(false);
  const [lotNumber, setLotNumber] = useState('');
  const [releasing, setReleasing] = useState<Hold | null>(null);
  const q = useQuery({ queryKey: ['holds', status], queryFn: () => qualityApi.holds({ page: 1, pageSize: 100, status: status === 'ALL' ? undefined : status }) });
  const columns: GridColDef<Hold>[] = [
    { field: 'lotNumber', headerName: 'Lot', minWidth: 150 },
    { field: 'stage', headerName: 'Stage', minWidth: 130, valueFormatter: (v: string) => humanize(v) },
    { field: 'reason', headerName: 'Reason', flex: 1, minWidth: 220, valueGetter: (_v, h) => (h.releaseNotes ? `${h.reason} — released: ${h.releaseNotes}` : h.reason) },
    col.dateTime<Hold>('placedAt', 'Placed'),
    { field: 'placedByName', headerName: 'By', minWidth: 140 },
    col.status<Hold>('status', 'Status', 'hold'),
    {
      field: 'actions', headerName: '', sortable: false, minWidth: 110, align: 'right', disableExport: true,
      renderCell: (p) => p.row.status === 'ACTIVE' && <Can permission="quality:hold-release"><Button size="small" onClick={(e) => { e.stopPropagation(); setReleasing(p.row); }}>Release</Button></Can>,
    },
  ];
  return (
    <>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2, justifyContent: 'space-between' }}>
        <TextField size="small" select label="Status" value={status} onChange={(e) => set({ holdStatus: e.target.value === 'ACTIVE' ? '' : e.target.value })} sx={{ minWidth: 160 }}>
          <MenuItem value="ALL">All</MenuItem><MenuItem value="ACTIVE">Active</MenuItem><MenuItem value="RELEASED">Released</MenuItem>
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
      <DataTable label="Quality holds" loading={q.isLoading} rows={q.data?.data ?? []} columns={columns}
        empty={{ title: status === 'ACTIVE' ? 'No active holds' : 'No holds' }} />
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
    <Stack spacing={3}>
      <ErrorAlert error={rules.error ?? toggle.error} />
      <SectionCard title="Quality rules" subtitle="Applied by the server to every inspection." disablePadding
        actions={manage && <Button variant="outlined" startIcon={<AddIcon />} onClick={() => setCreating(true)}>New rule</Button>}>
        {rules.data?.length === 0 && <Alert severity="info" sx={{ mx: 2.5, mb: 2 }}>No rules configured: the inspector decides alone (setting to confirm with the manual).</Alert>}
        <List disablePadding>
          {rules.data?.map((r) => (
            <ListItem key={r.id} divider sx={{ px: 2.5, gap: 2, flexWrap: 'wrap' }}>
              <ListItemText primary={r.name} secondary={`${humanize(r.metric)} ${OPERATORS[r.operator]} ${r.threshold} %`} />
              <StatusChip status={r.action} domain="qualityRule" />
              <FormControlLabel sx={{ mr: 0 }} label={r.isActive ? 'Active' : 'Inactive'} control={<Switch checked={r.isActive} disabled={!manage || toggle.isPending} onChange={() => toggle.mutate(r)} />} />
            </ListItem>
          ))}
        </List>
      </SectionCard>
      <SectionCard title="Grades and coffee types">
        <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
          {grades.data?.map((g) => <StatusChip key={g.id} status={g.isActive ? 'ACTIVE' : 'INACTIVE'} domain="supplier" label={`${humanize(g.stage)} ${g.code} · ${g.name}`} />)}
          {types.data?.map((t) => <StatusChip key={t.id} status={t.isActive ? 'ACTIVE' : 'INACTIVE'} domain="supplier" label={`Type ${t.code} · ${t.name}`} />)}
        </Stack>
      </SectionCard>
      {creating && <RuleDialog onClose={() => setCreating(false)} />}
    </Stack>
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
    <ListTemplate title="Quality" subtitle="Cherry inspection before purchase, quality holds and rules">
      <Tabs value={current?.value ?? false} onChange={(_, v: string) => setParams({ tab: v })} variant="scrollable" sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
        {tabs.map((t) => <Tab key={t.value} value={t.value} label={t.label} />)}
      </Tabs>
      {current?.el}
    </ListTemplate>
  );
}
