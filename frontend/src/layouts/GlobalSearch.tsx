import SearchIcon from '@mui/icons-material/Search';
import { Autocomplete, Box, Dialog, IconButton, InputAdornment, TextField, Tooltip, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { lotsApi } from '../api/processing';
import { purchasesApi, suppliersApi } from '../api/procurement';
import { useAuth } from '../auth/useAuth';
import { humanize } from '../utils/format';

export interface SearchHit {
  group: 'Lots' | 'Purchase vouchers' | 'Suppliers';
  id: string;
  label: string;
  detail: string;
  to: string;
}

const LIMIT = 5;

/**
 * Finds lots, vouchers and suppliers by number / name (spec §6) — only in the
 * lists the user may read. Phase 5 adds QR scanning to the same box.
 */
export function useGlobalSearch(term: string) {
  const { can } = useAuth();
  const [debounced, setDebounced] = useState(term.trim());
  useEffect(() => {
    const t = setTimeout(() => setDebounced(term.trim()), 300);
    return () => clearTimeout(t);
  }, [term]);
  const q = debounced;
  const enabled = q.length >= 2;
  const lots = useQuery({
    queryKey: ['global-search', 'lots', q], enabled: enabled && can(['lot:read', 'lot:lookup']),
    queryFn: () => lotsApi.list({ page: 1, pageSize: LIMIT, search: q }),
  });
  const vouchers = useQuery({
    queryKey: ['global-search', 'purchases', q], enabled: enabled && can('purchase:read'),
    queryFn: () => purchasesApi.list({ page: 1, pageSize: LIMIT, search: q }),
  });
  const suppliers = useQuery({
    queryKey: ['global-search', 'suppliers', q], enabled: enabled && can('supplier:read'),
    queryFn: () => suppliersApi.list({ page: 1, pageSize: LIMIT, search: q }),
  });
  const hits: SearchHit[] = enabled ? [
    ...(lots.data?.data ?? []).map((l) => ({ group: 'Lots' as const, id: l.id, label: l.lotNumber, detail: `${humanize(l.currentStage)} · ${humanize(l.status)}`, to: `/lots/${l.id}` })),
    ...(vouchers.data?.data ?? []).map((v) => ({ group: 'Purchase vouchers' as const, id: v.id, label: v.voucherNo, detail: `${v.supplierName} · ${v.voucherDate}`, to: `/purchases/${v.id}` })),
    ...(suppliers.data?.data ?? []).map((s) => ({ group: 'Suppliers' as const, id: s.id, label: s.fullName, detail: s.supplierCode, to: `/suppliers/${s.id}` })),
  ] : [];
  const loading = enabled && (q !== term.trim() || lots.isFetching || vouchers.isFetching || suppliers.isFetching);
  return { hits, loading, ready: enabled };
}

function SearchBox({ autoFocus, onDone }: { autoFocus?: boolean; onDone?: () => void }) {
  const navigate = useNavigate();
  const [term, setTerm] = useState('');
  const { hits, loading, ready } = useGlobalSearch(term);
  return (
    <Autocomplete<SearchHit, false, false, true>
      freeSolo
      options={hits}
      groupBy={(h) => h.group}
      getOptionLabel={(h) => (typeof h === 'string' ? h : h.label)}
      filterOptions={(o) => o} // the API already filtered
      loading={loading}
      inputValue={term}
      onInputChange={(_, v, reason) => { if (reason !== 'reset') setTerm(v); }}
      onChange={(_, h) => {
        if (h && typeof h !== 'string') { navigate(h.to); setTerm(''); onDone?.(); }
      }}
      noOptionsText={ready ? 'Nothing found' : 'Type at least 2 characters'}
      loadingText="Searching…"
      renderOption={({ key, ...props }, h) => (
        <Box component="li" key={key} {...props} sx={{ display: 'block !important' }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>{h.label}</Typography>
          <Typography variant="caption" color="text.secondary">{h.detail}</Typography>
        </Box>
      )}
      sx={{ width: { xs: '100%', md: 360 } }}
      renderInput={(params) => (
        <TextField
          {...params}
          autoFocus={autoFocus}
          size="small"
          placeholder="Search lot, voucher or supplier"
          slotProps={{
            ...params.slotProps,
            htmlInput: { ...params.slotProps.htmlInput, 'aria-label': 'Search lot, voucher or supplier' },
            input: { ...params.slotProps.input, startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> },
          }}
          sx={{ '& .MuiOutlinedInput-root': { bgcolor: 'background.paper' } }}
        />
      )}
    />
  );
}

/** Inline search on desktop; a search button that opens a full-width search on phones. */
export function GlobalSearch({ compact }: { compact: boolean }) {
  const [open, setOpen] = useState(false);
  if (!compact) return <SearchBox />;
  return (
    <>
      <Tooltip title="Search">
        <IconButton color="inherit" aria-label="Search" onClick={() => setOpen(true)}><SearchIcon /></IconButton>
      </Tooltip>
      <Dialog open={open} onClose={() => setOpen(false)} fullWidth slotProps={{ paper: { sx: { alignSelf: 'flex-start', mt: 2, p: 2 } } }}>
        <SearchBox autoFocus onDone={() => setOpen(false)} />
      </Dialog>
    </>
  );
}
