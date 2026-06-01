const {
    redactTranslationText,
    restoreTranslationText,
} = require('../services/translation/translationPrivacy');

describe('translationPrivacy', () => {
    test('redacts and restores common sensitive values', () => {
        const source = 'Email buyer@example.com or call +91 98765 43210 for order ORD-ABC12345.';
        const redacted = redactTranslationText(source);

        expect(redacted.hasSensitiveData).toBe(true);
        expect(redacted.redactedText).not.toContain('buyer@example.com');
        expect(redacted.redactedText).not.toContain('98765 43210');
        expect(redacted.redactedText).not.toContain('ORD-ABC12345');
        expect(restoreTranslationText(redacted.redactedText, redacted.replacements)).toBe(source);
    });

    test('leaves ordinary marketplace copy unchanged', () => {
        const source = 'This seller can dispatch the item tomorrow.';
        const redacted = redactTranslationText(source);

        expect(redacted).toEqual({
            hasSensitiveData: false,
            redactedText: source,
            replacements: [],
        });
    });
});
