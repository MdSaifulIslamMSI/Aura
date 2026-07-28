jest.mock('sharp', () => jest.fn());

const {
    assertSafeSessionProjection,
    assertStagingTarget,
} = require('../scripts/account_center_staging_smoke');

describe('Account Center staging smoke guards', () => {
    test('accepts only an explicit isolated HTTPS staging target', () => {
        expect(assertStagingTarget({
            SMOKE_BASE_URL: 'https://staging.example.test/',
            SMOKE_TARGET_ENV: 'staging',
            SMOKE_STAGING_ISOLATED: 'true',
            STAGING_SSM_PREFIX: '/aura/staging',
            PROD_BASE_URL: 'https://www.example.test',
        })).toBe('https://staging.example.test');

        expect(() => assertStagingTarget({
            SMOKE_BASE_URL: 'https://www.example.test',
            SMOKE_TARGET_ENV: 'staging',
            SMOKE_STAGING_ISOLATED: 'true',
            STAGING_SSM_PREFIX: '/aura/staging',
            PROD_BASE_URL: 'https://www.example.test',
        })).toThrow('production target');
    });

    test('rejects raw or expanded browser session fields', () => {
        expect(() => assertSafeSessionProjection([{
            id: 'a'.repeat(43),
            current: true,
            client: 'Chrome',
            os: 'Windows',
            createdAt: '2026-07-28T00:00:00.000Z',
            lastActiveAt: '2026-07-28T00:00:00.000Z',
            expiresAt: '2026-08-28T00:00:00.000Z',
        }])).not.toThrow();

        expect(() => assertSafeSessionProjection([{
            id: 'raw-session-id',
            ip: '127.0.0.1',
        }])).toThrow();
    });
});
