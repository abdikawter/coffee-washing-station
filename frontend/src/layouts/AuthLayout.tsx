import { Box, Stack, Typography } from '@mui/material';
import type { ReactNode } from 'react';

/** Coffee branch with ripe cherries — drawn in theme colours, so it follows light / dark / high contrast. */
function CoffeeBranch() {
  const leaf = (x: number, y: number, r: number, k: string) => (
    <ellipse key={k} cx={x} cy={y} rx="34" ry="13" transform={`rotate(${r} ${x} ${y})`} />
  );
  const cherry = (x: number, y: number, k: string, r = 13) => (
    <g key={k}>
      <circle cx={x} cy={y} r={r} />
      <circle cx={x - r / 3} cy={y - r / 3} r={r / 4} fill="currentColor" opacity="0.35" />
    </g>
  );
  return (
    <Box component="svg" viewBox="0 0 320 260" role="img" aria-label="Coffee branch with ripe cherries"
      sx={{ width: '100%', maxWidth: 360, height: 'auto', color: 'primary.contrastText' }}>
      <path d="M10 210 C 90 170, 150 150, 310 60" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" opacity="0.7" />
      <Box component="g" sx={{ fill: (t) => t.vars?.palette.success.light ?? t.palette.success.light, opacity: 0.9 }}>
        {[leaf(70, 165, -60, 'a'), leaf(105, 205, 25, 'b'), leaf(165, 115, -55, 'c'), leaf(200, 160, 30, 'd'), leaf(250, 70, -50, 'e'), leaf(282, 108, 35, 'f')]}
      </Box>
      <Box component="g" sx={{ fill: (t) => t.vars?.palette.secondary.main ?? t.palette.secondary.main }}>
        {[cherry(128, 172, '1'), cherry(150, 182, '2', 12), cherry(138, 196, '3', 11), cherry(222, 120, '4'), cherry(240, 132, '5', 12)]}
      </Box>
    </Box>
  );
}

/**
 * Sign-in / password pages (spec §6): coffee illustration on one side, the form on
 * the other; stacked on phones (short brand strip above the form).
 */
export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', gridTemplateColumns: { xs: '1fr', md: '5fr 6fr' }, bgcolor: 'background.default' }}>
      <Box
        component="aside"
        sx={{
          bgcolor: 'primary.main', color: 'primary.contrastText', px: { xs: 3, md: 6 }, py: { xs: 3, md: 6 },
          display: 'flex', flexDirection: 'column', justifyContent: { md: 'space-between' }, gap: 3,
        }}
      >
        <Box>
          <Typography variant="overline" sx={{ opacity: 0.8 }}>Coffee Washing Station</Typography>
          <Typography variant="h4" component="p" sx={{ mt: 0.5, maxWidth: 420, display: { xs: 'none', sm: 'block' } }}>
            From red cherry to export parchment, every kilo traced.
          </Typography>
        </Box>
        <Box sx={{ display: { xs: 'none', md: 'flex' }, justifyContent: 'center' }}><CoffeeBranch /></Box>
        <Typography variant="body2" sx={{ opacity: 0.8, display: { xs: 'none', md: 'block' } }}>
          Purchasing · Wet processing · Drying · Warehouse · Payroll
        </Typography>
      </Box>
      <Box component="main" sx={{ display: 'grid', placeItems: 'center', px: 2, py: { xs: 4, md: 6 } }}>
        <Stack spacing={1} sx={{ width: '100%', maxWidth: 400 }}>
          <Typography variant="h4" component="h1">{title}</Typography>
          {subtitle && <Typography color="text.secondary" sx={{ pb: 2 }}>{subtitle}</Typography>}
          {children}
        </Stack>
      </Box>
    </Box>
  );
}
