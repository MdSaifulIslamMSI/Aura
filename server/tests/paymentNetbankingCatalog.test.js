const {
    normalizeSupportedBanksResponse,
    resolveNetbankingBank,
    lookupNetbankingBankName,
} = require('../services/payments/netbankingCatalog');

describe('Payment netbanking catalog', () => {
    test('normalizes provider boolean bank maps into sorted bank entries', () => {
        const catalog = normalizeSupportedBanksResponse({
            netbanking: {
                UTIB: true,
                HDFC: true,
                SBIN: true,
            },
        });

        expect(catalog.banks).toEqual([
            { code: 'HDFC', name: 'HDFC Bank' },
            { code: 'SBIN', name: 'State Bank of India' },
            { code: 'UTIB', name: 'Axis Bank' },
        ]);
        expect(catalog.featuredBanks[0]).toEqual({ code: 'HDFC', name: 'HDFC Bank' });
    });

    test('resolves banks from array/object hybrid payloads', () => {
        const catalog = normalizeSupportedBanksResponse({
            netbanking: {
                banks: [
                    { code: 'IDIB', name: 'Indian Bank' },
                    { bank: 'KKBK', label: 'Kotak Mahindra Bank' },
                ],
            },
        });

        expect(resolveNetbankingBank(catalog, 'kkbk')).toEqual({
            code: 'KKBK',
            name: 'Kotak Mahindra Bank',
        });
    });

    test('falls back to provider code when a friendly bank label is unknown', () => {
        expect(lookupNetbankingBankName('ABCD')).toBe('ABCD');
    });
});
