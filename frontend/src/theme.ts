import { createTheme } from '@mui/material/styles';

/** Coffee palette; large touch targets for station tablets and phones. */
export const theme = createTheme({
  cssVariables: true,
  colorSchemes: {
    light: { palette: { primary: { main: '#5d4037' }, secondary: { main: '#2e7d32' }, background: { default: '#f7f4f2' } } },
    dark: { palette: { primary: { main: '#bcaaa4' }, secondary: { main: '#81c784' } } },
  },
  shape: { borderRadius: 10 },
  typography: { fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif', h5: { fontWeight: 600 }, h6: { fontWeight: 600 } },
  components: {
    MuiButton: { defaultProps: { disableElevation: true }, styleOverrides: { root: { textTransform: 'none', minHeight: 40 } } },
    MuiTableCell: { styleOverrides: { head: { fontWeight: 600 } } },
  },
});
