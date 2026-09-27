import AddIcon from '@mui/icons-material/Add';
import {
  Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead,
  TablePagination, TableRow, TextField, Typography,
} from '@mui/material';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { equipmentApi, EQUIPMENT_TYPES, MAINTENANCE_TYPES, type Equipment, type EquipmentStatus } from '../../api/procurement';
import { Can } from '../../auth/Can';
import { ErrorAlert, Loading, PageHeader, StatusChip } from '../../components/common';
import { ReasonDialog } from '../../components/ReasonDialog';
import { SimpleTable } from '../../components/SimpleTable';
import { formatDateTime, humanize } from '../../utils/format';

const NON_SCALE_TYPES = EQUIPMENT_TYPES.filter((t) => t !== 'SCALE');
const STATUSES: EquipmentStatus[] = ['OPERATIONAL', 'UNDER_MAINTENANCE', 'OUT_OF_SERVICE', 'DECOMMISSIONED'];

function NewEquipmentDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ code: '', name: '', type: 'PULPING_MACHINE', location: '', serialNo: '' });
  const m = useMutation({
    mutationFn: () => equipmentApi.create({ ...f, location: f.location.trim() || null, serialNo: f.serialNo.trim() || null }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['equipment'] }); onClose(); },
  });
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Register equipment</DialogTitle>
      <DialogContent>
        <ErrorAlert error={m.error} />
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField label="Code" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />
          <TextField label="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <TextField select label="Type" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} helperText="Scales are registered on the Scales page">
            {NON_SCALE_TYPES.map((t) => <MenuItem key={t} value={t}>{humanize(t)}</MenuItem>)}
          </TextField>
          <TextField label="Location" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} />
          <TextField label="Serial number" value={f.serialNo} onChange={(e) => setF({ ...f, serialNo: e.target.value })} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={!f.code.trim() || f.name.trim().length < 2 || m.isPending} onClick={() => m.mutate()}>Register</Button>
      </DialogActions>
    </Dialog>
  );
}

function EquipmentDetail({ item, onClose }: { item: Equipment; onClose: () => void }) {
  const qc = useQueryClient();
  const [statusTo, setStatusTo] = useState<EquipmentStatus | ''>('');
  const [mt, setMt] = useState({ type: 'CLEANING', description: '', result: '' });
  const [sched, setSched] = useState({ type: 'PREVENTIVE', intervalDays: '30' });
  const maintenance = useQuery({ queryKey: ['equipment', item.id, 'maintenance'], queryFn: () => equipmentApi.maintenance(item.id) });
  const schedules = useQuery({ queryKey: ['equipment', item.id, 'schedules'], queryFn: () => equipmentApi.schedules(item.id) });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['equipment'] });
  const record = useMutation({
    mutationFn: () => equipmentApi.recordMaintenance(item.id, { type: mt.type, description: mt.description, result: (mt.result || null) as 'PASS' | 'FAIL' | null }),
    onSuccess: () => { setMt({ ...mt, description: '', result: '' }); invalidate(); },
  });
  const addSchedule = useMutation({
    mutationFn: () => equipmentApi.createSchedule(item.id, { type: sched.type, intervalDays: Number(sched.intervalDays) }),
    onSuccess: invalidate,
  });
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>{item.code} · {item.name} <StatusChip status={item.status} label={humanize(item.status)} /></DialogTitle>
      <DialogContent dividers>
        <ErrorAlert error={maintenance.error ?? schedules.error ?? record.error ?? addSchedule.error} />
        <Typography variant="subtitle2" gutterBottom>Maintenance schedules</Typography>
        <SimpleTable rows={schedules.data ?? []} cols={[['type', 'Type'], ['intervalDays', 'Every (days)'], ['lastPerformedAt', 'Last done'], ['nextDueAt', 'Next due']]} />
        <Can permission="equipment:manage">
          <Stack direction="row" spacing={1} sx={{ my: 2 }}>
            <TextField size="small" select label="Type" value={sched.type} onChange={(e) => setSched({ ...sched, type: e.target.value })} sx={{ minWidth: 160 }}>
              {MAINTENANCE_TYPES.map((t) => <MenuItem key={t} value={t}>{humanize(t)}</MenuItem>)}
            </TextField>
            <TextField size="small" label="Every (days)" value={sched.intervalDays} onChange={(e) => setSched({ ...sched, intervalDays: e.target.value })} sx={{ maxWidth: 120 }} />
            <Button disabled={!/^\d+$/.test(sched.intervalDays) || addSchedule.isPending} onClick={() => addSchedule.mutate()}>Add schedule</Button>
          </Stack>
        </Can>
        <Typography variant="subtitle2" gutterBottom sx={{ mt: 2 }}>Maintenance history</Typography>
        <SimpleTable rows={maintenance.data ?? []} cols={[['performedAt', 'When'], ['type', 'Type'], ['description', 'Work done'], ['result', 'Result'], ['performedByName', 'By']]} />
        <Can permission="equipment:maintenance-record">
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} sx={{ mt: 2 }}>
            <TextField size="small" select label="Type" value={mt.type} onChange={(e) => setMt({ ...mt, type: e.target.value })} sx={{ minWidth: 150 }}>
              {MAINTENANCE_TYPES.map((t) => <MenuItem key={t} value={t}>{humanize(t)}</MenuItem>)}
            </TextField>
            <TextField size="small" label="Work done" value={mt.description} onChange={(e) => setMt({ ...mt, description: e.target.value })} sx={{ flexGrow: 1 }} />
            <TextField size="small" select label="Result" value={mt.result} onChange={(e) => setMt({ ...mt, result: e.target.value })} sx={{ minWidth: 110 }}>
              <MenuItem value="">—</MenuItem><MenuItem value="PASS">Pass</MenuItem><MenuItem value="FAIL">Fail</MenuItem>
            </TextField>
            <Button variant="outlined" disabled={mt.description.trim().length < 3 || record.isPending} onClick={() => record.mutate()}>Record</Button>
          </Stack>
        </Can>
      </DialogContent>
      <DialogActions>
        <Can permission="equipment:manage">
          <TextField size="small" select label="Change status" value={statusTo} onChange={(e) => setStatusTo(e.target.value as EquipmentStatus)} sx={{ minWidth: 200 }}>
            {STATUSES.filter((s) => s !== item.status).map((s) => <MenuItem key={s} value={s}>{humanize(s)}</MenuItem>)}
          </TextField>
        </Can>
        <Button variant="contained" onClick={onClose}>Close</Button>
      </DialogActions>
      {statusTo && (
        <ReasonDialog open title={`Set ${item.code} to ${humanize(statusTo)}`} confirmLabel="Change status" onClose={() => setStatusTo('')}
          onConfirm={async (reason) => { await equipmentApi.update(item.id, { status: statusTo, reason }); await invalidate(); onClose(); }} />
      )}
    </Dialog>
  );
}

