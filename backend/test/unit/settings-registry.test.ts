import { SETTINGS, SETTINGS_BY_KEY, SETTING_PAIRS } from '../../src/core/settings/registry.js';

describe('settings registry (§20)', () => {
  it('has unique keys in category.name form', () => {
    expect(SETTINGS_BY_KEY.size).toBe(SETTINGS.length);
    for (const s of SETTINGS) expect(s.key.startsWith(`${s.category}.`)).toBe(true);
  });

  it('defaults satisfy their own schema; UNSET-null only for UNSET keys', () => {
    for (const s of SETTINGS) {
      if (s.defaultValue === null) {
        expect({ key: s.key, source: s.source }).toEqual({ key: s.key, source: 'UNSET' });
        continue;
      }
      const r = s.schema.safeParse(s.defaultValue);
      expect({ key: s.key, ok: r.success }).toEqual({ key: s.key, ok: true });
    }
  });

  it('carries the manual values', () => {
    const v = (k: string) => SETTINGS_BY_KEY.get(k)!;
    expect([v('moisture.targetMinPct').defaultValue, v('moisture.targetMaxPct').defaultValue]).toEqual([10.5, 11.5]);
    expect(v('moisture.warehouseMaxPct')).toMatchObject({ defaultValue: 11.5, source: 'MANUAL' });
    expect(v('drying.rakingIntervalMinutes')).toMatchObject({ defaultValue: 30, source: 'MANUAL' });
    expect([v('fermentation.minHours').defaultValue, v('fermentation.maxHours').defaultValue]).toEqual([24, 48]);
    expect(v('scale.verificationFrequencyHours')).toMatchObject({ defaultValue: 24, source: 'MANUAL' });
    expect(v('purchase.lotCreationTrigger')).toMatchObject({ defaultValue: 'ON_PAYMENT' });
  });

  it('min/max pairs are consistent by default', () => {
    for (const p of SETTING_PAIRS) {
      expect(SETTINGS_BY_KEY.get(p.min)!.defaultValue as number).toBeLessThanOrEqual(SETTINGS_BY_KEY.get(p.max)!.defaultValue as number);
    }
  });

  it('rejects invalid values', () => {
    expect(SETTINGS_BY_KEY.get('moisture.targetMaxPct')!.schema.safeParse(101).success).toBe(false);
    expect(SETTINGS_BY_KEY.get('scale.unverifiedPolicy')!.schema.safeParse('MAYBE').success).toBe(false);
    expect(SETTINGS_BY_KEY.get('station.timezone')!.schema.safeParse('Mars/Olympus').success).toBe(false);
    expect(SETTINGS_BY_KEY.get('auth.accessTokenTtl')!.schema.safeParse('10m').success).toBe(true);
  });
});
