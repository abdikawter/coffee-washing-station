import {
  Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, List, ListItem, MenuItem, Stack, Switch, Tab, Tabs,
  TextField, Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { settingsApi } from '../../api/endpoints';
import type { Setting } from '../../api/types';
import { useAuth } from '../../auth/useAuth';
import { EmptyState, ErrorAlert, Loading, SectionCard, StatusChip } from '../../components';
import { ListTemplate } from '../../templates';
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
      <DialogTitle sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{setting.key}</DialogTitle>
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

const toConfirm = (s: Setting) => s.source === 'PROVISIONAL' || s.source === 'UNSET';

/** System settings (ARCHITECTURE.md §20): MANUAL / PROVISIONAL / UNSET / CONFIRMED, grouped by category. */
export function SettingsPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get('filter') === 'unconfirmed' ? 'unconfirmed' : 'all';
  const search = (params.get('search') ?? '').trim().toLowerCase();
  const q = useQuery({ queryKey: ['settings', 'all'], queryFn: settingsApi.list });
  const [editing, setEditing] = useState<Setting | null>(null);

  const groups = useMemo(() => {
    const rows = (q.data ?? []).filter((s) => (tab === 'all' || toConfirm(s))
      && (!search || s.key.toLowerCase().includes(search) || s.description.toLowerCase().includes(search)));
    const map = new Map<string, Setting[]>();
    for (const s of rows) map.set(s.category, [...(map.get(s.category) ?? []), s]);
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [q.data, tab, search]);
  const pending = (q.data ?? []).filter(toConfirm).length;
  const canEdit = (s: Setting) => (s.isSystem ? can('settings:manage-system') : can(['settings:manage', 'settings:manage-system']));

  const setTab = (v: string) => setParams((prev) => {
    const next = new URLSearchParams(prev);
    if (v === 'all') next.delete('filter'); else next.set('filter', v);
    return next;
  }, { replace: true });

  return (
    <ListTemplate title="Settings" subtitle="Thresholds and policies. Values from the manual are MANUAL; engineering defaults stay PROVISIONAL until confirmed."
      filters={[{ type: 'search', key: 'search', label: 'Search settings' }]} error={q.error}>
      <Tabs value={tab} onChange={(_, v: string) => setTab(v)} sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Tab value="all" label="All" />
        <Tab value="unconfirmed" label={`To confirm (${pending})`} />
      </Tabs>
      {q.isLoading ? <Loading /> : groups.length === 0 ? (
        <EmptyState title={tab === 'unconfirmed' ? 'Every setting is confirmed' : 'No settings match'} />
      ) : (
        <Stack spacing={3}>
          {groups.map(([category, settings]) => (
            <SectionCard key={category} title={humanize(category)} subtitle={`${settings.length} setting${settings.length === 1 ? '' : 's'}`} disablePadding>
              <List disablePadding>
                {settings.map((s) => (
                  <ListItem key={s.key} divider sx={{ px: 2.5, py: 1.5, alignItems: 'flex-start', gap: 2, flexWrap: { xs: 'wrap', md: 'nowrap' } }}>
                    <Box sx={{ flex: '1 1 320px', minWidth: 0 }}>
                      <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 600, wordBreak: 'break-all' }}>{s.key}</Typography>
                      <Typography variant="caption" color="text.secondary" component="div">{s.description}</Typography>
                      <Typography variant="caption" color="text.secondary" component="div">Updated {formatDateTime(s.updatedAt)}</Typography>
                    </Box>
                    <Typography variant="body2" sx={{ flex: '0 1 220px', fontFamily: 'monospace', wordBreak: 'break-word' }}>{formatSettingValue(s.value)}</Typography>
                    <Stack direction="row" spacing={1} sx={{ flex: '0 0 auto', alignItems: 'center' }}>
                      <StatusChip status={s.source} domain="settingSource" />
                      {s.isSystem && <Chip size="small" variant="outlined" label="System" />}
                      {canEdit(s) && <Button size="small" onClick={() => setEditing(s)} aria-label={`Edit ${s.key}`}>Edit</Button>}
                    </Stack>
                  </ListItem>
                ))}
              </List>
            </SectionCard>
          ))}
        </Stack>
      )}
      {editing && <EditSettingDialog setting={editing} onClose={() => setEditing(null)} />}
    </ListTemplate>
  );
}
