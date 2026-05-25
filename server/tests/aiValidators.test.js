const { aiChatSchema } = require('../validators/aiValidators');

const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('aiValidators assistant media contracts', () => {
    test('accepts allowlisted assistant image and audio data URI MIME types', () => {
        const result = aiChatSchema.safeParse({
            body: {
                message: 'compare these',
                images: [{
                    dataUrl: `data:image/png;base64,${pngBase64}`,
                    mimeType: 'image/png',
                    fileName: 'camera.png',
                }],
                audio: [{
                    dataUrl: `data:audio/mpeg;base64,${Buffer.from('ID3\x04\x00\x00\x00\x00\x00\x21', 'binary').toString('base64')}`,
                    mimeType: 'audio/mpeg',
                    fileName: 'voice.mp3',
                }],
            },
        });

        expect(result.success).toBe(true);
    });

    test('rejects unsupported assistant data URI MIME types before controller validation', () => {
        const result = aiChatSchema.safeParse({
            body: {
                message: 'inspect this',
                images: [{
                    dataUrl: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
                    mimeType: 'image/svg+xml',
                    fileName: 'drawing.svg',
                }],
            },
        });

        expect(result.success).toBe(false);
        expect(result.error.issues.map((issue) => issue.message)).toEqual(expect.arrayContaining([
            'Unsupported assistant image MIME type',
            'Unsupported assistant image data URI MIME type',
        ]));
    });
});
