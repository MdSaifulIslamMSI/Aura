const { resolveMarketContextMiddleware } = require('../middleware/marketContext');

describe('market context middleware', () => {
    test('normalizes header values onto req.market and response headers', () => {
        const req = {
            headers: {
                'x-market-country': 'in',
                'x-market-currency': 'inr',
                'x-market-language': 'hi',
            },
            query: {},
            body: {},
        };
        const res = {
            locals: {},
            setHeader: jest.fn(),
        };
        const next = jest.fn();

        resolveMarketContextMiddleware(req, res, next);

        expect(req.market).toMatchObject({
            countryCode: 'IN',
            currency: 'INR',
            language: 'hi',
        });
        expect(res.locals.market).toEqual(req.market);
        expect(res.setHeader).toHaveBeenCalledWith('x-market-country', 'IN');
        expect(res.setHeader).toHaveBeenCalledWith('x-market-currency', 'INR');
        expect(res.setHeader).toHaveBeenCalledWith('x-market-language', 'hi');
        expect(next).toHaveBeenCalled();
    });

    test('falls back to query, body, and accept-language when explicit headers are absent', () => {
        const req = {
            headers: {
                'accept-language': 'de-DE,de;q=0.9,en;q=0.8',
            },
            query: {
                market: 'de',
            },
            body: {
                paymentContext: {
                    market: {
                        currency: 'eur',
                    },
                },
            },
        };
        const res = {
            locals: {},
            setHeader: jest.fn(),
        };
        const next = jest.fn();

        resolveMarketContextMiddleware(req, res, next);

        expect(req.market).toMatchObject({
            countryCode: 'DE',
            currency: 'EUR',
            language: 'de',
        });
        expect(next).toHaveBeenCalled();
    });
});
