const { guardedFetch } = require('../../../security/remoteFetchGuardService');

const createLibreTranslateProvider = ({ baseUrl, timeoutMs }) => ({
    name: 'libretranslate',
    translateText: async ({ sourceLanguage = 'auto', targetLanguage, text }) => {
        const controller = typeof AbortController === 'function'
            ? new AbortController()
            : null;
        const timeoutId = controller
            ? setTimeout(() => controller.abort(), timeoutMs)
            : null;

        let host = '';
        try {
            host = new URL(baseUrl).hostname;
        } catch {
            // Invalid URLs are rejected by the egress guard.
        }

        try {
            // LibreTranslate is often self-hosted on internal networks, so
            // operator configuration decides the destination.
            const response = await guardedFetch(`${baseUrl}/translate`, {
                allowedHosts: host ? [host] : [],
                validateDns: false,
                allowPrivateTarget: true,
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
                timeoutMs,
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
