import AddIcon from '@mui/icons-material/Add';
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField } from '@mui/material';
import type { GridColDef } from '@mui/x-data-grid';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { equipmentApi, EQUIPMENT_TYPES, MAINTENANCE_TYPES, type Equipment, type EquipmentStatus, type Maintenance, type Schedule } from '../../api/procurement';
import { Can } from '../../auth/Can';
import { useAuth } from '../../auth/useAuth';
import { columns as col, DataTable, ErrorAlert, ReasonDialog, SectionCard, StatusChip, useTableQuery, useUrlFilters } from '../../components';
import { DetailTemplate, ListTemplate } from '../../templates';
import { formatDateTime, humanize } from '../../utils/format';

const NON_SCALE_TYPES = EQUIPMENT_TYPES.filter((t) => t !== 'SCALE');
const STATUSES: EquipmentStatus[] = ['OPERATIONAL', 'UNDER_MAINTENANCE', 'OUT_OF_SERVICE', 'DECOMMISSIONED'];

function NewEquipmentDialog({ onClose, onCreated }: { onClose: () => void; onCreated?: (e: Equipment) => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ code: '', name: '', type: 'PULPING_MACHINE', location: '', serialNo: '' });
  const m = useMutation({
    mutationFn: () => equipmentApi.create({ ...f, location: f.location.trim() || null, serialNo: f.serialNo.trim() || null }),
    onSuccess: (created) => { qc.invalidateQueries({ queryKey: ['equipment'] }); onClose(); onCreated?.(created); },
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

/** Equipment register (scales have their own page); each row opens the machine's page. */
export function EquipmentPage() {
  const navigate = useNavigate();
  const { table, apiParams } = useTableQuery();
  const { get } = useUrlFilters();
  const [creating, setCreating] = useState(false);
  const filters = { type: get('type') || undefined, status: get('status') || undefined, search: get('search') || undefined };
  const q = useQuery({
    queryKey: ['equipment', apiParams, filters],
    queryFn: () => equipmentApi.list({ ...apiParams, ...filters }),
    placeholderData: keepPreviousData,
  });
  const columns: GridColDef<Equipment>[] = [
    { field: 'code', headerName: 'Code', minWidth: 120 },
    { field: 'name', headerName: 'Name', flex: 1, minWidth: 180 },
    { field: 'type', headerName: 'Type', minWidth: 160, valueFormatter: (v: string) => humanize(v) },
    { field: 'location', headerName: 'Location', minWidth: 140 },
    col.dateTime<Equipment>('nextMaintenanceDueAt', 'Next maintenance'),
    col.status<Equipment>('status', 'Status', 'equipment'),
  ];
  return (
    <ListTemplate title="Equipment" subtitle="Machines, maintenance records and schedules" error={q.error}
      actions={<Can permission="equipment:manage"><Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreating(true)}>Register equipment</Button></Can>}
      filters={[
        { type: 'search', key: 'search', label: 'Search code or name' },
        { type: 'select', key: 'type', label: 'Type', options: EQUIPMENT_TYPES.map((t) => ({ value: t, label: humanize(t) })) },
        { type: 'select', key: 'status', label: 'Status', options: STATUSES.map((t) => ({ value: t, label: humanize(t) })) },
      ]}>
      <DataTable label="Equipment" loading={q.isFetching} rows={q.data?.data ?? []} columns={columns}
        server={{ state: table, rowCount: q.data?.meta.total ?? 0, sortFields: ['code', 'name', 'type'] }}
        rowTo={(e) => `/equipment/${e.id}`} empty={{ title: 'No equipment registered', message: 'Register pulpers, tanks and other machines here.' }} />
      {creating && <NewEquipmentDialog onClose={() => setCreating(false)} onCreated={(e) => navigate(`/equipment/${e.id}`)} />}
    </ListTemplate>
  );
}

/** One machine: details, maintenance history and schedules (detail template). */
export function EquipmentDetailPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const { can } = useAuth();
  const [statusTo, setStatusTo] = useState<EquipmentStatus | ''>('');
  const [mt, setMt] = useState({ type: 'CLEANING', description: '', result: '' });
  const [sched, setSched] = useState({ type: 'PREVENTIVE', intervalDays: '30' });
  const item = useQuery({ queryKey: ['equipment', id], queryFn: () => equipmentApi.get(id) });
  const maintenance = useQuery({ queryKey: ['equipment', id, 'maintenance'], queryFn: () => equipmentApi.maintenance(id) });
  const schedules = useQuery({ queryKey: ['equipment', id, 'schedules'], queryFn: () => equipmentApi.schedules(id) });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['equipment'] });
  const record = useMutation({
    mutationFn: () => equipmentApi.recordMaintenance(id, { type: mt.type, description: mt.description, result: (mt.result || null) as 'PASS' | 'FAIL' | null }),
    onSuccess: () => { setMt({ ...mt, description: '', result: '' }); invalidate(); },
  });
  const addSchedule = useMutation({
    mutationFn: () => equipmentApi.createSchedule(id, { type: sched.type, intervalDays: Number(sched.intervalDays) }),
    onSuccess: invalidate,
  });
  const e = item.data;

  const maintenanceCols: GridColDef<Maintenance>[] = [
    col.dateTime<Maintenance>('performedAt', 'When'),
    { field: 'type', headerName: 'Type', minWidth: 140, valueFormatter: (v: string) => humanize(v) },
    { field: 'description', headerName: 'Work done', flex: 1, minWidth: 220 },
    col.status<Maintenance>('result', 'Result', 'checkResult', { minWidth: 100 }),
    { field: 'performedByName', headerName: 'By', minWidth: 140 },
  ];
  const scheduleCols: GridColDef<Schedule>[] = [
    { field: 'type', headerName: 'Type', minWidth: 140, valueFormatter: (v: string) => humanize(v) },
    { field: 'intervalDays', headerName: 'Every (days)', type: 'number', minWidth: 120 },
    col.dateTime<Schedule>('lastPerformedAt', 'Last done'),
    col.dateTime<Schedule>('nextDueAt', 'Next due'),
  ];

  return (
    <>
      <DetailTemplate
        title={e ? `${e.code} · ${e.name}` : 'Equipment'}
        breadcrumbs={[{ label: 'Equipment', to: '/equipment' }, { label: e?.code ?? '…' }]}
        status={e && <StatusChip status={e.status} domain="equipment" />}
        loading={item.isLoading}
        error={item.error}
        actions={e && can('equipment:manage') && (
          <TextField size="small" select label="Change status" value={statusTo} onChange={(ev) => setStatusTo(ev.target.value as EquipmentStatus)} sx={{ minWidth: 200 }}>
            {STATUSES.filter((x) => x !== e.status).map((x) => <MenuItem key={x} value={x}>{humanize(x)}</MenuItem>)}
          </TextField>
        )}
        figures={e ? [
          { label: 'Type', value: humanize(e.type) },
          { label: 'Location', value: e.location },
          { label: 'Serial number', value: e.serialNo },
          { label: 'Next maintenance', value: formatDateTime(e.nextMaintenanceDueAt) },
        ] : []}
        tabs={[
          {
            key: 'maintenance', label: 'Maintenance', count: maintenance.data?.length,
            content: (
              <Stack spacing={2}>
                <ErrorAlert error={maintenance.error ?? record.error} />
                <Can permission="equipment:maintenance-record">
                  <SectionCard title="Record maintenance">
                    <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
                      <TextField size="small" select label="Type" value={mt.type} onChange={(ev) => setMt({ ...mt, type: ev.target.value })} sx={{ minWidth: 150 }}>
                        {MAINTENANCE_TYPES.map((t) => <MenuItem key={t} value={t}>{humanize(t)}</MenuItem>)}
                      </TextField>
                      <TextField size="small" label="Work done" value={mt.description} onChange={(ev) => setMt({ ...mt, description: ev.target.value })} sx={{ flexGrow: 1 }} />
                      <TextField size="small" select label="Result" value={mt.result} onChange={(ev) => setMt({ ...mt, result: ev.target.value })} sx={{ minWidth: 110 }}>
                        <MenuItem value="">—</MenuItem><MenuItem value="PASS">Pass</MenuItem><MenuItem value="FAIL">Fail</MenuItem>
                      </TextField>
                      <Button variant="contained" disabled={mt.description.trim().length < 3 || record.isPending} onClick={() => record.mutate()}>Record</Button>
                    </Stack>
                  </SectionCard>
                </Can>
                <DataTable label="Maintenance history" loading={maintenance.isLoading} rows={maintenance.data ?? []} columns={maintenanceCols} empty={{ title: 'No maintenance recorded yet' }} />
              </Stack>
            ),
          },
          {
            key: 'schedules', label: 'Schedules', count: schedules.data?.length,
            content: (
              <Stack spacing={2}>
                <ErrorAlert error={schedules.error ?? addSchedule.error} />
                <Can permission="equipment:manage">
                  <SectionCard title="Add schedule">
                    <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
                      <TextField size="small" select label="Type" value={sched.type} onChange={(ev) => setSched({ ...sched, type: ev.target.value })} sx={{ minWidth: 160 }}>
                        {MAINTENANCE_TYPES.map((t) => <MenuItem key={t} value={t}>{humanize(t)}</MenuItem>)}
                      </TextField>
                      <TextField size="small" label="Every (days)" value={sched.intervalDays} onChange={(ev) => setSched({ ...sched, intervalDays: ev.target.value })} sx={{ maxWidth: 140 }}
                        slotProps={{ htmlInput: { inputMode: 'numeric' } }} />
                      <Button variant="contained" disabled={!/^\d+$/.test(sched.intervalDays) || addSchedule.isPending} onClick={() => addSchedule.mutate()}>Add schedule</Button>
                    </Stack>
                  </SectionCard>
                </Can>
                <DataTable label="Maintenance schedules" loading={schedules.isLoading} rows={schedules.data ?? []} columns={scheduleCols} empty={{ title: 'No schedules yet' }} />
              </Stack>
            ),
          },
        ]}
      />
      {statusTo && e && (
        <ReasonDialog open title={`Set ${e.code} to ${humanize(statusTo)}`} confirmLabel="Change status" onClose={() => setStatusTo('')}
          onConfirm={async (reason) => { await equipmentApi.update(e.id, { status: statusTo, reason }); await invalidate(); }} />
      )}
    </>
  );
}
