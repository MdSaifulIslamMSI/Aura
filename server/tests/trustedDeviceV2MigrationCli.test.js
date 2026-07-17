const {
    assertApplyGate,
    buildRunOptions,
    parseArgs,
    redactErrorMessage,
    usage,
} = require('../scripts/trusted_device_v2_migration');

describe('trusted-device V2 migration CLI', () => {
    test('parses a bounded audit invocation and rejects typoed or duplicate options', () => {
        expect(parseArgs([
            '--mode=audit',
            '--run-id=audit-2026-07-17',
            '--audience=admin',
            '--requested-by=owner',
            '--batch-size=50',
        ])).toEqual({
            mode: 'audit',
            'run-id': 'audit-2026-07-17',
            audience: 'admin',
            'requested-by': 'owner',
            'batch-size': '50',
        });
        expect(() => parseArgs(['--audince=admin'])).toThrow(/unknown migration option/i);
        expect(() => parseArgs(['--run-id=one', '--run-id=two'])).toThrow(/more than once/i);
        expect(() => parseArgs(['--run-id'])).toThrow(/requires a value/i);
    });

    test('requires both an environment gate and the explicit execute flag for apply', () => {
        expect(() => assertApplyGate({ mode: 'apply' }, {
            TRUSTED_DEVICE_V2_MIGRATION_APPLY_ENABLED: 'true',
        })).toThrow(/requires --execute/i);
        expect(() => assertApplyGate({ mode: 'apply', execute: true }, {}))
            .toThrow(/MIGRATION_APPLY_ENABLED=true/i);
        expect(() => assertApplyGate({ mode: 'apply', execute: true }, {
            TRUSTED_DEVICE_V2_MIGRATION_APPLY_ENABLED: 'true',
        })).not.toThrow();
    });

    test('takes the pseudonym key only from environment and never includes it in usage', () => {
        const secret = 'pseudonym-key-that-must-never-be-printed-123456';
        const options = buildRunOptions({
            mode: 'audit',
            'run-id': 'audit-run',
            'requested-by': 'owner',
        }, {
            TRUSTED_DEVICE_V2_MIGRATION_PSEUDONYM_KEY: secret,
        });

        expect(options.pseudonymKey).toBe(secret);
        expect(usage()).not.toContain(secret);
    });

    test('redacts MongoDB credentials from bounded error output', () => {
        expect(redactErrorMessage('failed mongodb+srv://user:password@cluster.example/db'))
            .toBe('failed mongodb+srv://<redacted>@cluster.example/db');
    });
});
