const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_REVIEWED_CATALOG_DIR = path.resolve(__dirname, '../../../app/src/i18n/messages/reviewed');
const MOJIBAKE_OR_CORRUPTION_PATTERN = /\uFFFD|Ã|Â|â€™|â€œ|â€|ï¿½|\p{L}\?+\p{L}|\?{2,}/u;
const PROTECTED_TOKEN_PATTERN = /<[A-Z_]+_\d+>|https?:\/\/\S+|\{\{[A-Za-z0-9_]+\}\}|\{[A-Za-z0-9_]+\}|(?:₹|Rs\.?|\$|€|£)\s?\d[\d,]*(?:\.\d+)?|\b\d+(?:\.\d+)?%?\b/g;
const DELIMITER_SPLIT_PATTERN = /(\s*[|·—;]\s*|:\s+|\s+-\s+|\s*,\s*|[.!?]+(?:\s+|$))/;

// Compact offline commerce lexicon guarantees deterministic translation even in slim server images without app/ catalogs.
const CORE_COMMERCE_LEXICON = {
    hi: {
        'add to cart': 'कार्ट में जोड़ें',
        'buy now': 'अभी खरीदें',
        'in stock': 'स्टॉक में उपलब्ध',
        'out of stock': 'स्टॉक समाप्त',
        'free delivery': 'मुफ्त डिलीवरी',
        'fast shipping': 'तेज शिपिंग',
        'verified seller': 'सत्यापित विक्रेता',
        'price dropped': 'कीमत कम हुई',
        'best seller': 'बेस्ट सेलर',
        'top rated': 'शीर्ष रेटेड',
        'order confirmed': 'ऑर्डर की पुष्टि हुई',
        'order delivered': 'ऑर्डर डिलीवर हो गया',
        'orders': 'ऑर्डर',
        'checkout': 'चेकआउट',
        'wireless': 'वायरलेस',
        'headphones': 'हेडफ़ोन',
        'laptop': 'लैपटॉप',
        'smartphone': 'स्मार्टफ़ोन',
        'warranty included': 'वारंटी शामिल',
    },
    bn: {
        'add to cart': 'কার্টে যোগ করুন',
        'buy now': 'এখনই কিনুন',
        'in stock': 'স্টকে আছে',
        'out of stock': 'স্টক শেষ',
        'free delivery': 'ফ্রি ডেলিভারি',
        'fast shipping': 'দ্রুত ডেলিভারি',
        'verified seller': 'যাচাইকৃত বিক্রেতা',
        'price dropped': 'দাম কমেছে',
        'best seller': 'বেস্ট সেলার',
        'top rated': 'সর্বোচ্চ রেটেড',
        'order confirmed': 'অর্ডার নিশ্চিত হয়েছে',
        'order delivered': 'অর্ডার ডেলিভারি হয়েছে',
        'orders': 'অর্ডারসমূহ',
        'checkout': 'চেকআউট',
        'wireless': 'ওয়্যারলেস',
        'headphones': 'হেডফোন',
        'laptop': 'ল্যাপটপ',
        'smartphone': 'স্মার্টফোন',
        'warranty included': 'ওয়ারেন্টি অন্তর্ভুক্ত',
    },
    es: {
        'add to cart': 'Agregar al carrito',
        'buy now': 'Comprar ahora',
        'in stock': 'En stock',
        'out of stock': 'Agotado',
        'free delivery': 'Envío gratis',
        'fast shipping': 'Envío rápido',
        'verified seller': 'Vendedor verificado',
        'price dropped': 'El precio bajó',
        'best seller': 'Más vendido',
        'top rated': 'Mejor valorado',
        'order confirmed': 'Pedido confirmado',
        'order delivered': 'Pedido entregado',
        'orders': 'Pedidos',
        'checkout': 'Finalizar compra',
        'warranty included': 'Garantía incluida',
    },
    fr: {
        'add to cart': 'Ajouter au panier',
        'buy now': 'Acheter maintenant',
        'in stock': 'En stock',
        'out of stock': 'Rupture de stock',
        'free delivery': 'Livraison gratuite',
        'fast shipping': 'Expédition rapide',
        'verified seller': 'Vendeur vérifié',
        'price dropped': 'Baisse de prix',
        'best seller': 'Meilleure vente',
        'top rated': 'Mieux noté',
        'order confirmed': 'Commande confirmée',
        'order delivered': 'Commande livrée',
        'orders': 'Commandes',
        'checkout': 'Paiement',
        'warranty included': 'Garantie incluse',
    },
    de: {
        'add to cart': 'In den Warenkorb',
        'buy now': 'Jetzt kaufen',
        'in stock': 'Auf Lager',
        'out of stock': 'Nicht vorrätig',
        'free delivery': 'Kostenlose Lieferung',
        'fast shipping': 'Schneller Versand',
        'verified seller': 'Verifizierter Verkäufer',
        'price dropped': 'Preis gesunken',
        'best seller': 'Bestseller',
        'top rated': 'Bestbewertet',
        'order confirmed': 'Bestellung bestätigt',
        'order delivered': 'Bestellung geliefert',
        'orders': 'Bestellungen',
        'checkout': 'Zur Kasse',
        'warranty included': 'Garantie inklusive',
    },
    pt: {
        'add to cart': 'Adicionar ao carrinho',
        'buy now': 'Comprar agora',
        'in stock': 'Em estoque',
        'out of stock': 'Esgotado',
        'free delivery': 'Entrega grátis',
        'fast shipping': 'Envio rápido',
        'verified seller': 'Vendedor verificado',
        'price dropped': 'Preço reduzido',
        'best seller': 'Mais vendido',
        'top rated': 'Melhor avaliado',
        'order confirmed': 'Pedido confirmado',
        'order delivered': 'Pedido entregue',
        'orders': 'Pedidos',
        'checkout': 'Finalizar compra',
        'warranty included': 'Garantia incluída',
    },
    ar: {
        'add to cart': 'أضف إلى السلة',
        'buy now': 'اشتري الآن',
        'in stock': 'متوفر',
        'out of stock': 'نفد من المخزون',
        'free delivery': 'توصيل مجاني',
        'fast shipping': 'شحن سريع',
        'verified seller': 'بائع موثق',
        'price dropped': 'انخفض السعر',
        'best seller': 'الأكثر مبيعًا',
        'top rated': 'الأعلى تقييمًا',
        'order confirmed': 'تم تأكيد الطلب',
        'order delivered': 'تم تسليم الطلب',
        'orders': 'الطلبات',
        'checkout': 'إتمام الشراء',
        'warranty included': 'يشمل الضمان',
    },
    ja: {
        'add to cart': 'カートに追加',
        'buy now': '今すぐ購入',
        'in stock': '在庫あり',
        'out of stock': '在庫切れ',
        'free delivery': '送料無料',
        'fast shipping': '迅速配送',
        'verified seller': '認証済み出品者',
        'price dropped': '値下げされました',
        'best seller': 'ベストセラー',
        'top rated': '高評価',
        'order confirmed': '注文確定',
        'order delivered': '配達完了',
        'orders': '注文履歴',
        'checkout': 'レジに進む',
        'warranty included': '保証付き',
    },
    zh: {
        'add to cart': '加入购物车',
        'buy now': '立即购买',
        'in stock': '有货',
        'out of stock': '缺货',
        'free delivery': '免费配送',
        'fast shipping': '极速发货',
        'verified seller': '认证卖家',
        'price dropped': '已降价',
        'best seller': '热销商品',
        'top rated': '高分评价',
        'order confirmed': '订单已确认',
        'order delivered': '订单已送达',
        'orders': '我的订单',
        'checkout': '去结算',
        'warranty included': '含质保',
    },
};

