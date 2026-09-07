const { toStoredMinorUnits } = require('../services/payments/moneyStorage');

describe('moneyStorage.toStoredMinorUnits', () => {
  test('converts major units to minor units per currency', () => {
    expect(toStoredMinorUnits(500, 'INR')).toBe(50000);
    expect(toStoredMinorUnits(19.99, 'USD')).toBe(1999);
  });

  test('clamps negatives to zero (money never negative)', () => {
    expect(toStoredMinorUnits(-50, 'INR')).toBe(0);
  });

  test('handles missing and non-numeric input safely', () => {
    expect(toStoredMinorUnits(undefined, 'INR')).toBe(0);
    expect(toStoredMinorUnits(null, 'INR', { nullOnMissing: true })).toBeNull();
    expect(toStoredMinorUnits('not-money', 'INR')).toBe(0);
  });

  test('rejects unsafe integers beyond float precision', () => {
    expect(toStoredMinorUnits(Number.MAX_SAFE_INTEGER, 'INR')).toBe(0);
  });
});
