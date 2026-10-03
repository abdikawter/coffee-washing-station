import { act, render, screen } from '@testing-library/react';
import { ColorModeProvider, PALETTES, statusTone, STATUS_TONES, toneColor, useColorMode } from '../theme';

/** WCAG relative luminance / contrast ratio of two #RRGGBB colours. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

describe('theme tokens (spec §2.1, §8)', () => {
  it('uses the spec palette', () => {
    expect(PALETTES.light).toMatchObject({ primary: '#4E342E', secondary: '#B23A2E', backgroundDefault: '#F7F3EE', success: '#2E7D32', warning: '#ED8B00' });
    expect(PALETTES.dark).toMatchObject({ primary: '#D7B8A8', backgroundDefault: '#1A1512', backgroundPaper: '#241D19', textPrimary: '#F3ECE7' });
  });

  it.each(['light', 'dark'] as const)('%s text reaches WCAG AA (4.5:1) on page and paper', (mode) => {
    const p = PALETTES[mode];
    for (const bg of [p.backgroundDefault, p.backgroundPaper]) {
      expect(contrast(p.textPrimary, bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.textSecondary, bg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('high contrast reaches 7:1 for text and status colours', () => {
    const p = PALETTES.contrast;
    for (const fg of [p.textPrimary, p.textSecondary, p.primary, p.success, p.warning, p.error, p.info]) {
      expect(contrast(fg, p.backgroundPaper)).toBeGreaterThanOrEqual(7);
    }
  });
});

describe('status colours (spec §2.1)', () => {
  it('maps every status to one fixed meaning', () => {
    expect(statusTone('APPROVED', 'voucher')).toBe('success');
    expect(statusTone('PENDING_VERIFICATION', 'voucher')).toBe('warning');
    expect(statusTone('CANCELLED', 'voucher')).toBe('neutral');
    expect(statusTone('OVERDUE', 'fermentationTiming')).toBe('error');
    expect(statusTone('IN_PROGRESS', 'fermentation')).toBe('info');
    // same word, different meaning per domain
    expect(statusTone('ACTIVE', 'supplier')).toBe('success');
    expect(statusTone('ACTIVE', 'hold')).toBe('error');
    expect(statusTone('NOT_A_STATUS')).toBe('neutral');
    expect(toneColor('neutral')).toBe('default');
  });

  it('only uses the five tones', () => {
    const tones = new Set(Object.values(STATUS_TONES).flatMap((m) => Object.values(m)));
    expect([...tones].every((t) => ['success', 'warning', 'error', 'info', 'neutral'].includes(t))).toBe(true);
  });
});

function ModeProbe() {
  const { mode, setMode } = useColorMode();
  return <button onClick={() => setMode(mode === 'dark' ? 'contrast' : 'dark')}>{mode}</button>;
}

describe('colour mode (spec §2.4)', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to light and remembers the choice per user', () => {
    const { unmount } = render(<ColorModeProvider userId="u1"><ModeProbe /></ColorModeProvider>);
    expect(screen.getByRole('button')).toHaveTextContent('light');
    act(() => screen.getByRole('button').click());
    expect(screen.getByRole('button')).toHaveTextContent('dark');
    expect(localStorage.getItem('cws.colorMode.u1')).toBe('dark');
    unmount();

    localStorage.setItem('cws.colorMode', 'light'); // last device choice differs…
    render(<ColorModeProvider userId="u1"><ModeProbe /></ColorModeProvider>);
    expect(screen.getByRole('button')).toHaveTextContent('dark'); // …the user's own choice wins
  });
});
