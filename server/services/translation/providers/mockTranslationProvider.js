const createMockTranslationProvider = () => ({
    name: 'mock',
    translateText: async ({ targetLanguage, text }) => `${targetLanguage}:${text}`,
});

module.exports = {
    createMockTranslationProvider,
};