/** Equipment register, maintenance and schedules (scales have their own page). */
export function EquipmentPage() {
  const [page, setPage] = useState(0);
  const [type, setType] = useState('');
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<Equipment | null>(null);
  const q = useQuery({
    queryKey: ['equipment', { page, type }],
    queryFn: () => equipmentApi.list({ page: page + 1, pageSize: 25, type: type || undefined }),
    placeholderData: keepPreviousData,
  });
  return (
    <>
      <PageHeader title="Equipment" subtitle="Machines, maintenance records and schedules"
        actions={<Can permission="equipment:manage"><Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreating(true)}>Register equipment</Button></Can>} />
      <TextField size="small" select label="Type" value={type} onChange={(e) => { setType(e.target.value); setPage(0); }} sx={{ minWidth: 200, mb: 2 }}>
        <MenuItem value="">All</MenuItem>
        {EQUIPMENT_TYPES.map((t) => <MenuItem key={t} value={t}>{humanize(t)}</MenuItem>)}
      </TextField>
      <ErrorAlert error={q.error} />
      <Paper variant="outlined">
        <TableContainer>
          <Table size="small">
            <TableHead><TableRow><TableCell>Code</TableCell><TableCell>Name</TableCell><TableCell>Type</TableCell><TableCell>Location</TableCell><TableCell>Next maintenance</TableCell><TableCell>Status</TableCell></TableRow></TableHead>
            <TableBody>
              {q.isLoading && <TableRow><TableCell colSpan={6}><Loading /></TableCell></TableRow>}
              {q.data?.data.map((e) => (
                <TableRow key={e.id} hover sx={{ cursor: 'pointer' }} onClick={() => setOpen(e)}>
                  <TableCell>{e.code}</TableCell><TableCell>{e.name}</TableCell><TableCell>{humanize(e.type)}</TableCell>
                  <TableCell>{e.location ?? '—'}</TableCell><TableCell>{formatDateTime(e.nextMaintenanceDueAt)}</TableCell>
                  <TableCell><StatusChip status={e.status} label={humanize(e.status)} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination component="div" count={q.data?.meta.total ?? 0} page={page} rowsPerPage={25} rowsPerPageOptions={[25]} onPageChange={(_, p) => setPage(p)} />
      </Paper>
      {creating && <NewEquipmentDialog onClose={() => setCreating(false)} />}
      {open && <EquipmentDetail item={open} onClose={() => setOpen(null)} />}
    </>
  );
}
