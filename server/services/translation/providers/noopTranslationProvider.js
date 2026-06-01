const createNoopTranslationProvider = () => ({
    name: 'noop',
    translateText: async ({ text }) => text,
});

module.exports = {
    createNoopTranslationProvider,
};
