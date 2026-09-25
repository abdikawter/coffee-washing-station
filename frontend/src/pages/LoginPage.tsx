import { zodResolver } from '@hookform/resolvers/zod';
import { Box, Button, Card, CardContent, Stack, TextField, Typography } from '@mui/material';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { useAuth } from '../auth/useAuth';
import { ErrorAlert } from '../components/common';

const schema = z.object({ username: z.string().trim().min(1, 'Enter your username'), password: z.string().min(1, 'Enter your password') });
type Form = z.infer<typeof schema>;

export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: 2, bgcolor: 'background.default' }}>
      <Card sx={{ width: '100%', maxWidth: 420 }} variant="outlined">
        <CardContent sx={{ p: 4 }}>
          <Typography variant="h5" component="h1" gutterBottom>{title}</Typography>
          {subtitle && <Typography color="text.secondary" sx={{ mb: 3 }}>{subtitle}</Typography>}
          {children}
        </CardContent>
      </Card>
    </Box>
  );
}

export function LoginPage() {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState<unknown>(null);
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
    <AuthCard title="Coffee Washing Station" subtitle="Sign in to continue">
      <ErrorAlert error={error} />
      <Stack component="form" spacing={2} onSubmit={onSubmit} noValidate>
        <TextField label="Username" autoComplete="username" autoFocus {...register('username')}
          error={!!formState.errors.username} helperText={formState.errors.username?.message} />
        <TextField label="Password" type="password" autoComplete="current-password" {...register('password')}
          error={!!formState.errors.password} helperText={formState.errors.password?.message} />
        <Button type="submit" variant="contained" size="large" disabled={formState.isSubmitting}>Sign in</Button>
      </Stack>
    </AuthCard>
  );
}
