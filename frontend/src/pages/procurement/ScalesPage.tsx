import AddIcon from '@mui/icons-material/Add';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import {
  Alert, Button, Card, CardActions, CardContent, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Grid, MenuItem,
  Radio, RadioGroup, Stack, TextField, Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { scalesApi, type Scale } from '../../api/procurement';
import { settingsApi } from '../../api/endpoints';
import { Can } from '../../auth/Can';
import { useAuth } from '../../auth/useAuth';
import { ErrorAlert, Field, Loading, PageHeader, StatusChip } from '../../components/common';
import { SimpleTable } from '../../components/SimpleTable';
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
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>{scale.code} — verification history</DialogTitle>
      <DialogContent>
        <ErrorAlert error={q.error} />
        {q.isLoading ? <Loading /> : (
          <SimpleTable rows={q.data ?? []} cols={[['calibratedAt', 'When'], ['type', 'Type'], ['standardWeightKg', 'Standard'], ['readingKg', 'Reading'], ['deviationKg', 'Deviation'], ['result', 'Result'], ['performedByName', 'By'], ['caNumber', 'CA']]} />
        )}
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

/** Scale status board + daily verification [MANUAL: daily]. */
export function ScalesPage() {
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['scales'], queryFn: scalesApi.list, refetchInterval: 60_000 });
  const tolerance = useQuery({ queryKey: ['settings', 'all'], queryFn: settingsApi.list, enabled: can('settings:read'), select: (s) => s.find((x) => x.key === 'scale.verificationToleranceKg')?.value ?? null });
  const [verifying, setVerifying] = useState<Scale | null>(null);
  const [history, setHistory] = useState<Scale | null>(null);
  const [creating, setCreating] = useState(false);
  const unverified = q.data?.filter((s) => !s.verification.verified).length ?? 0;

  return (
    <>
      <PageHeader title="Scales" subtitle="Daily verification before weighing. Unverified scales cannot be used unless the site allows it (scale.unverifiedPolicy)."
        actions={<Can permission="scale:manage"><Button variant="outlined" startIcon={<AddIcon />} onClick={() => setCreating(true)}>Register scale</Button></Can>} />
      <ErrorAlert error={q.error} />
      {unverified > 0 && <Alert severity="warning" sx={{ mb: 2 }}>{unverified} scale{unverified === 1 ? '' : 's'} need verification today.</Alert>}
      {q.isLoading && <Loading />}
      {q.data?.length === 0 && <Typography color="text.secondary">No scales registered yet.</Typography>}
      <Grid container spacing={2}>
        {q.data?.map((s) => (
          <Grid key={s.id} size={{ xs: 12, sm: 6, lg: 4 }}>
            <Card variant="outlined" sx={{ borderColor: s.verification.verified ? 'success.main' : 'error.main', borderWidth: 2 }}>
              <CardContent>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
                  {s.verification.verified ? <CheckCircleIcon color="success" /> : <ErrorIcon color="error" />}
                  <Typography variant="h6" sx={{ flexGrow: 1 }}>{s.code}</Typography>
                  <StatusChip status={s.status} label={humanize(s.status)} />
                </Stack>
                <Typography color="text.secondary" gutterBottom>{s.name}{s.location ? ` · ${s.location}` : ''}</Typography>
                <Stack direction="row" spacing={3}>
                  <Field label="Capacity">{s.capacityKg} kg</Field>
                  <Field label="Last check">{s.lastVerifiedAt ? `${s.lastResult} · ${formatDateTime(s.lastVerifiedAt)}` : 'Never'}</Field>
                </Stack>
                <Typography variant="body2" sx={{ mt: 1 }} color={s.verification.verified ? 'success.main' : 'error.main'}>
                  {s.verification.verified ? `Verified until ${formatDateTime(s.verification.validUntil)}` : REASONS[s.verification.reason ?? ''] ?? 'Not verified'}
                </Typography>
              </CardContent>
              <CardActions>
                <Can permission="scale:verify"><Button variant="contained" size="large" onClick={() => setVerifying(s)} disabled={s.status === 'DECOMMISSIONED'}>Verify now</Button></Can>
                <Button onClick={() => setHistory(s)}>History</Button>
              </CardActions>
            </Card>
          </Grid>
        ))}
      </Grid>
      {verifying && <VerifyDialog scale={verifying} toleranceSet={tolerance.data !== null && tolerance.data !== undefined} onClose={() => setVerifying(null)} />}
      {history && <HistoryDialog scale={history} onClose={() => setHistory(null)} />}
      {creating && <NewScaleDialog onClose={() => setCreating(false)} />}
    </>
  );
}
