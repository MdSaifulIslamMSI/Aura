'use strict';

jest.mock('../config/redis', () => ({
    getRedisClient: () => null,
    flags: { redisPrefix: 'aura_test' },
}));

const {
    MIN_FEASIBLE_TRAVEL_MS,
    isImpossibleTravel,
    resolveRequestGeo,
    evaluateGeoVelocity,
} = require('../services/authGeoVelocityService');
const { evaluateLoginRisk } = require('../services/authRiskEngineService');

const reqWithCountry = (country, extraHeaders = {}) => ({
    headers: {
        'cloudfront-viewer-country': country,
        ...extraHeaders,
    },
});

describe('authGeoVelocityService', () => {
    test('resolves country from CloudFront viewer headers', () => {
        expect(resolveRequestGeo(reqWithCountry('us'))).toEqual({ country: 'US' });
        expect(resolveRequestGeo(reqWithCountry('DE'))).toEqual({ country: 'DE' });
    });

    test('falls back to cf-ipcountry and rejects garbage', () => {
        expect(resolveRequestGeo({ headers: { 'cf-ipcountry': 'jp' } })).toEqual({ country: 'JP' });
        expect(resolveRequestGeo({ headers: {} })).toBeNull();
        expect(resolveRequestGeo({ headers: { 'cloudfront-viewer-country': 'ZZZ' } })).toBeNull();
        expect(resolveRequestGeo({ headers: { 'cloudfront-viewer-country': '' } })).toBeNull();
    });

    test('same country never fires regardless of elapsed time', () => {
        expect(isImpossibleTravel({
            previous: { country: 'US' },
            current: { country: 'US' },
            elapsedMs: 1000,
        })).toBe(false);
    });

    test('country jump faster than feasible travel fires', () => {
        expect(isImpossibleTravel({
            previous: { country: 'US' },
            current: { country: 'DE' },
            elapsedMs: 60 * 1000,
        })).toBe(true);
    });

    test('country jump slower than feasible travel does not fire', () => {
        expect(isImpossibleTravel({
            previous: { country: 'US' },
            current: { country: 'DE' },
            elapsedMs: MIN_FEASIBLE_TRAVEL_MS,
        })).toBe(false);
    });

    test('missing observations never fire', () => {
        expect(isImpossibleTravel({ previous: null, current: { country: 'DE' }, elapsedMs: 1 })).toBe(false);
        expect(isImpossibleTravel({ previous: { country: 'US' }, current: null, elapsedMs: 1 })).toBe(false);
    });

    test('first observation records without firing, repeat jump fires', async () => {
        const uid = `geo-user-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

        const first = await evaluateGeoVelocity({ uid, req: reqWithCountry('US') });
        expect(first.impossibleTravel).toBe(false);
        expect(first.previous).toBeNull();

        const same = await evaluateGeoVelocity({ uid, req: reqWithCountry('US') });
        expect(same.impossibleTravel).toBe(false);

        const jumped = await evaluateGeoVelocity({ uid, req: reqWithCountry('DE') });
        expect(jumped.impossibleTravel).toBe(true);
        expect(jumped.previous).toMatchObject({ country: 'US' });
    });

    test('sessions without geo headers or uid never fire', async () => {
        expect(await evaluateGeoVelocity({ uid: '', req: reqWithCountry('US') }))
            .toMatchObject({ impossibleTravel: false });
        expect(await evaluateGeoVelocity({ uid: 'geo-nogeo', req: { headers: {} } }))
            .toMatchObject({ impossibleTravel: false });
    });

    test('server detection composes with the risk engine into step-up', async () => {
        const uid = `geo-composed-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
        await evaluateGeoVelocity({ uid, req: reqWithCountry('US') });
        const { impossibleTravel } = await evaluateGeoVelocity({ uid, req: reqWithCountry('DE') });

        const risk = evaluateLoginRisk({ impossibleTravel, distinctIpCount: 0 });
        expect(impossibleTravel).toBe(true);
        expect(risk.requireStepUp).toBe(true);
        expect(risk.reasons).toContain('impossible_travel');
    });

    test('engine accepts a real detection detail instead of the placeholder', () => {
        const risk = evaluateLoginRisk({ impossibleTravel: true, impossibleTravelDetail: 'server_geo_velocity' });
        expect(risk.signals).toEqual(expect.arrayContaining([
            expect.objectContaining({ reason: 'impossible_travel', detail: 'server_geo_velocity' }),
        ]));
    });

    test('engine keeps the placeholder detail by default', () => {
        const risk = evaluateLoginRisk({ impossibleTravel: true });
        expect(risk.signals).toEqual(expect.arrayContaining([
            expect.objectContaining({ reason: 'impossible_travel', detail: 'geo_velocity_placeholder' }),
        ]));
    });
});
