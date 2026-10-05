import { createTheme, type CSSObject, type Theme, type TypographyStyle } from '@mui/material/styles';
import type {} from '@mui/x-charts/themeAugmentation';
import type {} from '@mui/x-data-grid/themeAugmentation';
import type {} from '@mui/x-date-pickers/themeAugmentation';
import { FONT_FAMILY, PALETTES, SHAPE, TYPE_SCALE, type ColorMode } from './tokens';

declare module '@mui/material/styles' {
  interface TypographyVariants {
    kpi: React.CSSProperties;
  }
  interface TypographyVariantsOptions {
    kpi?: React.CSSProperties;
  }
}
declare module '@mui/material/Typography' {
  interface TypographyPropsVariantOverrides {
    kpi: true;
  }
}

const px = (n: number) => `${n / 16}rem`;

function palette(mode: ColorMode) {
  const p = PALETTES[mode];
  return {
    mode: mode === 'dark' ? ('dark' as const) : ('light' as const),
    primary: { main: p.primary },
    secondary: { main: p.secondary },
    success: { main: p.success },
    warning: { main: p.warning },
    error: { main: p.error },
    info: { main: p.info },
    background: { default: p.backgroundDefault, paper: p.backgroundPaper },
    text: { primary: p.textPrimary, secondary: p.textSecondary },
    divider: p.divider,
    // Text on coloured surfaces must reach WCAG AA (4.5:1) — spec §8.
    contrastThreshold: 4.5,
  };
}

const type = (key: keyof typeof TYPE_SCALE, extra: TypographyStyle = {}): TypographyStyle => ({
  fontSize: px(TYPE_SCALE[key][0]),
  fontWeight: TYPE_SCALE[key][1],
  ...extra,
});

/**
 * Builds the app theme. 'standard' = light + dark colour schemes (CSS variables);
 * 'contrast' = the outdoor high-contrast theme (spec §2.4): stronger text, thicker
 * borders. Pages must only use these tokens — no colours, font sizes or shadows of their own (spec §9).
 */
export function buildTheme(variant: 'standard' | 'contrast'): Theme {
  const hc = variant === 'contrast';
  /** Thicker, darker outlines in high contrast. */
  const contrastBorder = (theme: Theme): CSSObject => (hc ? { borderWidth: 2, borderColor: theme.vars?.palette.text.primary } : {});
  return createTheme({
  cssVariables: { colorSchemeSelector: 'data' },
  colorSchemes: hc
    ? { light: { palette: palette('contrast') } }
    : { light: { palette: palette('light') }, dark: { palette: palette('dark') } },
  spacing: SHAPE.spacing,
  shape: { borderRadius: SHAPE.radiusControl },
  typography: {
    fontFamily: FONT_FAMILY,
    h1: type('h4'), h2: type('h4'), h3: type('h4'), // pages use h4–h6; keep larger heads in scale
    h4: type('h4', { lineHeight: 1.25 }),
    h5: type('h5', { lineHeight: 1.3 }),
    h6: type('h6', { lineHeight: 1.35 }),
    subtitle1: type('subtitle1'),
    subtitle2: type('subtitle2'),
    body1: type('body1', { lineHeight: 1.55 }),
    body2: type('body2', { lineHeight: 1.5 }),
    caption: type('caption', { lineHeight: 1.4 }),
    overline: type('overline', { letterSpacing: '0.06em', lineHeight: 1.6 }),
    button: type('button', { textTransform: 'none' }),
    kpi: type('kpi', { lineHeight: 1.15, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.01em' }),
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: (theme) => ({
        body: { WebkitFontSmoothing: 'antialiased' },
        // Visible keyboard focus everywhere (spec §8).
        ':focus-visible': { outline: `2px solid ${theme.vars?.palette.primary.main}`, outlineOffset: 2 },
      }),
    },
    MuiAppBar: { defaultProps: { elevation: 0 } },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: { outlined: ({ theme }) => ({ borderColor: theme.vars?.palette.divider, ...contrastBorder(theme) }) },
    },
    MuiCard: {
      defaultProps: { variant: 'outlined' },
      styleOverrides: { root: { borderRadius: SHAPE.radiusCard } },
    },
    MuiDialog: { styleOverrides: { paper: { borderRadius: SHAPE.radiusCard } } },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { textTransform: 'none', minHeight: SHAPE.buttonMinHeight, borderRadius: SHAPE.radiusControl, fontWeight: 600 },
        sizeSmall: { minHeight: 32 },
        sizeLarge: { minHeight: SHAPE.fieldMinHeight },
      },
    },
    MuiIconButton: { styleOverrides: { root: { borderRadius: SHAPE.radiusControl } } },
    MuiToggleButton: { styleOverrides: { root: { textTransform: 'none', borderRadius: SHAPE.radiusControl } } },
    MuiTab: { styleOverrides: { root: { textTransform: 'none', fontWeight: 600, minHeight: 48 } } },
    MuiChip: {
      styleOverrides: {
        root: { borderRadius: SHAPE.radiusChip, fontWeight: 600 },
        outlined: ({ theme }) => contrastBorder(theme),
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: { borderRadius: SHAPE.radiusControl },
        notchedOutline: ({ theme }) => contrastBorder(theme),
      },
    },
    MuiAlert: { styleOverrides: { root: { borderRadius: SHAPE.radiusControl } } },
    MuiTableCell: {
      styleOverrides: {
        root: { fontVariantNumeric: 'tabular-nums' },
        head: ({ theme }) => ({ fontWeight: 600, color: theme.vars?.palette.text.secondary }),
      },
    },
    MuiTooltip: { styleOverrides: { tooltip: { fontSize: px(TYPE_SCALE.caption[0]) } } },
    // MUI X (spec §3): grids and pickers use the same tokens as the rest of the app.
    MuiDataGrid: {
      defaultProps: { density: 'standard', disableRowSelectionOnClick: true },
      styleOverrides: {
        root: ({ theme }) => ({
          borderRadius: SHAPE.radiusCard,
          borderColor: theme.vars?.palette.divider,
          backgroundColor: theme.vars?.palette.background.paper,
          '--DataGrid-containerBackground': theme.vars?.palette.background.paper,
          fontVariantNumeric: 'tabular-nums',
          ...contrastBorder(theme),
        }),
        columnHeaderTitle: ({ theme }) => ({ fontWeight: 600, color: theme.vars?.palette.text.secondary }),
        cell: { display: 'flex', alignItems: 'center' },
      },
    },
    MuiDatePicker: { defaultProps: { format: 'DD MMM YYYY' } },
    MuiDateTimePicker: { defaultProps: { format: 'DD MMM YYYY HH:mm', ampm: false } },
  },
  });
}

export const theme = buildTheme('standard');
export const contrastTheme = buildTheme('contrast');
