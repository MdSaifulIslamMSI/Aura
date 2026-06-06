const path = require('path');
const {
    maskValue,
    scanText,
} = require('../../scripts/security/frontend-secretless-scanner.cjs');

describe('frontend secretless scanner', () => {
    test('detects forbidden frontend env access and masks values', () => {
        const fakeOpenAiKey = ['sk', 'live', 'secret', 'secret', 'secret', 'secret'].join('-');
        const findings = scanText({
            filePath: 'app/src/config/leak.js',
            text: `const db = import.meta.env.DATABASE_URL;\nconst key = "${fakeOpenAiKey}";`,
            mode: 'source',
        });

        expect(findings.map((finding) => finding.ruleId)).toEqual(expect.arrayContaining([
            'frontend-forbidden-env-access',
            'openai-api-key',
        ]));
        expect(maskValue(fakeOpenAiKey)).not.toContain('live-secret-secret-secret');
    });

    test('allows clearly isolated test fixtures', () => {
        const fixtureOpenAiKey = ['sk', 'test', 'test', 'test', 'test', 'test'].join('-');
        const findings = scanText({
            filePath: path.join('app', 'src', '__fixtures__', 'fakeSecrets.test.js'),
            text: `const fake = "OPENAI_API_KEY=${fixtureOpenAiKey}";`,
            mode: 'source',
        });

        expect(findings).toEqual([]);
    });

    test('detects forbidden keywords in built frontend output', () => {
        const findings = scanText({
            filePath: 'app/dist/assets/index.js',
            text: 'window.__CONFIG__ = { DATABASE_URL: "mongodb://user:pass@example" };',
            mode: 'build',
        });

        expect(findings).toEqual(expect.arrayContaining([
            expect.objectContaining({ ruleId: 'frontend-build-forbidden-keyword', keyword: 'DATABASE_URL' }),
        ]));
    });
});
