import { formatDateTime, formatSettingValue, humanize } from '../utils/format';

describe('formatting', () => {
  it('shows timestamps in station time (UTC+3)', () => {
    expect(formatDateTime('2026-09-25T21:30:00Z')).toMatch(/26 Sept? 2026, 00:30/);
    expect(formatDateTime(null)).toBe('—');
  });
  it('formats setting values', () => {
    expect(formatSettingValue(null)).toBe('Not set');
    expect(formatSettingValue(true)).toBe('Yes');
    expect(formatSettingValue({ start: '07:00' })).toBe('{"start":"07:00"}');
  });
  it('humanizes codes', () => {
    expect(humanize('PURCHASING_CLERK')).toBe('Purchasing clerk');
    expect(humanize('SETTING_CHANGE')).toBe('Setting change');
  });
});