const normalizeLookupKey = (value = '') => String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const isCleanTranslationCandidate = (source = '', candidate = '') => {
    if (!candidate || typeof candidate !== 'string') return false;
    const trimmed = candidate.trim();
    if (!trimmed || trimmed === String(source || '').trim()) return false;
    if (MOJIBAKE_OR_CORRUPTION_PATTERN.test(trimmed)) return false;
    if (/\{[^}]*,\s*(?:plural|select|selectordinal)\s*,/.test(trimmed)) return false;
    return true;
};

const buildProtectedSegments = (text = '') => {
    const slots = [];
    const masked = String(text || '').replace(PROTECTED_TOKEN_PATTERN, (match) => {
        const token = `__AURA_SLOT_${slots.length}__`;
        slots.push({ token, value: match });
        return token;
    });
    return { masked, slots };
};

const restoreProtectedSegments = (text = '', slots = []) => {
    let restored = String(text || '');
    for (const slot of slots) {
        restored = restored.split(slot.token).join(slot.value);
    }
    return restored;
};

const createCompositionalTranslator = ({ reviewedCatalogDir = DEFAULT_REVIEWED_CATALOG_DIR } = {}) => {
    let englishCatalogCache = null;
    const memoryByLocale = new Map();

    const readJsonSafe = (filePath) => {
        try {
            if (!fs.existsSync(filePath)) return null;
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } catch {
            return null;
        }
    };

    const getMemory = (targetLanguage) => {
        if (memoryByLocale.has(targetLanguage)) {
            return memoryByLocale.get(targetLanguage);
        }

        const exactMap = new Map();
        const bundled = CORE_COMMERCE_LEXICON[targetLanguage] || {};
        for (const [source, translation] of Object.entries(bundled)) {
            exactMap.set(normalizeLookupKey(source), translation);
        }

        if (englishCatalogCache === null) {
            englishCatalogCache = readJsonSafe(path.join(reviewedCatalogDir, 'en.json')) || {};
        }

        const localeCatalog = readJsonSafe(path.join(reviewedCatalogDir, `${targetLanguage}.json`));
        if (localeCatalog && englishCatalogCache) {
            for (const [id, sourceMessage] of Object.entries(englishCatalogCache)) {
                const candidate = localeCatalog[id];
                if (!isCleanTranslationCandidate(sourceMessage, candidate)) continue;
                const key = normalizeLookupKey(sourceMessage);
                if (key && !exactMap.has(key) && !/[{]/.test(sourceMessage)) {
                    exactMap.set(key, candidate.trim());
                }
            }
        }

        const phraseEntries = [...exactMap.entries()]
            .filter(([key]) => key.length >= 3)
            .sort((left, right) => right[0].length - left[0].length);

        const memory = { exactMap, phraseEntries };
        memoryByLocale.set(targetLanguage, memory);
        return memory;
    };

    const translateClause = (clause, memory) => {
        const leadingSpace = clause.match(/^\s*/)?.[0] || '';
        const trailingSpace = clause.match(/\s*$/)?.[0] || '';
        const core = clause.trim();
        if (!core) return clause;

        const exactHit = memory.exactMap.get(normalizeLookupKey(core));
        if (exactHit) {
            return `${leadingSpace}${exactHit}${trailingSpace}`;
        }

        // Longest-first phrasal span substitution on token boundaries.
        const tokens = core.split(/\s+/);
        if (tokens.length > 1) {
            const output = [];
            let index = 0;
            while (index < tokens.length) {
                let matched = false;
                const maxSpan = Math.min(6, tokens.length - index);
                for (let span = maxSpan; span >= 1; span -= 1) {
                    const slice = tokens.slice(index, index + span).join(' ');
                    const translation = memory.exactMap.get(normalizeLookupKey(slice));
                    if (translation) {
                        output.push(translation);
                        index += span;
                        matched = true;
                        break;
                    }
                }
                if (!matched) {
                    output.push(tokens[index]);
                    index += 1;
                }
            }
            return `${leadingSpace}${output.join(' ')}${trailingSpace}`;
        }

        return clause;
    };

    const applyLocalePunctuation = (text = '', targetLanguage = 'en') => {
        if (targetLanguage === 'ar') {
            return text.replace(/\?/g, '؟').replace(/,\s+/g, '، ');
        }
        if (targetLanguage === 'ja' || targetLanguage === 'zh') {
            return text.replace(/,\s+/g, '、').replace(/\.$/, '。');
        }
        return text;
    };

    const translateText = ({ targetLanguage = 'en', text = '' } = {}) => {
        const input = String(text || '');
        if (!input.trim() || !targetLanguage || targetLanguage === 'en') {
            return input;
        }

        const memory = getMemory(targetLanguage);
        const directHit = memory.exactMap.get(normalizeLookupKey(input));
        if (directHit) {
            return directHit;
        }

        const { masked, slots } = buildProtectedSegments(input);
        const maskedHit = memory.exactMap.get(normalizeLookupKey(masked));
        if (maskedHit) {
            return restoreProtectedSegments(maskedHit, slots);
        }

        const segments = masked.split(DELIMITER_SPLIT_PATTERN);
        const translated = segments
            .map((segment, index) => (index % 2 === 0 ? translateClause(segment, memory) : segment))
            .join('');
        const restored = restoreProtectedSegments(translated, slots);
        return applyLocalePunctuation(restored, targetLanguage);
    };

    return {
        clearCache: () => {
            englishCatalogCache = null;
            memoryByLocale.clear();
        },
        translateText,
    };
};

module.exports = {
    CORE_COMMERCE_LEXICON,
    createCompositionalTranslator,
    isCleanTranslationCandidate,
};
