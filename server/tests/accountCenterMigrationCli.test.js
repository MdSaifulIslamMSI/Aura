const {
    parseArgs,
    usage,
} = require('../scripts/migrate_account_center_v2');

describe('account center migration CLI', () => {
    test('parses explicit audit controls without inferring apply mode', () => {
        expect(parseArgs([
            '--mode=audit',
            '--run-id=account-center-audit-001',
            '--batch-size=250',
        ])).toEqual({
            mode: 'audit',
            'run-id': 'account-center-audit-001',
            'batch-size': '250',
        });
    });

    test('rejects unknown, valueless, and duplicate options', () => {
        expect(() => parseArgs(['--unsafe=true'])).toThrow('Unknown migration option');
        expect(() => parseArgs(['--run-id'])).toThrow('requires a value');
        expect(() => parseArgs(['--mode=audit', '--mode=apply'])).toThrow('more than once');
    });

    test('documents the staging-first apply contract', () => {
        expect(usage()).toContain('staging first');
        expect(usage()).toContain('--backup-evidence');
        expect(usage()).toContain('--rollback-sha');
    });
});
