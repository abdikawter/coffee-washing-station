// Bundled fonts (spec §2.2): Inter for Latin, Noto Sans Ethiopic for Amharic — no network call.
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/noto-sans-ethiopic/400.css';
import '@fontsource/noto-sans-ethiopic/600.css';

export { buildTheme, contrastTheme, theme } from './theme';
export { ColorModeProvider, useColorMode } from './ColorModeProvider';
export { statusTone, toneColor, STATUS_TONES, type StatusDomain, type StatusTone } from './status';
export { COLOR_MODES, PALETTES, SHAPE, type ColorMode } from './tokens';
