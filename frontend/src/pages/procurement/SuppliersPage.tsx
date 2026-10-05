import AddIcon from '@mui/icons-material/Add';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import {
  Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Paper, Stack, Tab, Table, TableBody, TableCell,
  TableContainer, TableHead, TablePagination, TableRow, Tabs, TextField, Typography,
} from '@mui/material';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { filesApi, IDENTIFICATION_TYPES, suppliersApi, type Supplier, type SupplierInput, type SupplierStatus } from '../../api/procurement';
import { Can } from '../../auth/Can';
import { ErrorAlert, Field, Loading, PageHeader, StatusChip } from '../../components/common';
import { ReasonDialog } from '../../components/ReasonDialog';
import { SimpleTable } from '../../components/SimpleTable';
import { formatDateTime, humanize } from '../../utils/format';
import { formatNumber } from '../../utils/decimal';

const EMPTY: SupplierInput = { supplierCode: '', fullName: '', phone: '', village: '', address: '', identificationType: null, identificationNo: '' };
const nullIfBlank = (s?: string | null) => (s && s.trim() ? s.trim() : null);

function SupplierFormDialog({ supplier, onClose }: { supplier?: Supplier; onClose: () => void }) {
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
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['suppliers'] }); onClose(); },
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

function SupplierDetail({ supplier, onClose }: { supplier: Supplier; onClose: () => void }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState(0);
  const [editing, setEditing] = useState(false);
  const [statusTo, setStatusTo] = useState<SupplierStatus | null>(null);
  const [docType, setDocType] = useState('ID card');
  const current = useQuery({ queryKey: ['suppliers', supplier.id], queryFn: () => suppliersApi.get(supplier.id), initialData: supplier });
  const history = useQuery({ queryKey: ['suppliers', supplier.id, 'history'], queryFn: () => suppliersApi.history(supplier.id) });
  const docs = useQuery({ queryKey: ['suppliers', supplier.id, 'documents'], queryFn: () => suppliersApi.documents(supplier.id) });
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const d = await filesApi.upload(file, 'SUPPLIER_ID');
      await suppliersApi.addDocument(supplier.id, d.id, docType);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['suppliers', supplier.id, 'documents'] }),
  });
  const s = current.data;

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
          <span>{s.fullName}</span><StatusChip status={s.status} label={humanize(s.status)} />
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' }, gap: 2, mb: 2 }}>
          <Field label="Supplier ID">{s.supplierCode}</Field>
          <Field label="Phone">{s.phone}</Field>
          <Field label="Village">{s.village}</Field>
          <Field label="ID">{s.identificationType ? `${humanize(s.identificationType)} ${s.identificationNo}` : null}</Field>
          <Field label="Registered">{formatDateTime(s.createdAt)}</Field>
          <Field label="QR token">{<code>{s.qrToken}</code>}</Field>
          {s.statusReason && <Field label="Status reason">{s.statusReason}</Field>}
        </Box>
        {history.data && (
          <Stack direction="row" spacing={3} sx={{ mb: 2 }}>
            <Field label="Vouchers">{history.data.totals.vouchers}</Field>
            <Field label="Cherry bought (kg)">{formatNumber(history.data.totals.purchasedKg, 3)}</Field>
            <Field label="Paid">{formatNumber(history.data.totals.paidAmount)}</Field>
          </Stack>
        )}
        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 1 }}>
          <Tab label="Purchases" /><Tab label="Payments" /><Tab label="Inspections" /><Tab label="Documents" />
        </Tabs>
        <ErrorAlert error={history.error ?? docs.error ?? upload.error} />
        {tab === 0 && <SimpleTable rows={history.data?.vouchers ?? []} cols={[['voucherNo', 'Voucher'], ['voucherDate', 'Date'], ['totalWeightKg', 'Kg'], ['totalAmount', 'Amount'], ['status', 'Status']]} />}
        {tab === 1 && <SimpleTable rows={history.data?.payments ?? []} cols={[['paymentNo', 'Payment'], ['voucherNo', 'Voucher'], ['amount', 'Amount'], ['status', 'Status']]} />}
        {tab === 2 && <SimpleTable rows={history.data?.inspections ?? []} cols={[['inspectionNo', 'Inspection'], ['redRipePct', 'Red %'], ['decision', 'Decision']]} />}
        {tab === 3 && (
          <>
            <SimpleTable rows={docs.data ?? []} cols={[['docType', 'Type'], ['originalName', 'File'], ['createdAt', 'Added']]} />
            <Can permission="supplier:update">
              <Stack direction="row" spacing={2} sx={{ mt: 2, alignItems: 'center' }}>
                <TextField size="small" label="Document type" value={docType} onChange={(e) => setDocType(e.target.value)} />
                <Button component="label" variant="outlined" startIcon={<UploadFileIcon />} disabled={upload.isPending || docType.trim().length < 2}>
                  Upload (PDF / image)
                  <input hidden type="file" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={(e) => { const file = e.target.files?.[0]; if (file) upload.mutate(file); e.target.value = ''; }} />
                </Button>
              </Stack>
            </Can>
          </>
        )}
      </DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
        <Can permission="supplier:status">
          {(['ACTIVE', 'SUSPENDED', 'INACTIVE'] as const).filter((x) => x !== s.status).map((x) => (
            <Button key={x} color={x === 'ACTIVE' ? 'success' : 'warning'} onClick={() => setStatusTo(x)}>{x === 'ACTIVE' ? 'Activate' : humanize(x === 'SUSPENDED' ? 'suspend' : 'deactivate')}</Button>
          ))}
        </Can>
        <Can permission="supplier:update"><Button onClick={() => setEditing(true)}>Edit</Button></Can>
        <Button variant="contained" onClick={onClose}>Close</Button>
      </DialogActions>
      {editing && <SupplierFormDialog supplier={s} onClose={() => { setEditing(false); qc.invalidateQueries({ queryKey: ['suppliers', supplier.id] }); }} />}
      {statusTo && (
        <ReasonDialog open title={`Set ${s.fullName} to ${humanize(statusTo)}`} message="Only ACTIVE suppliers can be inspected and bought from."
          confirmLabel="Change status" danger={statusTo !== 'ACTIVE'} onClose={() => setStatusTo(null)}
          onConfirm={async (reason) => { await suppliersApi.setStatus(s.id, statusTo, reason); await qc.invalidateQueries({ queryKey: ['suppliers'] }); }} />
      )}
    </Dialog>
  );
}

