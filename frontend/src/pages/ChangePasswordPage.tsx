import { zodResolver } from '@hookform/resolvers/zod';
import { Button, Stack, TextField } from '@mui/material';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { useAuth } from '../auth/useAuth';
import { ErrorAlert } from '../components/common';
import { AuthLayout } from '../layouts/AuthLayout';

// Mirrors the default auth.passwordPolicy; the server applies the configured policy.
const schema = z
  .object({
    currentPassword: z.string().min(1, 'Required'),
    newPassword: z.string().min(10, 'At least 10 characters').regex(/\p{L}/u, 'Include a letter').regex(/\d/, 'Include a digit'),
    confirm: z.string(),
  })
  .refine((f) => f.newPassword === f.confirm, { path: ['confirm'], message: 'Passwords do not match' })
  .refine((f) => f.newPassword !== f.currentPassword, { path: ['newPassword'], message: 'Choose a different password' });
type Form = z.infer<typeof schema>;

export function ChangePasswordPage() {
  const { user, changePassword, logout } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<unknown>(null);
  const { register, handleSubmit, formState } = useForm<Form>({ resolver: zodResolver(schema) });
  const onSubmit = handleSubmit(async (f) => {
    setError(null);
    try {
      await changePassword(f.currentPassword, f.newPassword);
      navigate('/', { replace: true });
    } catch (e) {
      setError(e);
    }
  });
  const field = (name: keyof Form, label: string, autoComplete: string) => (
    <TextField label={label} type="password" autoComplete={autoComplete} {...register(name)} error={!!formState.errors[name]} helperText={formState.errors[name]?.message} />
  );
  return (
    <AuthLayout title="Change your password" subtitle={user?.mustChangePassword ? 'You must set a new password before continuing.' : 'At least 10 characters, with a letter and a digit.'}>
      <ErrorAlert error={error} />
      <Stack component="form" spacing={2} onSubmit={onSubmit} noValidate>
        {field('currentPassword', 'Current password', 'current-password')}
        {field('newPassword', 'New password', 'new-password')}
        {field('confirm', 'Repeat new password', 'new-password')}
        <Button type="submit" variant="contained" size="large" disabled={formState.isSubmitting}>Save password</Button>
        {user?.mustChangePassword
          ? <Button onClick={async () => { await logout(); navigate('/login'); }}>Sign out</Button>
          : <Button onClick={() => navigate(-1)}>Back</Button>}
      </Stack>
    </AuthLayout>
  );
}
