const {
    auditSignoffLedger,
    computeMessageDigest,
    createSignoffRecord,
    getPromotionReviewReason,
    isNativeSignoffApproved,
    isStaleEnglishFallback,
    shouldCollectFormatJsSourceFile,
    validateSignoffRecord,
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

    test('binds native signoffs to exact source and translation SHA-256 digests and invalidates on edits', () => {
        const sourceMessage = 'Browse Storefront';
        const translatedMessage = 'Storefront durchsuchen';
        const record = createSignoffRecord({
            sourceMessage,
            translatedMessage,
            reviewer: 'Native Reviewer DE',
            reviewedAt: '2026-11-13T16:00:00.000Z',
        });

        expect(record.sourceSha256).toBe(computeMessageDigest(sourceMessage));
        expect(record.translationSha256).toBe(computeMessageDigest(translatedMessage));
        expect(isNativeSignoffApproved({
            record,
            locale: 'de',
            sourceMessage,
            translatedMessage,
        })).toBe(true);

        // Editing either English source or translation automatically invalidates the signoff
        expect(validateSignoffRecord({
            record,
            locale: 'de',
            sourceMessage: 'Explore Storefront',
            translatedMessage,
        })).toEqual({ valid: false, reason: 'source-digest-mismatch' });

        expect(validateSignoffRecord({
            record,
            locale: 'de',
            sourceMessage,
            translatedMessage: 'Shop durchsuchen',
        })).toEqual({ valid: false, reason: 'translation-digest-mismatch' });
    });

    test('rejects forged, empty, non-target-locale, or exact-English signoff attempts', () => {
        expect(() => createSignoffRecord({
            sourceMessage: 'Hello',
            translatedMessage: 'Hello',
            reviewer: 'Reviewer',
        })).toThrow(/identical to English source/i);

        expect(() => createSignoffRecord({
            sourceMessage: 'Hello',
            translatedMessage: 'Hallo',
            reviewer: 'x',
        })).toThrow(/non-empty reviewer/i);

        const validRecord = createSignoffRecord({
            sourceMessage: 'Hello',
            translatedMessage: 'Hallo',
            reviewer: 'Reviewer',
            reviewedAt: '2026-11-13T16:00:00.000Z',
        });

        expect(validateSignoffRecord({
            record: validRecord,
            locale: 'en-XA',
            sourceMessage: 'Hello',
            translatedMessage: 'Hallo',
        })).toEqual({ valid: false, reason: 'non-target-locale' });

        expect(validateSignoffRecord({
            record: { ...validRecord, reviewer: ' ' },
            locale: 'de',
            sourceMessage: 'Hello',
            translatedMessage: 'Hallo',
        })).toEqual({ valid: false, reason: 'invalid-reviewer' });
    });

    test('audits valid, stale, and invalid ledger entries cleanly', () => {
        const goodRecord = createSignoffRecord({
            sourceMessage: 'Ask now',
            translatedMessage: 'Jetzt fragen',
            reviewer: 'Reviewer DE',
            reviewedAt: '2026-11-13T16:00:00.000Z',
        });
        const staleRecord = createSignoffRecord({
            sourceMessage: 'Old source',
            translatedMessage: 'Alt',
            reviewer: 'Reviewer DE',
            reviewedAt: '2026-11-13T16:00:00.000Z',
        });

        const audit = auditSignoffLedger({
            ledger: {
                version: 1,
                approvals: {
                    de: {
                        'msg.good': goodRecord,
                        'msg.stale': staleRecord,
                        'msg.unknown': goodRecord,
                    },
                    'en-XA': {
                        'msg.good': goodRecord,
                    },
                },
            },
            sourceCatalog: {
                'msg.good': 'Ask now',
                'msg.stale': 'New source',
            },
            catalogsByLocale: {
                de: {
                    'msg.good': 'Jetzt fragen',
                    'msg.stale': 'Alt',
                },
            },
            requiredLocales: ['en', 'de', 'en-XA'],
        });

        expect(audit.validEntries).toHaveLength(1);
        expect(audit.validEntries[0].id).toBe('msg.good');
        expect(audit.staleEntries).toEqual([
            { locale: 'de', id: 'msg.stale', reason: 'source-digest-mismatch' },
        ]);
        expect(audit.invalidEntries).toEqual([
            { locale: 'de', id: 'msg.unknown', reason: 'unknown-source-id' },
            { locale: 'en-XA', id: 'msg.good', reason: 'unknown-or-non-target-locale' },
        ]);
    });
});
