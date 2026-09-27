import { Autocomplete, TextField } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { suppliersApi, type Supplier } from '../api/procurement';

/** Searchable supplier selector (ACTIVE suppliers only — the only ones that can be inspected or bought from). */
export function SupplierPicker({ value, onChange, label = 'Supplier' }: { value: Supplier | null; onChange: (s: Supplier | null) => void; label?: string }) {
  const [input, setInput] = useState('');
  const q = useQuery({
    queryKey: ['suppliers', 'picker', input],
    queryFn: () => suppliersApi.list({ page: 1, pageSize: 20, status: 'ACTIVE', search: input.trim() || undefined }),
    staleTime: 30_000,
  });
  return (
    <Autocomplete
      value={value}
      onChange={(_, v) => onChange(v)}
      inputValue={input}
      onInputChange={(_, v) => setInput(v)}
      options={q.data?.data ?? []}
      loading={q.isFetching}
      filterOptions={(x) => x}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      getOptionLabel={(s) => `${s.fullName} · ${s.supplierCode}${s.village ? ` · ${s.village}` : ''}`}
      renderInput={(params) => <TextField {...params} label={label} placeholder="Name, ID, phone or village" />}
    />
  );
}
