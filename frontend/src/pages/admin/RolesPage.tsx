import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import {
  Accordion, AccordionDetails, AccordionSummary, Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControlLabel, Stack, TextField, Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { rolesApi } from '../../api/endpoints';
import type { Permission, Role } from '../../api/types';
import { Can } from '../../auth/Can';
import { ErrorAlert, Loading, PageHeader } from '../../components/common';

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
            <Typography variant="overline">{module}</Typography>
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

/** Role–permission matrix (ARCHITECTURE.md §7), editable by holders of role:manage. */
export function RolesPage() {
  const roles = useQuery({ queryKey: ['roles'], queryFn: rolesApi.list });
  const perms = useQuery({ queryKey: ['permissions'], queryFn: rolesApi.permissions, staleTime: 600_000 });
  const [editing, setEditing] = useState<Role | null>(null);
  const descriptions = useMemo(() => new Map(perms.data?.map((p) => [p.code, p.description]) ?? []), [perms.data]);

  return (
    <>
      <PageHeader title="Roles & permissions" subtitle="What each role may do. Code checks permissions, so changes apply immediately." />
      <ErrorAlert error={roles.error ?? perms.error} />
      {(roles.isLoading || perms.isLoading) && <Loading />}
      {roles.data?.map((r) => (
        <Accordion key={r.id} disableGutters variant="outlined">
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Stack direction="row" spacing={2} sx={{ alignItems: 'center', width: '100%' }}>
              <Typography sx={{ fontWeight: 600, minWidth: 200 }}>{r.name}</Typography>
              <Typography color="text.secondary" sx={{ flexGrow: 1, display: { xs: 'none', md: 'block' } }}>{r.description}</Typography>
              <Chip size="small" label={`${r.permissions.length} permissions`} />
              <Chip size="small" variant="outlined" label={`${r.userCount} users`} />
            </Stack>
          </AccordionSummary>
          <AccordionDetails>
            <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.75, mb: 2 }}>
              {r.permissions.map((p) => <Chip key={p} size="small" variant="outlined" label={p} title={descriptions.get(p) ?? undefined} />)}
            </Stack>
            <Can permission="role:manage">
              <Button variant="outlined" disabled={!perms.data} onClick={() => setEditing(r)}>Edit permissions</Button>
            </Can>
          </AccordionDetails>
        </Accordion>
      ))}
      {editing && perms.data && <EditPermissionsDialog role={editing} all={perms.data} onClose={() => setEditing(null)} />}
    </>
  );
}
