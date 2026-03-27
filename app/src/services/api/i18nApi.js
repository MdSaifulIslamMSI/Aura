import { apiFetch } from '../apiBase';

const MAX_BATCH_SIZE = 50;

const normalizeText = (value = '') => String(value || '').replace(/\s+/g, ' ').trim();

const chunk = (values = [], size = MAX_BATCH_SIZE) => {
    const chunks = [];
    for (let index = 0; index < values.length; index += size) {
        chunks.push(values.slice(index, index + size));
    }
    return chunks;
};

export const i18nApi = {
    translateTexts: async ({
        texts = [],
        language,
        sourceLanguage = 'auto',
    } = {}) => {
        const normalizedTexts = [...new Set(
            (Array.isArray(texts) ? texts : [])
                .map(normalizeText)
                .filter(Boolean)
        )];

        if (normalizedTexts.length === 0) {
            return {};
        }

        const translatedEntries = await Promise.all(
            chunk(normalizedTexts, MAX_BATCH_SIZE).map(async (batch) => {
                const { data } = await apiFetch('/i18n/translate', {
                    method: 'POST',
                    timeoutMs: 20000,
                    body: JSON.stringify({
                        texts: batch,
                        language,
                        sourceLanguage,
                    }),
                });

                return data?.translations || {};
            })
        );

        return Object.assign({}, ...translatedEntries);
    },
};