/** Suppliers (farmers): register, profile, documents, status, purchase history. */
export function SuppliersPage() {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  // `?search=` comes from the global search in the top bar.
  const urlSearch = useSearchParams()[0].get('search') ?? '';
  const [search, setSearch] = useState(urlSearch);
  useEffect(() => { setSearch(urlSearch); setPage(0); }, [urlSearch]);
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<Supplier | null>(null);
  const q = useQuery({
    queryKey: ['suppliers', { page, pageSize, search, status }],
    queryFn: () => suppliersApi.list({ page: page + 1, pageSize, search: search.trim() || undefined, status: status || undefined }),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader title="Suppliers" subtitle="Farmers and suppliers of red cherry"
        actions={<Can permission="supplier:create"><Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreating(true)}>Register supplier</Button></Can>} />
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mb: 2 }}>
        <TextField size="small" label="Search name, ID, phone, village" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} sx={{ minWidth: 300 }} />
        <TextField size="small" select label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }} sx={{ minWidth: 160 }}>
          <MenuItem value="">All</MenuItem>
          {['ACTIVE', 'SUSPENDED', 'INACTIVE'].map((s) => <MenuItem key={s} value={s}>{humanize(s)}</MenuItem>)}
        </TextField>
      </Stack>
      <ErrorAlert error={q.error} />
      <Paper variant="outlined">
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow><TableCell>ID</TableCell><TableCell>Name</TableCell><TableCell>Phone</TableCell><TableCell>Village</TableCell><TableCell>Status</TableCell></TableRow>
            </TableHead>
            <TableBody>
              {q.isLoading && <TableRow><TableCell colSpan={5}><Loading /></TableCell></TableRow>}
              {q.data?.data.map((s) => (
                <TableRow key={s.id} hover sx={{ cursor: 'pointer' }} onClick={() => setOpen(s)}>
                  <TableCell>{s.supplierCode}</TableCell>
                  <TableCell>{s.fullName}</TableCell>
                  <TableCell>{s.phone ?? '—'}</TableCell>
                  <TableCell>{s.village ?? '—'}</TableCell>
                  <TableCell><StatusChip status={s.status} label={humanize(s.status)} /></TableCell>
                </TableRow>
              ))}
              {q.data?.data.length === 0 && <TableRow><TableCell colSpan={5}><Typography color="text.secondary" sx={{ p: 2 }}>No suppliers match.</Typography></TableCell></TableRow>}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination component="div" count={q.data?.meta.total ?? 0} page={page} rowsPerPage={pageSize}
          onPageChange={(_, p) => setPage(p)} onRowsPerPageChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }} rowsPerPageOptions={[10, 25, 50, 100]} />
      </Paper>
      {creating && <SupplierFormDialog onClose={() => setCreating(false)} />}
      {open && <SupplierDetail supplier={open} onClose={() => setOpen(null)} />}
    </>
  );
}
