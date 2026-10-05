import AddIcon from '@mui/icons-material/Add';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, FormGroup, FormLabel, Stack, TextField, Typography,
} from '@mui/material';
import type { GridColDef } from '@mui/x-data-grid';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { rolesApi, usersApi } from '../../api/endpoints';
import type { User } from '../../api/types';
import { Can } from '../../auth/Can';
import { columns as col, DataTable, ErrorAlert, Field, ReasonDialog, StatusChip, useTableQuery, useUrlFilters } from '../../components';
import { ListTemplate } from '../../templates';
import { formatDateTime, humanize } from '../../utils/format';

/** Roles come from the server (only SUPER_ADMIN for now; more roles are added later without UI changes). */
function useRoles() {
  return useQuery({ queryKey: ['roles'], queryFn: rolesApi.list, staleTime: 300_000 }).data ?? [];
}

function RoleCheckboxes({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const roles = useRoles();
  return (
    <FormGroup sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
      {roles.map(({ code: r, name }) => (
        <FormControlLabel key={r} label={name} control={
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

const STATUSES = ['ACTIVE', 'INACTIVE', 'LOCKED'] as const;

/** Quick view of one user with the actions an administrator may take. */
function UserSummary({ user, onAction }: { user: User; onAction: (a: Action) => void }) {
  const act = (kind: Action['kind']) => () => onAction({ kind, user });
  return (
    <Stack spacing={3}>
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: '1fr 1fr' }}>
        <Field label="Username">{user.username}</Field>
        <Field label="Status"><StatusChip status={user.status} domain="user" /></Field>
        <Field label="E-mail">{user.email}</Field>
        <Field label="Phone">{user.phone}</Field>
        <Field label="Last sign-in">{formatDateTime(user.lastLoginAt)}</Field>
        <Field label="Created">{formatDateTime(user.createdAt)}</Field>
      </Box>
      <Field label="Roles">{user.roles.length ? user.roles.map(humanize).join(', ') : 'None'}</Field>
      {user.mustChangePassword && <Typography variant="body2" color="text.secondary">Must change the password at next sign-in.</Typography>}
      <Can permission="user:manage">
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
          <Button variant="outlined" onClick={act('roles')}>Edit roles</Button>
          <Button variant="outlined" onClick={act('reset')}>Reset password</Button>
          {user.status === 'LOCKED' && <Button variant="outlined" onClick={act('unlock')}>Unlock</Button>}
          {user.status === 'INACTIVE'
            ? <Button variant="outlined" onClick={act('activate')}>Activate</Button>
            : <Button variant="outlined" color="error" onClick={act('deactivate')}>Deactivate</Button>}
        </Stack>
      </Can>
    </Stack>
  );
}

export function UsersPage() {
  const qc = useQueryClient();
  const { table, apiParams } = useTableQuery();
  const { get } = useUrlFilters();
  const [creating, setCreating] = useState(false);
  const [peekId, setPeekId] = useState<string | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const roles = useRoles();

  const filters = { search: get('search') || undefined, status: get('status') || undefined, role: get('role') || undefined };
  const q = useQuery({
    queryKey: ['users', apiParams, filters],
    queryFn: () => usersApi.list({ ...apiParams, ...filters }),
    placeholderData: keepPreviousData,
  });
  const peek = q.data?.data.find((u) => u.id === peekId) ?? null; // follows refetches after an action

  const statusAction = action && ['deactivate', 'activate', 'unlock'].includes(action.kind) ? action : null;

  const columns: GridColDef<User>[] = [
    {
      field: 'fullName', headerName: 'Name', flex: 1, minWidth: 180,
      renderCell: (p) => <Box sx={{ lineHeight: 1.3 }}>{p.row.fullName}{p.row.mustChangePassword && <Typography variant="caption" color="text.secondary" component="div">Must change password</Typography>}</Box>,
    },
    { field: 'username', headerName: 'Username', minWidth: 140 },
    { field: 'roles', headerName: 'Roles', flex: 1, minWidth: 160, valueGetter: (_v, r) => r.roles.map(humanize).join(', ') },
    col.status<User>('status', 'Status', 'user'),
    col.dateTime<User>('lastLoginAt', 'Last sign-in'),
  ];

  return (
    <ListTemplate
      title="Users" subtitle="Sign-in accounts and their roles" error={q.error}
      actions={<Can permission="user:manage"><Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreating(true)}>New user</Button></Can>}
      filters={[
        { type: 'search', key: 'search', label: 'Search name or username' },
        { type: 'select', key: 'status', label: 'Status', options: STATUSES.map((s) => ({ value: s, label: humanize(s) })) },
        { type: 'select', key: 'role', label: 'Role', options: roles.map((r) => ({ value: r.code, label: r.name })) },
      ]}
      quickView={{ open: Boolean(peek), title: peek?.fullName ?? '', onClose: () => setPeekId(null), children: peek && <UserSummary user={peek} onAction={setAction} /> }}
    >
      <DataTable label="Users" loading={q.isFetching} rows={q.data?.data ?? []} columns={columns}
        server={{ state: table, rowCount: q.data?.meta.total ?? 0, sortFields: ['username', 'fullName', 'lastLoginAt'] }}
        onRowClick={(u) => setPeekId(u.id)} empty={{ title: 'No users match', message: 'Change the filters or create a new user.' }} />

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
    </ListTemplate>
  );
}
