const { getCheckoutConfig } = require('../services/checkoutConfigService');
const { resolveMarketContext } = require('../services/markets/marketCatalog');

describe('checkout config service', () => {
    test('returns India-specific checkout configuration', async () => {
        const config = await getCheckoutConfig({
            market: resolveMarketContext({
                country: 'IN',
                currency: 'INR',
                language: 'en',
            }),
            userId: null,
        });

        expect(config.market).toMatchObject({
            countryCode: 'IN',
            currency: 'INR',
            language: 'en',
        });
        expect(config.paymentMethods).toEqual(expect.arrayContaining(['UPI', 'CARD', 'COD']));
        expect(config.addressSchema).toMatchObject({
            postalCodeLabel: 'PIN Code',
            administrativeAreaLabel: 'State',
        });
        expect(config.taxRules).toMatchObject({
            mode: 'gst',
        });
    });

    test('returns US-specific checkout configuration', async () => {
        const config = await getCheckoutConfig({
            market: resolveMarketContext({
                country: 'US',
                currency: 'USD',
                language: 'es',
            }),
            userId: null,
        });

        expect(config.market).toMatchObject({
            countryCode: 'US',
            currency: 'USD',
            language: 'es',
        });
        expect(config.paymentMethods).toEqual(['CARD']);
        expect(config.addressSchema).toMatchObject({
            postalCodeLabel: 'ZIP Code',
            administrativeAreaLabel: 'State',
        });
        expect(config.taxRules).toMatchObject({
            mode: 'sales_tax',
        });
    });
});
