import { Card, CardActionArea, CardContent, Chip, Grid, Stack, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { PageHeader } from '../components/common';
import { visibleNav } from '../navigation';

/**
 * Dashboard shell. KPI cards (cherry purchased today, lots in fermentation,
 * beds drying, pending approvals…) are added by the phases that own the data.
 */
export function DashboardPage() {
  const { user } = useAuth();
  const modules = visibleNav(user).filter((i) => i.path !== '/');
  return (
    <>
      <PageHeader title={`Welcome, ${user?.fullName.split(' ')[0] ?? ''}`} subtitle="Your modules, based on your role." />
      <Grid container spacing={2}>
        {modules.map((m) => (
          <Grid key={m.path} size={{ xs: 12, sm: 6, lg: 4 }}>
            <Card variant="outlined" sx={{ height: '100%' }}>
              <CardActionArea component={RouterLink} to={m.path} sx={{ height: '100%' }}>
                <CardContent>
                  <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                    {m.icon}
                    <Typography variant="subtitle1" sx={{ fontWeight: 600, flexGrow: 1 }}>{m.label}</Typography>
                    <Chip size="small" label={m.phase === 1 ? 'Available' : `Phase ${m.phase}`} color={m.phase === 1 ? 'success' : 'default'} variant="outlined" />
                  </Stack>
                </CardContent>
              </CardActionArea>
            </Card>
          </Grid>
        ))}
      </Grid>
    </>
  );
}
