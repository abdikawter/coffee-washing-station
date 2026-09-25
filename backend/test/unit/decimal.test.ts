import { kg, lineAmount, money, roundTo, sum } from '../../src/common/decimal.js';

describe('decimal arithmetic (§2.4, §11.2)', () => {
  it('computes line amount = weight × price without float error', () => {
    expect(lineAmount('123.456', '45.10')).toBe('5567.87'); // 5567.8656
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(lineAmount('0.1', '3')).toBe('0.30');
  });

  it('rounds per mode', () => {
    expect(money('2.345', 'HALF_UP')).toBe('2.35');
    expect(money('2.345', 'HALF_EVEN')).toBe('2.34');
    expect(money('2.349', 'DOWN')).toBe('2.34');
    expect(kg('10.00049')).toBe('10.000');
    expect(roundTo('1', 3)).toBe('1.000');
  });

  it('sums exactly', () => {
    expect(sum(['0.1', '0.2', '0.3']).toFixed(2)).toBe('0.60');
    expect(sum([]).toFixed(0)).toBe('0');
  });
});
