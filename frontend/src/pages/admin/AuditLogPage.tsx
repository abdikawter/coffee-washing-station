import VerifiedUserIcon from '@mui/icons-material/VerifiedUser';
import { Alert, Box, Button, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import type { GridColDef } from '@mui/x-data-grid';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { auditApi } from '../../api/endpoints';
import type { AuditEntry } from '../../api/types';
import { columns as col, DataTable, Field, useTableQuery, useUrlFilters } from '../../components';
import { ListTemplate } from '../../templates';
import { formatDateTime, humanize } from '../../utils/format';

const ACTIONS = ['CREATE', 'UPDATE', 'SUBMIT', 'VERIFY', 'APPROVE', 'REJECT', 'PAY', 'CANCEL', 'VOID', 'REVERSE', 'TRANSFER', 'ADJUST', 'HOLD', 'RELEASE', 'LOGIN', 'LOGIN_FAILED', 'LOGOUT', 'EXPORT', 'SETTING_CHANGE'];

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const show = (v: unknown) => (v === undefined ? '' : JSON.stringify(v, null, 1));

function Json({ value }: { value: unknown }) {
  return (
    <Box component="pre" sx={{ m: 0, p: 1.5, bgcolor: 'action.hover', borderRadius: 1, fontSize: 12, overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
      {value === null || value === undefined ? '—' : JSON.stringify(value, null, 2)}
    </Box>
  );
}

/**
 * Before / after side by side (spec §7): one row per key, changed keys highlighted.
 * Values that are not objects are shown as two JSON blocks.
 */
export function JsonDiff({ before, after }: { before: unknown; after: unknown }) {
  if (!isRecord(before) && !isRecord(after)) {
    return (
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <Box sx={{ flex: 1, minWidth: 0 }}><Typography variant="overline">Before</Typography><Json value={before} /></Box>
        <Box sx={{ flex: 1, minWidth: 0 }}><Typography variant="overline">After</Typography><Json value={after} /></Box>
      </Stack>
    );
  }
  const b = isRecord(before) ? before : {};
  const a = isRecord(after) ? after : {};
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].sort();
  const cell = { fontFamily: 'monospace', fontSize: 12, verticalAlign: 'top', wordBreak: 'break-word', whiteSpace: 'pre-wrap' } as const;
  return (
    <Table size="small" aria-label="Changes">
      <TableHead><TableRow><TableCell>Field</TableCell><TableCell>Before</TableCell><TableCell>After</TableCell></TableRow></TableHead>
      <TableBody>
        {keys.map((k) => {
          const changed = show(b[k]) !== show(a[k]);
          return (
            <TableRow key={k} data-changed={changed || undefined} sx={changed ? { bgcolor: 'action.selected', '& td:first-of-type': { fontWeight: 700 } } : undefined}>
              <TableCell sx={cell}>{k}{changed && <Box component="span" sx={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}> (changed)</Box>}</TableCell>
              <TableCell sx={cell}>{k in b ? show(b[k]) : '—'}</TableCell>
              <TableCell sx={cell}>{k in a ? show(a[k]) : '—'}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function EntryDetail({ entry }: { entry: AuditEntry }) {
  return (
    <Stack spacing={2.5}>
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: '1fr 1fr' }}>
        <Field label="When">{formatDateTime(entry.createdAt)}</Field>
        <Field label="By">{entry.username ?? 'system'}</Field>
        <Field label="Module">{entry.module}</Field>
        <Field label="Entity">{entry.entityType}</Field>
        <Field label="Entity id"><Box component="span" sx={{ fontFamily: 'monospace', fontSize: 12 }}>{entry.entityId}</Box></Field>
        <Field label="IP address">{entry.ipAddress}</Field>
      </Box>
      <JsonDiff before={entry.previousValue} after={entry.newValue} />
      <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
        Request {entry.requestId ?? '—'} · hash {entry.hash}
      </Typography>
    </Stack>
  );
}

/** Station-time day boundaries → ISO timestamps for the API. */
const toIso = (d: string, endOfDay = false) => (d ? new Date(`${d}T${endOfDay ? '23:59:59.999' : '00:00:00'}+03:00`).toISOString() : undefined);

/** Append-only, hash-chained audit log (ARCHITECTURE.md §14). */
export function AuditLogPage() {
  const { table, apiParams } = useTableQuery();
  const { get } = useUrlFilters();
  const [open, setOpen] = useState<AuditEntry | null>(null);
  const filters = {
    action: get('action') || undefined, module: get('module') || undefined, entityId: get('entityId') || undefined,
    from: toIso(get('from')), to: toIso(get('to'), true),
  };
  const q = useQuery({
    queryKey: ['audit-logs', apiParams, filters],
    queryFn: () => auditApi.list({ ...apiParams, ...filters }),
    placeholderData: keepPreviousData,
  });
  const verify = useMutation({ mutationFn: auditApi.verify });

  const columns: GridColDef<AuditEntry>[] = [
    col.dateTime<AuditEntry>('createdAt', 'When'),
    { field: 'username', headerName: 'User', minWidth: 140, valueGetter: (v: string | null) => v ?? 'system' },
    { field: 'action', headerName: 'Action', minWidth: 140, valueFormatter: (v: string) => humanize(v) },
    { field: 'module', headerName: 'Module', minWidth: 120 },
    { field: 'entityType', headerName: 'Entity', flex: 1, minWidth: 180, valueGetter: (_v, e) => `${e.entityType}${e.entityId ? ` · ${e.entityId.slice(0, 8)}` : ''}` },
  ];

  return (
    <ListTemplate title="Audit log" subtitle="Every change, sign-in and approval. Entries cannot be edited or deleted." error={verify.error ?? q.error}
      actions={<Button variant="outlined" startIcon={<VerifiedUserIcon />} disabled={verify.isPending} onClick={() => verify.mutate()}>Verify integrity</Button>}
      filters={[
        { type: 'select', key: 'action', label: 'Action', options: ACTIONS.map((a) => ({ value: a, label: humanize(a) })) },
        { type: 'search', key: 'module', label: 'Module' },
        { type: 'search', key: 'entityId', label: 'Entity id' },
        { type: 'dateRange', key: 'date' },
      ]}
      quickView={{ open: Boolean(open), title: open ? `${humanize(open.action)} · ${open.entityType}` : '', onClose: () => setOpen(null), children: open && <EntryDetail entry={open} /> }}
    >
      {verify.data && (
        <Alert severity={verify.data.valid ? 'success' : 'error'} sx={{ mb: 2 }}>
          {verify.data.valid
            ? `Hash chain intact: ${verify.data.checked} entries verified.`
            : `Chain broken at entry ${verify.data.brokenAtId} (${verify.data.reason}). Report this to the auditor immediately.`}
        </Alert>
      )}
      <DataTable label="Audit log" loading={q.isFetching} rows={q.data?.data ?? []} columns={columns}
        server={{ state: table, rowCount: q.data?.meta.total ?? 0, sortFields: ['createdAt'] }}
        onRowClick={setOpen} empty={{ title: 'No entries match', message: 'Change the filters to see more.' }} />
    </ListTemplate>
  );
}
