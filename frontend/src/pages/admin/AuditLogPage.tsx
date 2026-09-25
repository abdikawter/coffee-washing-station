import VerifiedUserIcon from '@mui/icons-material/VerifiedUser';
import {
  Alert, Box, Button, Dialog, DialogContent, DialogTitle, MenuItem, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead,
  TablePagination, TableRow, TextField, Typography,
} from '@mui/material';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { auditApi } from '../../api/endpoints';
import type { AuditEntry } from '../../api/types';
import { ErrorAlert, Loading, PageHeader } from '../../components/common';
import { formatDateTime, humanize } from '../../utils/format';

const ACTIONS = ['CREATE', 'UPDATE', 'SUBMIT', 'VERIFY', 'APPROVE', 'REJECT', 'PAY', 'CANCEL', 'VOID', 'REVERSE', 'TRANSFER', 'ADJUST', 'HOLD', 'RELEASE', 'LOGIN', 'LOGIN_FAILED', 'LOGOUT', 'EXPORT', 'SETTING_CHANGE'];

function Json({ value }: { value: unknown }) {
  return (
    <Box component="pre" sx={{ m: 0, p: 1.5, bgcolor: 'action.hover', borderRadius: 1, fontSize: 12, overflowX: 'auto' }}>
      {value === null || value === undefined ? '—' : JSON.stringify(value, null, 2)}
    </Box>
  );
}

function EntryDialog({ entry, onClose }: { entry: AuditEntry; onClose: () => void }) {
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>{humanize(entry.action)} · {entry.entityType}</DialogTitle>
      <DialogContent>
        <Stack spacing={1} sx={{ mb: 2 }}>
          <Typography variant="body2">When: {formatDateTime(entry.createdAt)} · By: {entry.username ?? 'system'} · Module: {entry.module}</Typography>
          <Typography variant="body2">Entity id: {entry.entityId ?? '—'} · IP: {entry.ipAddress ?? '—'} · Request: {entry.requestId ?? '—'}</Typography>
          <Typography variant="caption" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>hash {entry.hash}</Typography>
        </Stack>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          <Box sx={{ flex: 1, minWidth: 0 }}><Typography variant="overline">Before</Typography><Json value={entry.previousValue} /></Box>
          <Box sx={{ flex: 1, minWidth: 0 }}><Typography variant="overline">After</Typography><Json value={entry.newValue} /></Box>
        </Stack>
      </DialogContent>
    </Dialog>
  );
}

/** Append-only, hash-chained audit log (ARCHITECTURE.md §14). */
export function AuditLogPage() {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [action, setAction] = useState('');
  const [module, setModule] = useState('');
  const [entityId, setEntityId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [open, setOpen] = useState<AuditEntry | null>(null);

  const toIso = (d: string, endOfDay = false) => (d ? new Date(`${d}T${endOfDay ? '23:59:59.999' : '00:00:00'}+03:00`).toISOString() : undefined);
  const q = useQuery({
    queryKey: ['audit-logs', { page, pageSize, action, module, entityId, from, to }],
    queryFn: () => auditApi.list({ page: page + 1, pageSize, action: action || undefined, module: module.trim() || undefined, entityId: entityId.trim() || undefined, from: toIso(from), to: toIso(to, true) }),
    placeholderData: keepPreviousData,
  });
  const verify = useMutation({ mutationFn: auditApi.verify });

  return (
    <>
      <PageHeader title="Audit log" subtitle="Every change, sign-in and approval. Entries cannot be edited or deleted."
        actions={<Button variant="outlined" startIcon={<VerifiedUserIcon />} disabled={verify.isPending} onClick={() => verify.mutate()}>Verify integrity</Button>} />
      {verify.data && (
        <Alert severity={verify.data.valid ? 'success' : 'error'} sx={{ mb: 2 }}>
          {verify.data.valid
            ? `Hash chain intact: ${verify.data.checked} entries verified.`
            : `Chain broken at entry ${verify.data.brokenAtId} (${verify.data.reason}). Report this to the auditor immediately.`}
        </Alert>
      )}
      <ErrorAlert error={verify.error ?? q.error} />
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mb: 2 }}>
        <TextField size="small" select label="Action" value={action} onChange={(e) => { setAction(e.target.value); setPage(0); }} sx={{ minWidth: 180 }}>
          <MenuItem value="">All</MenuItem>
          {ACTIONS.map((a) => <MenuItem key={a} value={a}>{humanize(a)}</MenuItem>)}
        </TextField>
        <TextField size="small" label="Module" value={module} onChange={(e) => { setModule(e.target.value); setPage(0); }} />
        <TextField size="small" label="Entity id" value={entityId} onChange={(e) => { setEntityId(e.target.value); setPage(0); }} />
        <TextField size="small" type="date" label="From" value={from} onChange={(e) => { setFrom(e.target.value); setPage(0); }} slotProps={{ inputLabel: { shrink: true } }} />
        <TextField size="small" type="date" label="To" value={to} onChange={(e) => { setTo(e.target.value); setPage(0); }} slotProps={{ inputLabel: { shrink: true } }} />
      </Stack>
      <Paper variant="outlined">
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>When</TableCell>
                <TableCell>User</TableCell>
                <TableCell>Action</TableCell>
                <TableCell>Module</TableCell>
                <TableCell>Entity</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {q.isLoading && <TableRow><TableCell colSpan={5}><Loading /></TableCell></TableRow>}
              {q.data?.data.map((e) => (
                <TableRow key={e.id} hover sx={{ cursor: 'pointer' }} onClick={() => setOpen(e)}>
                  <TableCell>{formatDateTime(e.createdAt)}</TableCell>
                  <TableCell>{e.username ?? 'system'}</TableCell>
                  <TableCell>{humanize(e.action)}</TableCell>
                  <TableCell>{e.module}</TableCell>
                  <TableCell>{e.entityType}{e.entityId ? ` · ${e.entityId.slice(0, 8)}` : ''}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination component="div" count={q.data?.meta.total ?? 0} page={page} rowsPerPage={pageSize}
          onPageChange={(_, p) => setPage(p)} onRowsPerPageChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }} rowsPerPageOptions={[25, 50, 100]} />
      </Paper>
      {open && <EntryDialog entry={open} onClose={() => setOpen(null)} />}
    </>
  );
}
