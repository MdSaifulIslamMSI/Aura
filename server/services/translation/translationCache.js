const crypto = require('crypto');

const cacheStore = new Map();

const hashValue = (value = '') => crypto
    .createHash('sha256')
    .update(String(value || ''))
    .digest('hex');

const getTranslationCacheKey = ({
    glossaryVersion = 'v1',
    providerName = 'noop',
    sourceLanguage = 'auto',
    targetLanguage = 'en',
    text = '',
} = {}) => [
    'translation',
    providerName,
    sourceLanguage,
    targetLanguage,
    glossaryVersion,
    hashValue(text),
].join(':');

const readTranslationCache = (cacheKey, ttlMs) => {
    const entry = cacheStore.get(cacheKey);
    if (!entry) return '';
    if (Date.now() - entry.cachedAt > ttlMs) {
        cacheStore.delete(cacheKey);
        return '';
    }
    return entry.value || '';
};

const writeTranslationCache = (cacheKey, value = '') => {
    cacheStore.set(cacheKey, {
        cachedAt: Date.now(),
        value: String(value || ''),
    });
};

const clearTranslationCache = () => {
    cacheStore.clear();
};

module.exports = {
    clearTranslationCache,
    getTranslationCacheKey,
    hashValue,
    readTranslationCache,
    writeTranslationCache,
};
