import { beforeEach, describe, expect, it } from 'vitest';
import { convertAmount, setMarketFormatDefaults } from './format';

describe('format currency conversion', () => {
    beforeEach(() => {
        setMarketFormatDefaults({
            currency: 'INR',
            locale: 'en-IN',
            baseCurrency: 'INR',
            rates: {
                INR: 1,
                USD: 0.012,
                JPY: 1.82,
            },
        });
    });

    it('uses stable reciprocal conversion factors', () => {
        expect(convertAmount(1000, 'INR', 'USD')).toBe(12);
        expect(convertAmount(12, 'USD', 'INR')).toBe(1000);
    });

    it('rounds using the target currency precision', () => {
        expect(convertAmount(1000, 'INR', 'JPY')).toBe(1820);
        expect(convertAmount(10.005, 'USD', 'USD')).toBe(10.01);
    });
});
