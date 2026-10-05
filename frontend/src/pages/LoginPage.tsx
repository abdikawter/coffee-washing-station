import { zodResolver } from '@hookform/resolvers/zod';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import { Button, IconButton, InputAdornment, Stack, TextField } from '@mui/material';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { useAuth } from '../auth/useAuth';
import { ErrorAlert } from '../components/common';
import { AuthLayout } from '../layouts/AuthLayout';

const schema = z.object({ username: z.string().trim().min(1, 'Enter your username'), password: z.string().min(1, 'Enter your password') });
type Form = z.infer<typeof schema>;

export function LoginPage() {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState<unknown>(null);
  const [showPassword, setShowPassword] = useState(false);
  const { register, handleSubmit, formState } = useForm<Form>({ resolver: zodResolver(schema) });

  if (user) return <Navigate to="/" replace />;

  const onSubmit = handleSubmit(async (f) => {
    setError(null);
    try {
      const u = await login(f.username, f.password);
      const from = (location.state as { from?: string } | null)?.from ?? '/';
      navigate(u.mustChangePassword ? '/change-password' : from, { replace: true });
    } catch (e) {
      setError(e);
    }
  });

  return (
    <AuthLayout title="Sign in" subtitle="Use the account your station administrator gave you.">
      <ErrorAlert error={error} />
      <Stack component="form" spacing={2} onSubmit={onSubmit} noValidate>
        <TextField label="Username" autoComplete="username" autoFocus {...register('username')}
          error={!!formState.errors.username} helperText={formState.errors.username?.message} />
        <TextField label="Password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" {...register('password')}
          error={!!formState.errors.password} helperText={formState.errors.password?.message}
          slotProps={{
            input: {
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton onClick={() => setShowPassword((s) => !s)} edge="end" aria-label={showPassword ? 'Hide password' : 'Show password'}>
                    {showPassword ? <VisibilityOff /> : <Visibility />}
                  </IconButton>
                </InputAdornment>
              ),
            },
          }} />
        <Button type="submit" variant="contained" size="large" disabled={formState.isSubmitting}>
          {formState.isSubmitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </Stack>
    </AuthLayout>
  );
}
