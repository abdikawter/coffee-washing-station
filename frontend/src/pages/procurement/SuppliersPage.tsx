import AddIcon from '@mui/icons-material/Add';
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField } from '@mui/material';
import type { GridColDef } from '@mui/x-data-grid';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { IDENTIFICATION_TYPES, suppliersApi, type Supplier, type SupplierInput } from '../../api/procurement';
import { Can } from '../../auth/Can';
import { columns as col, DataTable, ErrorAlert, useTableQuery, useUrlFilters } from '../../components';
import { ListTemplate } from '../../templates';
import { humanize } from '../../utils/format';

const EMPTY: SupplierInput = { supplierCode: '', fullName: '', phone: '', village: '', address: '', identificationType: null, identificationNo: '' };
const nullIfBlank = (s?: string | null) => (s && s.trim() ? s.trim() : null);

export function SupplierFormDialog({ supplier, onClose, onCreated }: { supplier?: Supplier; onClose: () => void; onCreated?: (s: Supplier) => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState<SupplierInput>(supplier ? { ...supplier } : EMPTY);
  const set = (k: keyof SupplierInput) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value || null });
  const m = useMutation({
    mutationFn: () => {
      const body = {
        fullName: f.fullName.trim(), phone: nullIfBlank(f.phone), village: nullIfBlank(f.village), address: nullIfBlank(f.address),
        identificationType: f.identificationType || null, identificationNo: nullIfBlank(f.identificationNo),
      };
      return supplier ? suppliersApi.update(supplier.id, body) : suppliersApi.create({ ...body, supplierCode: f.supplierCode!.trim() });
    },
    onSuccess: (saved) => { qc.invalidateQueries({ queryKey: ['suppliers'] }); onClose(); if (!supplier) onCreated?.(saved); },
  });
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{supplier ? `Edit ${supplier.fullName}` : 'Register supplier'}</DialogTitle>
      <DialogContent>
        <ErrorAlert error={m.error} />
        <Stack spacing={2} sx={{ mt: 1 }}>
          {!supplier && <TextField label="Supplier / farmer ID" value={f.supplierCode ?? ''} onChange={set('supplierCode')} required helperText="Unique code, e.g. F-0001" />}
          <TextField label="Full name" value={f.fullName} onChange={set('fullName')} required />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField fullWidth label="Phone" value={f.phone ?? ''} onChange={set('phone')} inputMode="tel" />
            <TextField fullWidth label="Village / kebele" value={f.village ?? ''} onChange={set('village')} />
          </Stack>
          <TextField label="Address" value={f.address ?? ''} onChange={set('address')} />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField select fullWidth label="ID type" value={f.identificationType ?? ''} onChange={(e) => setF({ ...f, identificationType: (e.target.value || null) as Supplier['identificationType'] })}>
              <MenuItem value="">None</MenuItem>
              {IDENTIFICATION_TYPES.map((t) => <MenuItem key={t} value={t}>{humanize(t)}</MenuItem>)}
            </TextField>
            <TextField fullWidth label="ID number" value={f.identificationNo ?? ''} onChange={set('identificationNo')} />
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={m.isPending || f.fullName.trim().length < 2 || (!supplier && !f.supplierCode?.trim())} onClick={() => m.mutate()}>Save</Button>
      </DialogActions>
    </Dialog>
  );
}

const STATUSES = ['ACTIVE', 'SUSPENDED', 'INACTIVE'] as const;

/** Suppliers (farmers): list and register; each opens its profile page. */
export function SuppliersPage() {
  const navigate = useNavigate();
  const { table, apiParams } = useTableQuery();
  const { get } = useUrlFilters();
  const [creating, setCreating] = useState(false);
  const filters = { search: get('search') || undefined, status: get('status') || undefined };
  const q = useQuery({
    queryKey: ['suppliers', apiParams, filters],
    queryFn: () => suppliersApi.list({ ...apiParams, ...filters }),
    placeholderData: keepPreviousData,
  });

  const columns: GridColDef<Supplier>[] = [
    { field: 'supplierCode', headerName: 'ID', minWidth: 120 },
    { field: 'fullName', headerName: 'Name', flex: 1, minWidth: 200 },
    { field: 'phone', headerName: 'Phone', minWidth: 140 },
    { field: 'village', headerName: 'Village', flex: 1, minWidth: 140 },
    col.status<Supplier>('status', 'Status', 'supplier'),
    col.dateTime<Supplier>('createdAt', 'Registered'),
  ];

  return (
    <ListTemplate title="Suppliers" subtitle="Farmers and suppliers of red cherry" error={q.error}
      actions={<Can permission="supplier:create"><Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreating(true)}>Register supplier</Button></Can>}
      filters={[
        { type: 'search', key: 'search', label: 'Search name, ID, phone, village' },
        { type: 'select', key: 'status', label: 'Status', options: STATUSES.map((s) => ({ value: s, label: humanize(s) })) },
      ]}>
      <DataTable label="Suppliers" loading={q.isFetching} rows={q.data?.data ?? []} columns={columns}
        server={{ state: table, rowCount: q.data?.meta.total ?? 0, sortFields: ['supplierCode', 'fullName', 'createdAt'] }}
        rowTo={(s) => `/suppliers/${s.id}`}
        empty={{ title: 'No suppliers match', message: 'Change the filters or register a new supplier.' }} />
      {creating && <SupplierFormDialog onClose={() => setCreating(false)} onCreated={(s) => navigate(`/suppliers/${s.id}`)} />}
    </ListTemplate>
  );
}
