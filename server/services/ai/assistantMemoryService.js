/**
 * Server-owned conversational memory: resolves referring expressions
 * ("it", "the second one", "the cheaper one", "the red one") against the
 * server's own session state (lastResults + activeProduct) — never against
 * client-supplied ids. Pure and synchronous.
 */

const safeString = (value, fallback = '') => String(value === undefined || value === null ? fallback : value).trim();

const sessionResults = (assistantSession = {}) => (
    Array.isArray(assistantSession?.lastResults)
        ? assistantSession.lastResults
            .map((entry) => ({
                id: safeString(entry?.id || ''),
                title: safeString(entry?.title || ''),
                brand: safeString(entry?.brand || ''),
                category: safeString(entry?.category || ''),
                price: Number(entry?.price || 0),
                rating: Number(entry?.rating || 0),
            }))
            .filter((entry) => entry.id)
        : []
);

const ORDINAL_WORDS = new Map([
    ['first', 0], ['1st', 0],
    ['second', 1], ['2nd', 1],
    ['third', 2], ['3rd', 2],
    ['fourth', 3], ['4th', 3],
    ['fifth', 4], ['5th', 4],
    ['last', -1],
]);

const matchOrdinal = (normalized = '') => {
    for (const [token, index] of ORDINAL_WORDS) {
        if (new RegExp(`\\b${token}\\b`, 'i').test(normalized)) return index;
    }
    const optionMatch = normalized.match(/\b(?:option|number|no\.?|#)\s*(\d{1,2})\b/i);
    if (optionMatch) {
        const position = Number(optionMatch[1]) - 1;
        if (position >= 0) return position;
    }
    return null;
};

const matchPronoun = (normalized = '') => (
    /\b(it|this one|that one|this product|that product|the (?:same )?one)\b/i.test(normalized)
);

const matchSuperlative = (normalized = '') => {
    if (/\b(cheapest|cheaper|lowest price|least expensive|budget (?:one|option|pick))\b/i.test(normalized)) return 'min_price';
    if (/\b((most expensive|priciest|highest price|costliest)|(premium))\b/i.test(normalized)) return 'max_price';
    if (/\b((top|best|highest)[- ]rated|best reviews?)\b/i.test(normalized)) return 'max_rating';
    return null;
};

const matchAttribute = (normalized = '', results = []) => {
    const tokens = safeString(normalized).toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 3);
    const stopwords = new Set(['the', 'one', 'that', 'this', 'with', 'and', 'show', 'open', 'that', 'about', 'from']);
    const hits = new Map();
    for (const token of tokens) {
        if (stopwords.has(token)) continue;
        const matched = results.filter((item) => (
            safeString(item.title).toLowerCase().includes(token)
            || safeString(item.brand).toLowerCase() === token
            || safeString(item.category).toLowerCase().includes(token)
        ));
        if (matched.length === 1) {
            hits.set(matched[0].id, (hits.get(matched[0].id) || 0) + 1);
        } else if (matched.length > 1) {
            return { ambiguous: true };
        }
    }
    if (hits.size === 1) return { productId: [...hits.keys()][0] };
    return null;
};

/**
 * @returns {{ productId: string, how: string } | { ambiguous: true } | null}
 */
const resolveReferringExpression = ({ message = '', assistantSession = {} } = {}) => {
    const normalized = safeString(message);
    if (!normalized) return null;
    const results = sessionResults(assistantSession);
    const activeId = safeString(assistantSession?.activeProduct?.id || '');
    if (results.length === 0 && !activeId) return null;

    const ordinal = matchOrdinal(normalized);
    if (ordinal !== null && results.length > 0) {
        const index = ordinal === -1 ? results.length - 1 : ordinal;
        if (results[index]) return { productId: results[index].id, how: 'ordinal' };
        return null;
    }

    const superlative = matchSuperlative(normalized);
    if (superlative && results.length > 0) {
        const sorted = [...results].sort((left, right) => {
            if (superlative === 'min_price') return left.price - right.price;
            if (superlative === 'max_price') return right.price - left.price;
            return right.rating - left.rating;
        });
        if (sorted[0]) return { productId: sorted[0].id, how: 'superlative' };
        return null;
    }

    if (matchPronoun(normalized)) {
        if (activeId) return { productId: activeId, how: 'pronoun_active' };
        if (results.length === 1) return { productId: results[0].id, how: 'pronoun_single' };
        if (results.length > 1) return { ambiguous: true };
        return null;
    }

    if (results.length > 0) {
        const attribute = matchAttribute(normalized, results);
        if (attribute) return attribute.ambiguous ? { ambiguous: true } : { ...attribute, how: 'attribute' };
    }

    return null;
};

const hasReferringExpression = ({ message = '', assistantSession = {} } = {}) => (
    resolveReferringExpression({ message, assistantSession }) !== null
);

module.exports = {
    hasReferringExpression,
    resolveReferringExpression,
};
