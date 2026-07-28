const sharp = require('sharp');
const {
    AVATAR_OUTPUT_SIZE,
    normalizeAvatarImage,
} = require('../services/avatarImageService');

describe('avatar image normalization', () => {
    test('decodes and emits a bounded metadata-free WebP', async () => {
        const input = await sharp({
            create: {
                width: 800,
                height: 600,
                channels: 4,
                background: { r: 30, g: 120, b: 180, alpha: 1 },
            },
        }).png().withMetadata({ orientation: 6 }).toBuffer();

        const result = await normalizeAvatarImage(input);
        const outputMetadata = await sharp(result.fileBuffer).metadata();

        expect(result).toMatchObject({
            mimeType: 'image/webp',
            width: AVATAR_OUTPUT_SIZE,
            height: AVATAR_OUTPUT_SIZE,
            sourceWidth: 800,
            sourceHeight: 600,
        });
        expect(outputMetadata.format).toBe('webp');
        expect(outputMetadata.width).toBe(AVATAR_OUTPUT_SIZE);
        expect(outputMetadata.height).toBe(AVATAR_OUTPUT_SIZE);
        expect(outputMetadata.exif).toBeUndefined();
        expect(outputMetadata.xmp).toBeUndefined();
    });

    test('rejects undecodable and over-dimension images', async () => {
        await expect(normalizeAvatarImage(Buffer.from('not-an-image')))
            .rejects.toMatchObject({ statusCode: 400 });

        const tooWide = await sharp({
            create: {
                width: 4097,
                height: 1,
                channels: 3,
                background: { r: 0, g: 0, b: 0 },
            },
        }).png().toBuffer();
        await expect(normalizeAvatarImage(tooWide))
            .rejects.toMatchObject({ statusCode: 400 });
    });
});
