const sharp = require('sharp');
const AppError = require('../utils/AppError');

const AVATAR_OUTPUT_SIZE = 512;
const AVATAR_MAX_INPUT_DIMENSION = 4096;
const AVATAR_MAX_INPUT_PIXELS = 16 * 1024 * 1024;

const normalizeAvatarImage = async (fileBuffer) => {
    let metadata;
    try {
        metadata = await sharp(fileBuffer, {
            failOn: 'warning',
            limitInputPixels: AVATAR_MAX_INPUT_PIXELS,
            sequentialRead: true,
        }).metadata();
    } catch {
        throw new AppError('Avatar image could not be decoded', 400);
    }

    const width = Number(metadata?.width || 0);
    const height = Number(metadata?.height || 0);
    if (
        width < 1
        || height < 1
        || width > AVATAR_MAX_INPUT_DIMENSION
        || height > AVATAR_MAX_INPUT_DIMENSION
        || Number(metadata?.pages || 1) !== 1
    ) {
        throw new AppError(
            `Avatar dimensions must be between 1 and ${AVATAR_MAX_INPUT_DIMENSION} pixels and must not be animated`,
            400
        );
    }

    try {
        const { data, info } = await sharp(fileBuffer, {
            failOn: 'warning',
            limitInputPixels: AVATAR_MAX_INPUT_PIXELS,
            sequentialRead: true,
        })
            .rotate()
            .resize(AVATAR_OUTPUT_SIZE, AVATAR_OUTPUT_SIZE, {
                fit: 'cover',
                position: 'attention',
            })
            // sharp strips EXIF, XMP, and other metadata unless withMetadata is requested.
            .webp({ quality: 82, effort: 4 })
            .toBuffer({ resolveWithObject: true });

        return {
            fileBuffer: data,
            mimeType: 'image/webp',
            sizeBytes: data.length,
            width: Number(info.width || AVATAR_OUTPUT_SIZE),
            height: Number(info.height || AVATAR_OUTPUT_SIZE),
            sourceWidth: width,
            sourceHeight: height,
        };
    } catch {
        throw new AppError('Avatar image could not be normalized', 400);
    }
};

module.exports = {
    AVATAR_MAX_INPUT_DIMENSION,
    AVATAR_OUTPUT_SIZE,
    normalizeAvatarImage,
};
