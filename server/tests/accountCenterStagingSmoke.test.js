const fs = require('fs');
const path = require('path');

jest.mock('sharp', () => jest.fn());

const {
    assertAvatarScanDisabledFailClosed,
    assertSafeSessionProjection,
    assertStagingTarget,
    classifyFailurePayload,
    isRetryableFirebaseNetworkError,
    shouldRetryIdempotentTransientFailure,
    shouldRetryRateLimitDependency,
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

    test('accepts only the exact fail-closed avatar scanner response without promotion authority', () => {
        expect(() => assertAvatarScanDisabledFailClosed({
            status: 503,
            payload: {
                success: false,
                message: 'Avatar malware scan unavailable. Please try again later.',
            },
        })).not.toThrow();
        expect(() => assertAvatarScanDisabledFailClosed({
            status: 503,
            payload: {
                message: 'Avatar malware scan unavailable. Please try again later.',
                finalizeToken: 'must-not-exist',
            },
        })).toThrow('finalize token');
        expect(() => assertAvatarScanDisabledFailClosed({
            status: 503,
            payload: { message: 'Different dependency failure' },
        })).toThrow('unexpected failure');
        expect(() => assertAvatarScanDisabledFailClosed({
            status: 201,
            payload: {},
        })).toThrow('must fail closed with 503');
    });

    test('uses authenticated telemetry through the internal-route cloak', () => {
        const source = fs.readFileSync(
            path.join(__dirname, '..', 'scripts', 'account_center_staging_smoke.js'),
            'utf8'
        );

        expect(source).toMatch(
            /requestJson\('\/api\/observability\/client-diagnostics',[\s\S]*?token: primaryToken/
        );
    });

    test('serializes customer sync admission before broader qualification', () => {
        const source = fs.readFileSync(
            path.join(__dirname, '..', 'scripts', 'account_center_staging_smoke.js'),
            'utf8'
        );

        expect(source).toMatch(
            /await syncAccount\(\{ token: primaryToken,[\s\S]*?await syncAccount\(\{ token: secondaryToken,/
        );
        expect(source).not.toMatch(/Promise\.all\(\[\s*syncAccount/);
    });

    test('retries only a first security-limiter dependency failure', () => {
        const dependencyFailure = {
            message: 'Rate limiter dependency unavailable. Please try again shortly.',
        };

        expect(classifyFailurePayload(dependencyFailure)).toEqual({
            code: 'NONE',
            reason: 'rate_limit_dependency_unavailable',
            retryAfter: 0,
        });
        expect(shouldRetryRateLimitDependency({
            attempt: 0,
            payload: dependencyFailure,
            retryRateLimitDependency: true,
            status: 503,
        })).toBe(true);
        expect(shouldRetryRateLimitDependency({
            attempt: 1,
            payload: dependencyFailure,
            retryRateLimitDependency: true,
            status: 503,
        })).toBe(false);
        expect(shouldRetryRateLimitDependency({
            attempt: 0,
            payload: {
                code: 'ATTACK_MODE_ROUTE_DISABLED',
                message: 'This feature is temporarily unavailable while traffic protection is active.',
            },
            retryRateLimitDependency: true,
            status: 503,
        })).toBe(false);
    });

    test('retries one explicit transient overload only for an idempotent smoke request', () => {
        const routeTimeout = {
            code: 'TRAFFIC_ROUTE_TIMEOUT',
            message: 'This route is temporarily overloaded. Please try again shortly.',
        };

        expect(classifyFailurePayload(routeTimeout)).toEqual({
            code: 'TRAFFIC_ROUTE_TIMEOUT',
            reason: 'traffic_route_timeout',
            retryAfter: 0,
        });
        expect(shouldRetryIdempotentTransientFailure({
            attempt: 0,
            payload: routeTimeout,
            retryIdempotentTransientFailure: true,
            status: 503,
        })).toBe(true);
        expect(shouldRetryIdempotentTransientFailure({
            attempt: 1,
            payload: routeTimeout,
            retryIdempotentTransientFailure: true,
            status: 503,
        })).toBe(false);
        expect(shouldRetryIdempotentTransientFailure({
            attempt: 0,
            payload: {
                code: 'TRAFFIC_LOAD_SHEDDING',
                message: 'Traffic protection is active.',
            },
            retryIdempotentTransientFailure: true,
            status: 503,
        })).toBe(true);
        expect(shouldRetryIdempotentTransientFailure({
            attempt: 0,
            payload: { code: 'OTHER_DEPENDENCY_FAILURE' },
            retryIdempotentTransientFailure: true,
            status: 503,
        })).toBe(false);
    });

    test('retries only Firebase transport failures, not credential or status errors', () => {
        expect(isRetryableFirebaseNetworkError(new TypeError('fetch failed'))).toBe(true);
        expect(isRetryableFirebaseNetworkError(new Error('fetch failed'))).toBe(false);
        expect(isRetryableFirebaseNetworkError(new Error('INVALID_PASSWORD'))).toBe(false);
        expect(isRetryableFirebaseNetworkError(new TypeError('invalid URL'))).toBe(false);
    });
});
