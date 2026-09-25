import AddIcon from '@mui/icons-material/Add';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, FormGroup, FormLabel, IconButton,
  Menu, MenuItem, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TablePagination, TableRow, TextField, Typography,
} from '@mui/material';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { rolesApi, usersApi } from '../../api/endpoints';
import type { User } from '../../api/types';
import { Can } from '../../auth/Can';
import { ErrorAlert, Loading, PageHeader, StatusChip } from '../../components/common';
import { ReasonDialog } from '../../components/ReasonDialog';
import { formatDateTime, humanize } from '../../utils/format';

export const ROLE_CODES = [
  'SUPER_ADMIN', 'SITE_MANAGER', 'QUALITY_INSPECTOR', 'PURCHASING_CLERK', 'CASHIER_ACCOUNTANT', 'PULPING_OPERATOR',
  'DRYING_SUPERVISOR', 'STOREKEEPER', 'CAPITA', 'TEMP_WORKER', 'AUDITOR',
] as const;

function RoleCheckboxes({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  return (
    <FormGroup sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
      {ROLE_CODES.map((r) => (
        <FormControlLabel key={r} label={humanize(r)} control={
          <Checkbox checked={value.includes(r)} onChange={(e) => onChange(e.target.checked ? [...value, r] : value.filter((x) => x !== r))} />
        } />
      ))}
    </FormGroup>
  );
}

const createSchema = z.object({
  username: z.string().trim().min(3).max(50).regex(/^[a-zA-Z0-9._-]+$/, 'Letters, digits, dot, dash, underscore'),
  fullName: z.string().trim().min(2).max(150),
  email: z.union([z.literal(''), z.email()]),
  phone: z.string().trim().max(30),
  roleCodes: z.array(z.string()).min(1, 'Choose at least one role'),
  temporaryPassword: z.string().min(10, 'At least 10 characters'),
});
type CreateForm = z.infer<typeof createSchema>;

function CreateUserDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { register, control, handleSubmit, formState, reset } = useForm<CreateForm>({
    resolver: zodResolver(createSchema),
    defaultValues: { username: '', fullName: '', email: '', phone: '', roleCodes: [], temporaryPassword: '' },
  });
  const m = useMutation({
    mutationFn: (f: CreateForm) => usersApi.create({ ...f, email: f.email || null, phone: f.phone || null }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); reset(); onClose(); },
  });
  const err = (k: keyof CreateForm) => ({ error: !!formState.errors[k], helperText: formState.errors[k]?.message as string | undefined });
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>New user</DialogTitle>
      <DialogContent>
        <ErrorAlert error={m.error} />
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField label="Username" {...register('username')} {...err('username')} />
          <TextField label="Full name" {...register('fullName')} {...err('fullName')} />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField fullWidth label="E-mail (optional)" {...register('email')} {...err('email')} />
            <TextField fullWidth label="Phone (optional)" {...register('phone')} {...err('phone')} />
          </Stack>
          <TextField label="Temporary password" type="password" autoComplete="new-password" {...register('temporaryPassword')}
            {...err('temporaryPassword')} />
          <FormLabel>Roles</FormLabel>
          <Controller control={control} name="roleCodes" render={({ field }) => <RoleCheckboxes value={field.value} onChange={field.onChange} />} />
          {formState.errors.roleCodes && <Typography color="error" variant="caption">{formState.errors.roleCodes.message}</Typography>}
          <Typography variant="body2" color="text.secondary">The user must change the temporary password at first sign-in.</Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={m.isPending} onClick={handleSubmit((f) => m.mutate(f))}>Create user</Button>
      </DialogActions>
    </Dialog>
  );
}

function EditRolesDialog({ user, onClose }: { user: User; onClose: () => void }) {
  const qc = useQueryClient();
  const [roles, setRoles] = useState<string[]>(user.roles);
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () => usersApi.setRoles(user.id, roles, reason.trim()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); onClose(); },
  });
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Roles of {user.fullName}</DialogTitle>
      <DialogContent>
        <ErrorAlert error={m.error} />
        <RoleCheckboxes value={roles} onChange={setRoles} />
        <TextField sx={{ mt: 2 }} fullWidth label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} helperText="Recorded in the audit log" />
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          Segregation of duties still applies: holding two roles never lets one person approve their own work.
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={m.isPending || roles.length === 0 || reason.trim().length < 3} onClick={() => m.mutate()}>Save roles</Button>
      </DialogActions>
    </Dialog>
  );
}

function ResetPasswordDialog({ user, onClose }: { user: User; onClose: () => void }) {
  const qc = useQueryClient();
  const [pw, setPw] = useState('');
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () => usersApi.resetPassword(user.id, pw, reason.trim()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); onClose(); },
  });
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Reset password</DialogTitle>
      <DialogContent>
        <ErrorAlert error={m.error} />
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Typography variant="body2">{user.fullName} will have to choose a new password at next sign-in. All their sessions end now.</Typography>
          <TextField label="Temporary password" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
          <TextField label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={m.isPending || pw.length < 10 || reason.trim().length < 3} onClick={() => m.mutate()}>Reset</Button>
      </DialogActions>
    </Dialog>
  );
}

type Action = { kind: 'roles' | 'reset' | 'deactivate' | 'activate' | 'unlock'; user: User };

