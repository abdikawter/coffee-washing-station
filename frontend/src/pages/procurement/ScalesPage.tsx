import AddIcon from '@mui/icons-material/Add';
import {
  Alert, Box, Button, Card, CardActions, CardContent, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, MenuItem,
  Radio, RadioGroup, Stack, TextField, Typography,
} from '@mui/material';
import type { GridColDef } from '@mui/x-data-grid';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { scalesApi, type Calibration, type Scale } from '../../api/procurement';
import { settingsApi } from '../../api/endpoints';
import { Can } from '../../auth/Can';
import { useAuth } from '../../auth/useAuth';
import { columns as col, DataTable, EmptyState, ErrorAlert, Field, Loading, StatusChip, WeightText } from '../../components';
import { ListTemplate } from '../../templates';
import { isDecimal, subtract } from '../../utils/decimal';
import { formatDateTime, humanize } from '../../utils/format';

const REASONS: Record<string, string> = {
  NEVER_VERIFIED: 'Never verified', EXPIRED: 'Verification expired', LAST_CHECK_FAILED: 'Last check failed', OUT_OF_SERVICE: 'Out of service',
};

function VerifyDialog({ scale, toleranceSet, onClose }: { scale: Scale; toleranceSet: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [type, setType] = useState<'DAILY_VERIFICATION' | 'CALIBRATION'>('DAILY_VERIFICATION');
  const [standard, setStandard] = useState('20');
  const [reading, setReading] = useState('');
  const [result, setResult] = useState<'PASS' | 'FAIL' | ''>('');
  const [notes, setNotes] = useState('');
  const m = useMutation({
    mutationFn: () => scalesApi.verify(scale.id, { type, standardWeightKg: standard, readingKg: reading, ...(toleranceSet ? {} : { result: result as 'PASS' | 'FAIL' }), notes: notes.trim() || null }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scales'] }),
  });
  const valid = isDecimal(standard) && isDecimal(reading) && (toleranceSet || result !== '');
  if (m.data) {
    return (
      <Dialog open onClose={onClose} fullWidth maxWidth="xs">
        <DialogTitle>{scale.code}: {m.data.result}</DialogTitle>
        <DialogContent>
          <Alert severity={m.data.result === 'PASS' ? 'success' : 'error'}>
            Deviation {m.data.deviationKg} kg.{' '}
            {m.data.result === 'PASS' ? 'The scale may be used for weighing.' : `The scale is now out of service. Corrective action ${m.data.correctiveAction?.caNumber} was raised.`}
          </Alert>
        </DialogContent>
        <DialogActions><Button variant="contained" onClick={onClose}>Done</Button></DialogActions>
      </Dialog>
    );
  }
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Verify {scale.code}</DialogTitle>
      <DialogContent>
        <ErrorAlert error={m.error} />
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField select label="Check" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
            <MenuItem value="DAILY_VERIFICATION">Daily verification</MenuItem><MenuItem value="CALIBRATION">Calibration</MenuItem>
          </TextField>
          <TextField label="Standard weight (kg)" value={standard} onChange={(e) => setStandard(e.target.value)} slotProps={{ htmlInput: { inputMode: 'decimal' } }} />
          <TextField label="Scale reading (kg)" value={reading} onChange={(e) => setReading(e.target.value)} autoFocus slotProps={{ htmlInput: { inputMode: 'decimal' } }}
            helperText={isDecimal(reading) && isDecimal(standard) ? `Deviation ${subtract(reading, standard)} kg` : ' '} />
          {toleranceSet ? (
            <Typography variant="body2" color="text.secondary">PASS / FAIL is decided by the configured tolerance.</Typography>
          ) : (
            <>
              <Typography variant="body2" color="text.secondary">No tolerance is configured yet: record the result yourself.</Typography>
              <RadioGroup row value={result} onChange={(e) => setResult(e.target.value as 'PASS' | 'FAIL')}>
                <FormControlLabel value="PASS" control={<Radio />} label="Pass" />
                <FormControlLabel value="FAIL" control={<Radio />} label="Fail" />
              </RadioGroup>
            </>
          )}
          <TextField label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={!valid || m.isPending} onClick={() => m.mutate()}>Save</Button>
      </DialogActions>
    </Dialog>
  );
}

function HistoryDialog({ scale, onClose }: { scale: Scale; onClose: () => void }) {
  const q = useQuery({ queryKey: ['scales', scale.id, 'calibrations'], queryFn: () => scalesApi.calibrations(scale.id) });
  const columns: GridColDef<Calibration>[] = [
    col.dateTime<Calibration>('calibratedAt', 'When'),
    { field: 'type', headerName: 'Type', minWidth: 150, valueFormatter: (v: string) => humanize(v) },
    col.weight<Calibration>('standardWeightKg', 'Standard (kg)'),
    col.weight<Calibration>('readingKg', 'Reading (kg)'),
    col.weight<Calibration>('deviationKg', 'Deviation (kg)'),
    col.status<Calibration>('result', 'Result', 'checkResult', { minWidth: 100 }),
    { field: 'performedByName', headerName: 'By', minWidth: 140 },
    { field: 'caNumber', headerName: 'Corrective action', minWidth: 150 },
  ];
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="lg">
      <DialogTitle>{scale.code} — verification history</DialogTitle>
      <DialogContent>
        <ErrorAlert error={q.error} />
        <DataTable label={`${scale.code} verification history`} loading={q.isLoading} rows={q.data ?? []} columns={columns} empty={{ title: 'No checks yet' }} />
      </DialogContent>
      <DialogActions><Button onClick={onClose}>Close</Button></DialogActions>
    </Dialog>
  );
}

function NewScaleDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ code: '', name: '', capacityKg: '', location: '' });
  const m = useMutation({
    mutationFn: () => scalesApi.create({ code: f.code, name: f.name, capacityKg: f.capacityKg, location: f.location.trim() || null }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['scales'] }); onClose(); },
  });
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Register scale</DialogTitle>
      <DialogContent>
        <ErrorAlert error={m.error} />
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField label="Code" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} helperText="e.g. SC-01" />
          <TextField label="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <TextField label="Capacity (kg)" value={f.capacityKg} onChange={(e) => setF({ ...f, capacityKg: e.target.value })} />
          <TextField label="Location" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={!f.code.trim() || f.name.trim().length < 2 || !isDecimal(f.capacityKg) || m.isPending} onClick={() => m.mutate()}>Register</Button>
      </DialogActions>
    </Dialog>
  );
}

/** What the board shows for a scale: usable now, due for its check, or out of service. */
export function scaleCheck(s: Scale): 'VERIFIED' | 'DUE' | 'OUT_OF_SERVICE' {
  if (s.status === 'OUT_OF_SERVICE' || s.status === 'DECOMMISSIONED' || s.verification.reason === 'OUT_OF_SERVICE') return 'OUT_OF_SERVICE';
  return s.verification.verified ? 'VERIFIED' : 'DUE';
}

/** Scale status board (spec §7) + daily verification [MANUAL: daily]. */
export function ScalesPage() {
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['scales'], queryFn: scalesApi.list, refetchInterval: 60_000 });
  const tolerance = useQuery({ queryKey: ['settings', 'all'], queryFn: settingsApi.list, enabled: can('settings:read'), select: (s) => s.find((x) => x.key === 'scale.verificationToleranceKg')?.value ?? null });
  const [verifying, setVerifying] = useState<Scale | null>(null);
  const [history, setHistory] = useState<Scale | null>(null);
  const [creating, setCreating] = useState(false);
  const unverified = q.data?.filter((s) => !s.verification.verified).length ?? 0;
  const tone = { VERIFIED: 'success.main', DUE: 'warning.main', OUT_OF_SERVICE: 'error.main' } as const;

  return (
    <ListTemplate title="Scales" subtitle="Daily verification before weighing. Unverified scales cannot be used unless the site allows it (scale.unverifiedPolicy)."
      error={q.error}
      actions={<Can permission="scale:manage"><Button variant="outlined" startIcon={<AddIcon />} onClick={() => setCreating(true)}>Register scale</Button></Can>}>
      {unverified > 0 && <Alert severity="warning" sx={{ mb: 2 }}>{unverified} scale{unverified === 1 ? '' : 's'} need verification today.</Alert>}
      {q.isLoading && <Loading />}
      {q.data?.length === 0 && <EmptyState title="No scales registered yet" message="Register each platform scale so it can be verified daily." />}
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(3, minmax(0, 1fr))' } }}>
        {q.data?.map((s) => {
          const check = scaleCheck(s);
          return (
            <Card key={s.id} component="article" aria-label={`Scale ${s.code}`} sx={{ borderTop: 4, borderTopColor: tone[check], display: 'flex', flexDirection: 'column' }}>
              <CardContent sx={{ flexGrow: 1 }}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
                  <Typography variant="h6" component="h2" sx={{ flexGrow: 1 }}>{s.code}</Typography>
                  <StatusChip status={check} domain="scaleCheck" label={check === 'VERIFIED' ? 'Verified' : check === 'DUE' ? 'Check due' : 'Out of service'} />
                </Stack>
                <Typography color="text.secondary" variant="body2" gutterBottom>{s.name}{s.location ? ` · ${s.location}` : ''}</Typography>
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, mt: 1.5 }}>
                  <Field label="Capacity"><WeightText value={s.capacityKg} dp={0} /></Field>
                  <Field label="Last check">{s.lastVerifiedAt ? <><StatusChip status={s.lastResult ?? 'FAIL'} domain="checkResult" /> {formatDateTime(s.lastVerifiedAt)}</> : 'Never'}</Field>
                </Box>
                <Typography variant="body2" sx={{ mt: 1.5 }} color="text.secondary">
                  {s.verification.verified ? `Valid until ${formatDateTime(s.verification.validUntil)}` : REASONS[s.verification.reason ?? ''] ?? 'Not verified'}
                </Typography>
              </CardContent>
              <CardActions sx={{ px: 2, pb: 2 }}>
                <Can permission="scale:verify">
                  <Button variant={check === 'VERIFIED' ? 'outlined' : 'contained'} size="large" onClick={() => setVerifying(s)} disabled={s.status === 'DECOMMISSIONED'}>Verify now</Button>
                </Can>
                <Button onClick={() => setHistory(s)}>History</Button>
              </CardActions>
            </Card>
          );
        })}
      </Box>
      {verifying && <VerifyDialog scale={verifying} toleranceSet={tolerance.data !== null && tolerance.data !== undefined} onClose={() => setVerifying(null)} />}
      {history && <HistoryDialog scale={history} onClose={() => setHistory(null)} />}
      {creating && <NewScaleDialog onClose={() => setCreating(false)} />}
    </ListTemplate>
  );
}
