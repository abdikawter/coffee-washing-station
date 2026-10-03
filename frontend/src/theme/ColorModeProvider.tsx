import { CssBaseline, ThemeProvider } from '@mui/material';
import { useColorScheme } from '@mui/material/styles';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { contrastTheme, theme } from './theme';
import { COLOR_MODES, type ColorMode } from './tokens';

/**
 * Light / dark / high-contrast switch (spec §2.4), remembered per user in
 * localStorage (`cws.colorMode.<userId>`; `cws.colorMode` keeps the last choice
 * on this device and is used before sign-in). Light is the default.
 */
const GLOBAL_KEY = 'cws.colorMode';
const userKey = (userId: string) => `${GLOBAL_KEY}.${userId}`;

function read(key: string): ColorMode | null {
  try {
    const v = localStorage.getItem(key);
    return v && (COLOR_MODES as readonly string[]).includes(v) ? (v as ColorMode) : null;
  } catch {
    return null;
  }
}
function write(key: string, mode: ColorMode): void {
  try { localStorage.setItem(key, mode); } catch { /* private window: keep the choice in memory only */ }
}

interface ColorModeState {
  mode: ColorMode;
  setMode: (mode: ColorMode) => void;
}

const ColorModeContext = createContext<ColorModeState>({ mode: 'light', setMode: () => undefined });

export function useColorMode(): ColorModeState {
  return useContext(ColorModeContext);
}

/** Keeps MUI's light/dark colour scheme in step with the chosen mode. */
function SchemeSync({ mode }: { mode: ColorMode }) {
  const { setMode } = useColorScheme();
  useEffect(() => { setMode(mode === 'dark' ? 'dark' : 'light'); }, [mode, setMode]);
  return null;
}

/**
 * Provides the MUI theme for the chosen mode: the standard theme (light + dark
 * colour schemes) or the high-contrast theme. `userId` switches to that user's saved choice.
 */
export function ColorModeProvider({ userId, children }: { userId?: string | null; children: ReactNode }) {
  const [mode, setModeState] = useState<ColorMode>(() => read(GLOBAL_KEY) ?? 'light');

  useEffect(() => {
    if (!userId) return;
    const saved = read(userKey(userId));
    if (saved) setModeState(saved);
  }, [userId]);

  const setMode = useCallback((m: ColorMode) => {
    setModeState(m);
    write(GLOBAL_KEY, m);
    if (userId) write(userKey(userId), m);
  }, [userId]);

  const value = useMemo(() => ({ mode, setMode }), [mode, setMode]);
  return (
    <ColorModeContext.Provider value={value}>
      <ThemeProvider theme={mode === 'contrast' ? contrastTheme : theme} defaultMode="light">
        <SchemeSync mode={mode} />
        <CssBaseline />
        {children}
      </ThemeProvider>
    </ColorModeContext.Provider>
  );
}