export function UsersPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [role, setRole] = useState('');
  const [creating, setCreating] = useState(false);
  const [menu, setMenu] = useState<{ anchor: HTMLElement; user: User } | null>(null);
  const [action, setAction] = useState<Action | null>(null);

  const q = useQuery({
    queryKey: ['users', { page, pageSize, search, status, role }],
    queryFn: () => usersApi.list({ page: page + 1, pageSize, search: search.trim() || undefined, status: status || undefined, role: role || undefined }),
    placeholderData: keepPreviousData,
  });
  useQuery({ queryKey: ['roles'], queryFn: rolesApi.list, staleTime: 300_000 }); // warm cache for the roles page

  const statusAction = action && ['deactivate', 'activate', 'unlock'].includes(action.kind) ? action : null;

  return (
    <>
      <PageHeader title="Users" subtitle="Sign-in accounts and their roles"
        actions={<Can permission="user:manage"><Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreating(true)}>New user</Button></Can>} />
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mb: 2 }}>
        <TextField size="small" label="Search name or username" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} sx={{ minWidth: 260 }} />
        <TextField size="small" select label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }} sx={{ minWidth: 160 }}>
          <MenuItem value="">All</MenuItem>
          {['ACTIVE', 'INACTIVE', 'LOCKED'].map((s) => <MenuItem key={s} value={s}>{humanize(s)}</MenuItem>)}
        </TextField>
        <TextField size="small" select label="Role" value={role} onChange={(e) => { setRole(e.target.value); setPage(0); }} sx={{ minWidth: 220 }}>
          <MenuItem value="">All roles</MenuItem>
          {ROLE_CODES.map((r) => <MenuItem key={r} value={r}>{humanize(r)}</MenuItem>)}
        </TextField>
      </Stack>
      <ErrorAlert error={q.error} />
      <Paper variant="outlined">
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Username</TableCell>
                <TableCell>Roles</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Last sign-in</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {q.isLoading && <TableRow><TableCell colSpan={6}><Loading /></TableCell></TableRow>}
              {q.data?.data.map((u) => (
                <TableRow key={u.id} hover>
                  <TableCell>{u.fullName}{u.mustChangePassword && <Typography variant="caption" color="text.secondary" component="div">Must change password</Typography>}</TableCell>
                  <TableCell>{u.username}</TableCell>
                  <TableCell>{u.roles.map(humanize).join(', ')}</TableCell>
                  <TableCell><StatusChip status={u.status} label={humanize(u.status)} /></TableCell>
                  <TableCell>{formatDateTime(u.lastLoginAt)}</TableCell>
                  <TableCell align="right">
                    <Can permission="user:manage">
                      <IconButton aria-label={`Actions for ${u.username}`} onClick={(e) => setMenu({ anchor: e.currentTarget, user: u })}><MoreVertIcon /></IconButton>
                    </Can>
                  </TableCell>
                </TableRow>
              ))}
              {q.data && q.data.data.length === 0 && <TableRow><TableCell colSpan={6}><Typography color="text.secondary" sx={{ p: 2 }}>No users match.</Typography></TableCell></TableRow>}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination component="div" count={q.data?.meta.total ?? 0} page={page} rowsPerPage={pageSize}
          onPageChange={(_, p) => setPage(p)} onRowsPerPageChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }} rowsPerPageOptions={[10, 25, 50, 100]} />
      </Paper>

      <Menu anchorEl={menu?.anchor} open={!!menu} onClose={() => setMenu(null)}>
        {menu && [
          <MenuItem key="roles" onClick={() => { setAction({ kind: 'roles', user: menu.user }); setMenu(null); }}>Edit roles</MenuItem>,
          <MenuItem key="reset" onClick={() => { setAction({ kind: 'reset', user: menu.user }); setMenu(null); }}>Reset password</MenuItem>,
          menu.user.status === 'LOCKED' && <MenuItem key="unlock" onClick={() => { setAction({ kind: 'unlock', user: menu.user }); setMenu(null); }}>Unlock</MenuItem>,
          menu.user.status === 'INACTIVE'
            ? <MenuItem key="activate" onClick={() => { setAction({ kind: 'activate', user: menu.user }); setMenu(null); }}>Activate</MenuItem>
            : <MenuItem key="deactivate" sx={{ color: 'error.main' }} onClick={() => { setAction({ kind: 'deactivate', user: menu.user }); setMenu(null); }}>Deactivate</MenuItem>,
        ]}
      </Menu>

      <CreateUserDialog open={creating} onClose={() => setCreating(false)} />
      {action?.kind === 'roles' && <EditRolesDialog user={action.user} onClose={() => setAction(null)} />}
      {action?.kind === 'reset' && <ResetPasswordDialog user={action.user} onClose={() => setAction(null)} />}
      {statusAction && (
        <ReasonDialog open title={`${humanize(statusAction.kind)} ${statusAction.user.fullName}`}
          message={statusAction.kind === 'deactivate' ? 'The user is signed out everywhere and can no longer sign in.' : undefined}
          confirmLabel={humanize(statusAction.kind)} danger={statusAction.kind === 'deactivate'} onClose={() => setAction(null)}
          onConfirm={async (reason) => {
            await usersApi.setStatus(statusAction.user.id, statusAction.kind as 'deactivate' | 'activate' | 'unlock', reason);
            await qc.invalidateQueries({ queryKey: ['users'] });
          }} />
      )}
    </>
  );
}
