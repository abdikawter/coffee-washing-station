import {
  Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, MenuItem, Paper, Stack, Switch, Tab, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, Tabs, TextField, Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { settingsApi } from '../../api/endpoints';
import type { Setting } from '../../api/types';
import { useAuth } from '../../auth/useAuth';
import { ErrorAlert, Loading, PageHeader, StatusChip } from '../../components/common';
import { formatDateTime, formatSettingValue, humanize } from '../../utils/format';

function parseInput(s: Setting, raw: string, bool: boolean): { ok: true; value: unknown } | { ok: false; message: string } {
  switch (s.valueType) {
    case 'BOOLEAN': return { ok: true, value: bool };
    case 'NUMBER': {
      if (raw.trim() === '' || Number.isNaN(Number(raw))) return { ok: false, message: 'Enter a number' };
      return { ok: true, value: Number(raw) };
    }
    case 'JSON':
      try { return { ok: true, value: JSON.parse(raw) }; } catch { return { ok: false, message: 'Enter valid JSON' }; }
    default: return raw.trim() ? { ok: true, value: raw.trim() } : { ok: false, message: 'Enter a value' };
  }
}

function EditSettingDialog({ setting, onClose }: { setting: Setting; onClose: () => void }) {
  const qc = useQueryClient();
  const initial = setting.value === null ? '' : setting.valueType === 'JSON' ? JSON.stringify(setting.value, null, 2) : String(setting.value);
  const [raw, setRaw] = useState(initial);
  const [bool, setBool] = useState(setting.value === true);
  const [reason, setReason] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: (value: unknown | undefined) => settingsApi.update(setting.key, { ...(value === undefined ? {} : { value }), version: setting.version, reason: reason.trim() }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['settings'] }); onClose(); },
  });
  const save = () => {
    const parsed = parseInput(setting, raw, bool);
    if (!parsed.ok) return setLocalError(parsed.message);
    setLocalError(null);
    m.mutate(parsed.value);
  };
  const canConfirmOnly = setting.value !== null && (setting.source === 'PROVISIONAL' || setting.source === 'UNSET');
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{setting.key}</DialogTitle>
      <DialogContent>
        <Typography color="text.secondary" sx={{ mb: 2 }}>{setting.description}</Typography>
        <ErrorAlert error={m.error} />
        <Stack spacing={2}>
          {setting.valueType === 'BOOLEAN' && <FormControlLabel control={<Switch checked={bool} onChange={(e) => setBool(e.target.checked)} />} label={bool ? 'Yes' : 'No'} />}
          {setting.valueType === 'ENUM' && (
            <TextField select label="Value" value={raw} onChange={(e) => setRaw(e.target.value)}>
              {setting.options?.map((o) => <MenuItem key={o} value={o}>{o}</MenuItem>)}
            </TextField>
          )}
          {(setting.valueType === 'NUMBER' || setting.valueType === 'STRING') && (
            <TextField label="Value" value={raw} onChange={(e) => setRaw(e.target.value)} slotProps={{ htmlInput: { inputMode: setting.valueType === 'NUMBER' ? 'decimal' : 'text' } }}
              error={!!localError} helperText={localError} />
          )}
          {setting.valueType === 'JSON' && (
            <TextField label="Value (JSON)" multiline minRows={4} value={raw} onChange={(e) => setRaw(e.target.value)} error={!!localError} helperText={localError}
              slotProps={{ htmlInput: { style: { fontFamily: 'monospace' } } }} />
          )}
          <TextField label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} helperText="Required. Stored with the before/after values in the audit log." />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        {canConfirmOnly && <Button disabled={m.isPending || reason.trim().length < 3} onClick={() => m.mutate(undefined)}>Confirm current value</Button>}
        <Button variant="contained" disabled={m.isPending || reason.trim().length < 3} onClick={save}>Save</Button>
      </DialogActions>
    </Dialog>
  );
}

/** System settings (ARCHITECTURE.md §20): MANUAL / PROVISIONAL / UNSET / CONFIRMED. */
export function SettingsPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get('filter') === 'unconfirmed' ? 'unconfirmed' : 'all';
  const q = useQuery({ queryKey: ['settings', 'all'], queryFn: settingsApi.list });
  const [editing, setEditing] = useState<Setting | null>(null);

  const rows = useMemo(() => (q.data ?? []).filter((s) => tab === 'all' || s.source === 'PROVISIONAL' || s.source === 'UNSET'), [q.data, tab]);
  const canEdit = (s: Setting) => (s.isSystem ? can('settings:manage-system') : can(['settings:manage', 'settings:manage-system']));

  return (
    <>
      <PageHeader title="Settings" subtitle="Thresholds and policies. Values taken from the manual are marked MANUAL; engineering defaults stay PROVISIONAL until confirmed." />
      <Tabs value={tab} onChange={(_, v) => setParams(v === 'all' ? {} : { filter: v })} sx={{ mb: 2 }}>
        <Tab value="all" label="All" />
        <Tab value="unconfirmed" label={`To confirm (${(q.data ?? []).filter((s) => s.source === 'PROVISIONAL' || s.source === 'UNSET').length})`} />
      </Tabs>
      <ErrorAlert error={q.error} />
      {q.isLoading ? <Loading /> : (
        <Paper variant="outlined">
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Setting</TableCell>
                  <TableCell>Value</TableCell>
                  <TableCell>Source</TableCell>
                  <TableCell>Updated</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((s) => (
                  <TableRow key={s.key} hover>
                    <TableCell sx={{ maxWidth: 480 }}>
                      <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>{s.key}</Typography>
                      <Typography variant="caption" color="text.secondary">{s.description}</Typography>
                    </TableCell>
                    <TableCell sx={{ fontFamily: 'monospace', maxWidth: 260, wordBreak: 'break-word' }}>{formatSettingValue(s.value)}</TableCell>
                    <TableCell><StatusChip status={s.source} label={humanize(s.source)} />{s.isSystem && <Typography variant="caption" component="div" color="text.secondary">system</Typography>}</TableCell>
                    <TableCell>{formatDateTime(s.updatedAt)}</TableCell>
                    <TableCell align="right">{canEdit(s) && <Button size="small" onClick={() => setEditing(s)}>Edit</Button>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}
      {editing && <EditSettingDialog setting={editing} onClose={() => setEditing(null)} />}
    </>
  );
}
