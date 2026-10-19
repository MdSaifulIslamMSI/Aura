const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const {
    isExactPin,
    compareVersions,
    collectExactPins,
} = require(path.join(repoRoot, 'scripts', 'security', 'override-pin-logic.cjs'));

describe('override pin gate', () => {
    test('detects exact pins and ignores ranges, aliases and local paths', () => {
        expect(isExactPin('0.6.0')).toBe(true);
        expect(isExactPin('8.11.2')).toBe(true);
        expect(isExactPin('1.2.3-beta.1')).toBe(true);

        // A range still admits a patched release, so it is not a pin that can
        // revert a security fix.
        expect(isExactPin('^0.6.1')).toBe(false);
        expect(isExactPin('~1.2.3')).toBe(false);
        expect(isExactPin('>=1.0.0 <2.0.0')).toBe(false);
        expect(isExactPin('*')).toBe(false);
        expect(isExactPin('file:vendor/node-domexception')).toBe(false);
        expect(isExactPin('npm:other@1.0.0')).toBe(false);
        expect(isExactPin('')).toBe(false);
        expect(isExactPin(undefined)).toBe(false);
    });

    test('orders versions correctly', () => {
        expect(compareVersions('0.6.0', '0.6.1')).toBe(-1);
        expect(compareVersions('0.6.1', '0.6.0')).toBe(1);
        expect(compareVersions('0.6.0', '0.6.0')).toBe(0);
        expect(compareVersions('1.9.0', '1.10.0')).toBe(-1);
        expect(compareVersions('2.0.0', '10.0.0')).toBe(-1);
        expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    });

    test('collects the exact pins from every workspace manifest', () => {
        const pins = collectExactPins(repoRoot);

        expect(pins.length).toBeGreaterThan(0);
        for (const pin of pins) {
            expect(pin.name).toBeTruthy();
            expect(pin.version).toMatch(/^\d+\.\d+\.\d+/);
            expect(pin.manifest).toMatch(/package\.json$/);
        }
        // The adm-zip pin was the live instance of this failure mode: an
        // exact pin on an advisory-bearing version while a fixed release
        // existed. It is now a range, so it must not be collected.
        expect(pins.find((pin) => pin.name === 'adm-zip')).toBeUndefined();
    });

    test('the gate is wired into the blocking security gate job', () => {
        const workflow = fs.readFileSync(
            path.join(repoRoot, '.github', 'workflows', 'security-gates.yml'),
            'utf8'
        );
        expect(workflow).toContain('npm run security:override-pins');
    });

    test('the gate has an npm script entry', () => {
        const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
        expect(pkg.scripts['security:override-pins']).toContain('check-override-pins.mjs');
    });
});
