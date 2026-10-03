import {
  MenuItem, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TablePagination, TableRow, TextField, Typography,
} from '@mui/material';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LOT_STAGES, lotsApi } from '../../api/processing';
import { ErrorAlert, Loading, PageHeader, StatusChip } from '../../components/common';
import { formatNumber } from '../../utils/decimal';
import { humanize } from '../../utils/format';

const STATUSES = ['ACTIVE', 'ON_HOLD', 'SPLIT', 'IN_STORE', 'RELEASED', 'REJECTED', 'CLOSED'];

/** Lots: every purchase lot and grade lot, searchable by number, supplier, stage and status. */
export function LotsPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState('');
  const [stage, setStage] = useState('');
  const [status, setStatus] = useState('');
  const q = useQuery({
    queryKey: ['lots', { page, pageSize, search, stage, status }],
    queryFn: () => lotsApi.list({ page: page + 1, pageSize, search: search.trim() || undefined, stage: stage || undefined, status: status || undefined }),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader title="Lots & traceability" subtitle="Every lot from purchase to grade lots, with its full event history" />
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mb: 2 }}>
        <TextField size="small" label="Lot number or supplier" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} sx={{ minWidth: 260 }} />
        <TextField size="small" select label="Stage" value={stage} onChange={(e) => { setStage(e.target.value); setPage(0); }} sx={{ minWidth: 200 }}>
          <MenuItem value="">All</MenuItem>
          {LOT_STAGES.map((s) => <MenuItem key={s} value={s}>{humanize(s)}</MenuItem>)}
        </TextField>
        <TextField size="small" select label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }} sx={{ minWidth: 160 }}>
          <MenuItem value="">All</MenuItem>
          {STATUSES.map((s) => <MenuItem key={s} value={s}>{humanize(s)}</MenuItem>)}
        </TextField>
      </Stack>
      <ErrorAlert error={q.error} />
      <Paper variant="outlined">
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Lot</TableCell><TableCell>Supplier</TableCell><TableCell>Stage</TableCell>
                <TableCell align="right">Current kg</TableCell><TableCell align="right">Cherry kg</TableCell><TableCell>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {q.isLoading && <TableRow><TableCell colSpan={6}><Loading /></TableCell></TableRow>}
              {q.data?.data.map((l) => (
                <TableRow key={l.id} hover sx={{ cursor: 'pointer' }} onClick={() => navigate(`/lots/${l.id}`)}>
                  <TableCell>
                    {l.lotNumber}
                    {l.parentLotNumber && <Typography variant="caption" component="div" color="text.secondary">from {l.parentLotNumber}</Typography>}
                  </TableCell>
                  <TableCell>{l.supplierName ?? '—'}</TableCell>
                  <TableCell>{humanize(l.currentStage)}{l.gradeCode ? ` · ${l.gradeCode}` : ''}</TableCell>
                  <TableCell align="right">{formatNumber(l.currentWeightKg, 3)}</TableCell>
                  <TableCell align="right">{formatNumber(l.originalCherryWeightKg, 3)}</TableCell>
                  <TableCell><StatusChip status={l.onHold ? 'ON_HOLD' : l.status} label={humanize(l.onHold ? 'ON_HOLD' : l.status)} /></TableCell>
                </TableRow>
              ))}
              {q.data?.data.length === 0 && <TableRow><TableCell colSpan={6}><Typography color="text.secondary" sx={{ p: 2 }}>No lots match. Lots are created when a voucher is paid.</Typography></TableCell></TableRow>}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination component="div" count={q.data?.meta.total ?? 0} page={page} rowsPerPage={pageSize}
          onPageChange={(_, p) => setPage(p)} onRowsPerPageChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }} rowsPerPageOptions={[10, 25, 50, 100]} />
      </Paper>
    </>
  );
}
