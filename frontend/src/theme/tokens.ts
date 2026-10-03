/**
 * Design tokens — docs/UI_REFRESH_SPEC.md §2. The ONLY place colours, font sizes
 * and radii are written down; pages read them through the MUI theme.
 */

/** §2.1 palette per mode. `contrast` is the outdoor high-contrast mode (§2.4): darker text, stronger borders, no subtle greys. */
export const PALETTES = {
  light: {
    primary: '#4E342E', // roasted coffee
    secondary: '#B23A2E', // coffee cherry
    backgroundDefault: '#F7F3EE', // parchment
    backgroundPaper: '#FFFFFF',
    success: '#2E7D32', // leaf
    warning: '#ED8B00', // amber
    error: '#C62828',
    info: '#1565C0',
    textPrimary: '#2B211D',
    textSecondary: '#6D5F57',
    divider: '#E8DFD7',
  },
  dark: {
    primary: '#D7B8A8',
    secondary: '#E57368',
    backgroundDefault: '#1A1512',
    backgroundPaper: '#241D19',
    success: '#66BB6A',
    warning: '#FFB74D',
    error: '#EF5350',
    info: '#64B5F6',
    textPrimary: '#F3ECE7',
    textSecondary: '#BCAEA5',
    divider: '#3A302A',
  },
  contrast: {
    primary: '#2E1C17',
    secondary: '#8E2219',
    backgroundDefault: '#FFFFFF',
    backgroundPaper: '#FFFFFF',
    success: '#1B5E20',
    warning: '#7A4100',
    error: '#9B1C1C',
    info: '#0D3C82',
    textPrimary: '#000000',
    textSecondary: '#2B211D',
    divider: '#4E342E',
  },
} as const;

export type ColorMode = keyof typeof PALETTES;
export const COLOR_MODES: readonly ColorMode[] = ['light', 'dark', 'contrast'];

/** §2.2 — fonts are bundled with @fontsource (no Google Fonts call; works offline). */
export const FONT_FAMILY = '"Inter", "Noto Sans Ethiopic", system-ui, sans-serif';

/** §2.2 type scale in px: [size, weight]. */
export const TYPE_SCALE = {
  h4: [28, 600],
  h5: [22, 600],
  h6: [18, 600],
  subtitle1: [16, 600],
  subtitle2: [14, 600],
  body1: [15, 400],
  body2: [14, 400],
  caption: [12, 400],
  overline: [12, 600],
  button: [14, 600],
  kpi: [32, 700],
} as const;

/** §2.3 */
export const SHAPE = {
  spacing: 8,
  radiusCard: 12,
  radiusControl: 8,
  radiusChip: 999,
  pagePaddingDesktop: 3, // × spacing = 24 px
  pagePaddingMobile: 2, // 16 px
  buttonMinHeight: 40,
  fieldMinHeight: 48,
} as const;
