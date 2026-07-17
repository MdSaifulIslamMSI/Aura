const {
    getPromotionReviewReason,
    isStaleEnglishFallback,
    shouldCollectFormatJsSourceFile,
} = require('../../scripts/i18n/stable-catalog-policy.cjs');

describe('stable ICU catalog policy', () => {
    test('excludes the generated descriptor while retaining authored sources', () => {
        const generatedDescriptorPath = require.resolve('../../app/src/i18n/messages/stableUiMessages.js');

        expect(shouldCollectFormatJsSourceFile({
            filePath: generatedDescriptorPath,
            generatedDescriptorPath,
        })).toBe(false);
        expect(shouldCollectFormatJsSourceFile({
            filePath: require.resolve('../../app/src/pages/Assistant/index.jsx'),
            generatedDescriptorPath,
        })).toBe(true);
    });

    test('invalidates only an exact fallback copied from changed English source', () => {
        const sourceMessage = 'Ask now';
        const previousSourceMessage = 'Launch';

        expect(isStaleEnglishFallback({
            existingMessage: previousSourceMessage,
            previousSourceMessage,
            sourceMessage,
        })).toBe(true);
        expect(isStaleEnglishFallback({
            existingMessage: 'Jetzt starten',
            previousSourceMessage,
            sourceMessage,
        })).toBe(false);
        expect(isStaleEnglishFallback({
            existingMessage: sourceMessage,
            previousSourceMessage: sourceMessage,
            sourceMessage,
        })).toBe(false);
    });

    test('keeps promotion reasons stable across the first and later generations', () => {
        expect(getPromotionReviewReason({ isStableMessage: true }))
            .toBe('legacy-pack-promotion-needs-human-review');
        expect(getPromotionReviewReason({ isStableMessage: false }))
            .toBe('foundation-pack-promotion-needs-human-review');
    });
});
