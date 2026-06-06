const { evaluateRisk } = require('../engines/riskEngine');
const {
    getSignal,
    incrementSignal,
    resetLocalSignals,
} = require('../engines/rateSignalEngine');

describe('riskEngine and rate signals', () => {
    beforeEach(() => {
        resetLocalSignals();
    });

    test('raises risk for repeated object probing', () => {
        const risk = evaluateRisk({
            policy: { riskThreshold: 60 },
            request: { userAgent: 'Mozilla/5.0' },
            rateSignals: {
                objectIdsTouched: 25,
                ownershipMismatchCount: 4,
            },
        });

        expect(risk).toMatchObject({
            ok: false,
            reason: 'HIGH_RISK_ACTION',
            riskLevel: 'high',
        });
        expect(risk.factors).toEqual(expect.arrayContaining([
            'object_id_probing',
            'repeated_ownership_mismatch',
        ]));
    });

    test('uses local fallback counters when Redis is unavailable', async () => {
        await expect(incrementSignal({
            kind: 'actor_route_velocity',
            key: 'user-1:/api/orders',
            ttlSeconds: 60,
        })).resolves.toBe(1);

        await expect(getSignal({
            kind: 'actor_route_velocity',
            key: 'user-1:/api/orders',
        })).resolves.toBe(1);
    });
});
