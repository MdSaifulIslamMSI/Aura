const { z } = require('zod');

const translateBatchSchema = z.object({
    body: z.object({
        language: z.string().trim().min(2).max(5).optional(),
        sourceLanguage: z.string().trim().min(2).max(5).optional(),
        texts: z.array(
            z.string().trim().min(1, 'Text is required').max(800, 'Text must be 800 characters or fewer')
        )
            .min(1, 'At least one text value is required')
            .max(50, 'A maximum of 50 texts can be translated per request'),
    }).strict(),
});

module.exports = {
    translateBatchSchema,
};
