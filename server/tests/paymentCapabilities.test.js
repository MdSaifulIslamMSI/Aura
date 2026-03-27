const { normalizePaymentCapabilities } = require('../services/payments/paymentCapabilities');

describe('Payment capabilities normalization', () => {
    test('normalizes live rail capability payloads across upi card wallet and netbanking', () => {
        const normalized = normalizePaymentCapabilities({
            upi: {
                apps: {
                    gpay: true,
                    phonepe: { enabled: true, name: 'PhonePe' },
                },
                intent: true,
            },
            card: {
                networks: {
                    visa: true,
                    rupay: true,
                },
                issuers: {
                    HDFC: true,
                    ICICI: true,
                },
                types: {
                    credit: true,
                    debit: true,
                },
            },
            wallets: {
                paytm: true,
                mobikwik: true,
            },
            netbanking: {
                HDFC: true,
                SBIN: true,
            },
        });

        expect(normalized.rails.upi).toMatchObject({
            available: true,
            appCount: 2,
            flows: ['intent'],
        });
        expect(normalized.rails.card).toMatchObject({
            available: true,
            networkCount: 2,
            issuerCount: 2,
        });
        expect(normalized.rails.wallet).toMatchObject({
            available: true,
            walletCount: 2,
        });
        expect(normalized.rails.netbanking).toMatchObject({
            available: true,
            bankCount: 2,
        });
        expect(normalized.markets).toMatchObject({
            settlementCurrency: 'INR',
            railMatrix: {
                UPI: expect.objectContaining({ crossBorder: false }),
                CARD: expect.objectContaining({ crossBorder: true }),
            },
        });
    });
});
