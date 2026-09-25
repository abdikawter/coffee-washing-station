import { businessDate, canonicalJson, parseDurationMs, redact, sha256Hex } from '../../src/common/util.js';
import { renderNumber, sequenceScope } from '../../src/core/sequences/sequence.service.js';

describe('canonicalJson', () => {
  it('is independent of key order and drops undefined', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { z: 1, y: undefined }] } })).toBe(canonicalJson({ a: { c: [3, { z: 1 }], d: 2 }, b: 1 }));
    expect(canonicalJson({ a: new Date('2026-01-01T00:00:00Z') })).toBe('{"a":"2026-01-01T00:00:00.000Z"}');
  });
  it('hashes deterministically', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('durations and business dates', () => {
  it('parses durations', () => {
    expect(parseDurationMs('15m')).toBe(900_000);
    expect(parseDurationMs('7d')).toBe(604_800_000);
    expect(() => parseDurationMs('15 minutes')).toThrow();
  });
  it('uses the station timezone for the business day', () => {
    // 22:30 UTC on 31 Dec = 01:30 on 1 Jan in Addis Ababa (UTC+3)
    const at = new Date('2026-12-31T22:30:00Z');
    expect(businessDate(at, 'Africa/Addis_Ababa')).toBe('2027-01-01');
    expect(businessDate(at, 'UTC')).toBe('2026-12-31');
  });
});

describe('redact', () => {
  it('removes secrets recursively', () => {
    expect(redact({ username: 'a', passwordHash: 'x', nested: [{ refreshToken: 't', ok: 1 }] })).toEqual({
      username: 'a', passwordHash: '[REDACTED]', nested: [{ refreshToken: '[REDACTED]', ok: 1 }],
    });
  });
});

describe('document numbering', () => {
  const parts = { year: '2026', month: '09', day: '25' };
  it('renders tokens', () => {
    expect(renderNumber('PV-{YYYY}-{SEQ6}', parts, 42)).toBe('PV-2026-000042');
    expect(renderNumber('LOT-{YYMMDD}-{SEQ4}', parts, 7)).toBe('LOT-260925-0007');
  });
  it('restarts per day or per year depending on the format', () => {
    expect(sequenceScope('LOT-{YYMMDD}-{SEQ4}', parts)).toBe('20260925');
    expect(sequenceScope('PV-{YYYY}-{SEQ6}', parts)).toBe('2026');
    expect(sequenceScope('X-{SEQ4}', parts)).toBe('ALL');
  });
});
