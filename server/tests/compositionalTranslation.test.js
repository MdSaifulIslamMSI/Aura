const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
    createCompositionalTranslator,
    isCleanTranslationCandidate,
} = require('../services/translation/compositionalTranslator');
const {
    clearTranslationCache,
    translateTexts,
} = require('../services/i18n/translationService');

describe('compositionalTranslator', () => {
    const originalEnv = { ...process.env };
    let tempCatalogDir = '';

    beforeEach(() => {
        tempCatalogDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-tm-'));
        fs.writeFileSync(path.join(tempCatalogDir, 'en.json'), JSON.stringify({
            'cart.add': 'Add to cart',
            'status.stock': 'In stock',
            'delivery.free': 'Free delivery',
        }));
        fs.writeFileSync(path.join(tempCatalogDir, 'hi.json'), JSON.stringify({
            'cart.add': 'कार्ट में जोड़ें',
            'status.stock': 'स्टॉक में उपलब्ध',
            'delivery.free': 'मुफ्त डिलीवरी',
        }));
        fs.writeFileSync(path.join(tempCatalogDir, 'de.json'), JSON.stringify({
            'cart.add': 'In den Warenkorb',
            'status.stock': 'Beeintr?chtigt',
            'delivery.free': 'Kostenlose Lieferung',
        }));
    });

    afterEach(() => {
        process.env = { ...originalEnv };
        clearTranslationCache();
        fs.rmSync(tempCatalogDir, { recursive: true, force: true });
    });

    test('filters out question-mark corrupted candidates and unresolved ICU plurals', () => {
        expect(isCleanTranslationCandidate('Degraded', 'Beeintr?chtigt')).toBe(false);
        expect(isCleanTranslationCandidate('Loading', '??????????')).toBe(false);
        expect(isCleanTranslationCandidate('In stock', 'In stock')).toBe(false);
        expect(isCleanTranslationCandidate('{count} items', '{count, plural, one {1} other {#}}')).toBe(false);
        expect(isCleanTranslationCandidate('Add to cart', 'कार्ट में जोड़ें')).toBe(true);
    });

    test('translates compound clauses offline while preserving currency, percentages, and PII slots', () => {
        const translator = createCompositionalTranslator({ reviewedCatalogDir: tempCatalogDir });
        const translated = translator.translateText({
            targetLanguage: 'hi',
            text: 'Free delivery · In stock · ₹1,499 <EMAIL_1>',
        });

        expect(translated).toContain('मुफ्त डिलीवरी');
        expect(translated).toContain('स्टॉक में उपलब्ध');
        expect(translated).toContain('₹1,499');
        expect(translated).toContain('<EMAIL_1>');
    });

    test('integrates cleanly with runtime TranslationService when provider is compositional', async () => {
        process.env = {
            ...originalEnv,
            NODE_ENV: 'test',
            I18N_RUNTIME_TRANSLATION_ENABLED: 'true',
            I18N_TRANSLATION_PROVIDER: 'compositional',
        };
        clearTranslationCache();

        const result = await translateTexts({
            texts: ['Free delivery · Verified seller — Email buyer@example.com'],
            targetLanguage: 'hi',
        });

        const output = result['Free delivery · Verified seller — Email buyer@example.com'];
        expect(output).toContain('मुफ्त डिलीवरी');
        expect(output).toContain('सत्यापित विक्रेता');
        expect(output).toContain('buyer@example.com');
    });
});
