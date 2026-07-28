const {
    createAvatarUploadIntentSchema,
    finalizeAvatarMediaSchema,
    uploadAvatarMediaSchema,
} = require('../validators/accountAvatarValidators');

describe('account avatar validators', () => {
    test('accepts bounded image intents and rejects client ownership fields', () => {
        expect(createAvatarUploadIntentSchema.safeParse({
            body: {
                fileName: 'profile.png',
                mimeType: 'image/png',
                sizeBytes: 1024,
            },
        }).success).toBe(true);
        expect(createAvatarUploadIntentSchema.safeParse({
            body: {
                fileName: 'profile.png',
                mimeType: 'image/svg+xml',
                sizeBytes: 1024,
            },
        }).success).toBe(false);
        expect(createAvatarUploadIntentSchema.safeParse({
            body: {
                fileName: 'profile.png',
                mimeType: 'image/png',
                sizeBytes: 1024,
                userId: 'another-user',
            },
        }).success).toBe(false);
    });

    test('requires signed tokens and strict upload/finalize bodies', () => {
        expect(uploadAvatarMediaSchema.safeParse({
            body: {
                uploadToken: 't'.repeat(40),
                fileName: 'profile.webp',
                mimeType: 'image/webp',
                dataUrl: `data:image/webp;base64,${'a'.repeat(40)}`,
            },
        }).success).toBe(true);
        expect(finalizeAvatarMediaSchema.safeParse({
            body: {
                finalizeToken: 't'.repeat(40),
                storageKey: 'client-selected.webp',
            },
        }).success).toBe(false);
    });
});
