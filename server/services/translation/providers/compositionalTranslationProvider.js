const { createCompositionalTranslator } = require('../compositionalTranslator');

const createCompositionalTranslationProvider = ({ reviewedCatalogDir } = {}) => {
    const translator = createCompositionalTranslator({ reviewedCatalogDir });
    return {
        name: 'compositional',
        translateText: async ({ targetLanguage, text }) => translator.translateText({ targetLanguage, text }),
    };
};

module.exports = {
    createCompositionalTranslationProvider,
};
