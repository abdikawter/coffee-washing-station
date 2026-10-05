import {
  Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Stack, TextField, Typography,
} from '@mui/material';
import type { GridColDef } from '@mui/x-data-grid';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { rolesApi } from '../../api/endpoints';
import type { Permission, Role } from '../../api/types';
import { useAuth } from '../../auth/useAuth';
import { DataTable, ErrorAlert } from '../../components';
import { ListTemplate } from '../../templates';
import { humanize } from '../../utils/format';

function groupByModule(perms: Permission[]): [string, Permission[]][] {
  const map = new Map<string, Permission[]>();
  for (const p of perms) map.set(p.module, [...(map.get(p.module) ?? []), p]);
  return [...map.entries()];
}

function EditPermissionsDialog({ role, all, onClose }: { role: Role; all: Permission[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState(new Set(role.permissions));
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () => rolesApi.setPermissions(role.id, [...selected], reason.trim()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['roles'] }); onClose(); },
  });
  const toggle = (code: string) => setSelected((s) => { const n = new Set(s); if (n.has(code)) n.delete(code); else n.add(code); return n; });
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>Permissions of {role.name}</DialogTitle>
      <DialogContent dividers>
        <ErrorAlert error={m.error} />
        {groupByModule(all).map(([module, perms]) => (
          <Box key={module} sx={{ mb: 2 }}>
            <Typography variant="overline">{humanize(module)}</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
              {perms.map((p) => (
                <FormControlLabel key={p.code} control={<Checkbox size="small" checked={selected.has(p.code)} onChange={() => toggle(p.code)} />}
                  label={<span><code>{p.code}</code> — {p.description}</span>} />
              ))}
            </Box>
          </Box>
        ))}
      </DialogContent>
      <DialogActions sx={{ gap: 1, flexWrap: 'wrap' }}>
        <TextField size="small" label="Reason (audited)" value={reason} onChange={(e) => setReason(e.target.value)} sx={{ flexGrow: 1 }} />
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={m.isPending || reason.trim().length < 3} onClick={() => m.mutate()}>Save</Button>
      </DialogActions>
    </Dialog>
  );
}

/** Permissions of one role, grouped by module (quick view). */
function RolePermissions({ role, descriptions, canEdit, onEdit }: { role: Role; descriptions: Map<string, string | null>; canEdit: boolean; onEdit: () => void }) {
  const byModule = new Map<string, string[]>();
  for (const p of role.permissions) { const m = p.split(':')[0]!; byModule.set(m, [...(byModule.get(m) ?? []), p]); }
  return (
    <Stack spacing={2.5}>
      {role.description && <Typography color="text.secondary">{role.description}</Typography>}
      <Stack direction="row" spacing={1}>
        <Chip label={`${role.permissions.length} permissions`} />
        <Chip variant="outlined" label={`${role.userCount} users`} />
        {role.isSystem && <Chip variant="outlined" label="System role" />}
      </Stack>
      {canEdit && <Box><Button variant="contained" onClick={onEdit}>Edit permissions</Button></Box>}
      {[...byModule.entries()].map(([module, codes]) => (
        <Box key={module}>
          <Typography variant="overline" color="text.secondary">{humanize(module)}</Typography>
          <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.75 }}>
            {codes.map((c) => <Chip key={c} size="small" variant="outlined" label={c.split(':').slice(1).join(':')} title={descriptions.get(c) ?? c} />)}
          </Stack>
        </Box>
      ))}
    </Stack>
  );
}

/** Role–permission matrix (ARCHITECTURE.md §7), editable by holders of role:manage. */
export function RolesPage() {
  const { can } = useAuth();
  const roles = useQuery({ queryKey: ['roles'], queryFn: rolesApi.list });
  const perms = useQuery({ queryKey: ['permissions'], queryFn: rolesApi.permissions, staleTime: 600_000 });
  const [peekId, setPeekId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Role | null>(null);
  const descriptions = useMemo(() => new Map(perms.data?.map((p) => [p.code, p.description]) ?? []), [perms.data]);
  const peek = roles.data?.find((r) => r.id === peekId) ?? null;

  const columns: GridColDef<Role>[] = [
    { field: 'name', headerName: 'Role', flex: 1, minWidth: 180 },
    { field: 'description', headerName: 'Description', flex: 2, minWidth: 220 },
    { field: 'permissions', headerName: 'Permissions', type: 'number', minWidth: 120, valueGetter: (_v, r) => r.permissions.length },
    { field: 'userCount', headerName: 'Users', type: 'number', minWidth: 90 },
  ];

  return (
    <ListTemplate title="Roles & permissions" subtitle="What each role may do. Changes apply immediately." error={roles.error ?? perms.error}
      quickView={{
        open: Boolean(peek), title: peek?.name ?? '', onClose: () => setPeekId(null),
        children: peek && <RolePermissions role={peek} descriptions={descriptions} canEdit={can('role:manage') && Boolean(perms.data)} onEdit={() => setEditing(peek)} />,
      }}>
      <DataTable label="Roles" loading={roles.isLoading} rows={roles.data ?? []} columns={columns} onRowClick={(r) => setPeekId(r.id)} />
      {editing && perms.data && <EditPermissionsDialog role={editing} all={perms.data} onClose={() => setEditing(null)} />}
    </ListTemplate>
  );
}
