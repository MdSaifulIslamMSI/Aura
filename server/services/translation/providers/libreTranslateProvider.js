const fetch = require('node-fetch');

const createLibreTranslateProvider = ({ baseUrl, timeoutMs }) => ({
    name: 'libretranslate',
    translateText: async ({ sourceLanguage = 'auto', targetLanguage, text }) => {
        const controller = typeof AbortController === 'function'
            ? new AbortController()
            : null;
        const timeoutId = controller
            ? setTimeout(() => controller.abort(), timeoutMs)
            : null;

        try {
            const response = await fetch(`${baseUrl}/translate`, {
                method: 'POST',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    format: 'text',
                    q: text,
                    source: sourceLanguage,
                    target: targetLanguage,
                }),
                signal: controller?.signal,
                timeout: timeoutMs,
            });

            if (!response.ok) {
                throw new Error(`LibreTranslate returned ${response.status}`);
            }

            const payload = await response.json();
            return String(payload?.translatedText || text);
        } finally {
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
        }
    },
});

module.exports = {
    createLibreTranslateProvider,
};
