const path = require('node:path');

const normalizePath = (filePath) => {
    const normalized = path.resolve(filePath);
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
};

const shouldCollectFormatJsSourceFile = ({ filePath, generatedDescriptorPath }) => (
    normalizePath(filePath) !== normalizePath(generatedDescriptorPath)
);

const isStaleEnglishFallback = ({
    existingMessage,
    previousSourceMessage,
    sourceMessage,
}) => Boolean(
    existingMessage
    && previousSourceMessage
    && previousSourceMessage !== sourceMessage
    && existingMessage === previousSourceMessage
);

const getPromotionReviewReason = ({ isStableMessage }) => (
    isStableMessage
        ? 'legacy-pack-promotion-needs-human-review'
        : 'foundation-pack-promotion-needs-human-review'
);

module.exports = {
    getPromotionReviewReason,
    isStaleEnglishFallback,
    shouldCollectFormatJsSourceFile,
};
