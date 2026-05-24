const {
    detectReviewMediaMime,
    isReviewMediaMimeCompatible,
} = require('../utils/reviewMediaMagicBytes');

describe('reviewMediaMagicBytes', () => {
    test('detects supported image signatures', () => {
        expect(detectReviewMediaMime(Buffer.from([0xff, 0xd8, 0xff, 0xdb]))).toBe('image/jpeg');
        expect(detectReviewMediaMime(Buffer.from([
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        ]))).toBe('image/png');
        expect(detectReviewMediaMime(Buffer.from('RIFFxxxxWEBPVP8 ', 'ascii'))).toBe('image/webp');
    });

    test('detects supported video signatures', () => {
        expect(detectReviewMediaMime(Buffer.from('0000ftypisom', 'ascii'))).toBe('video/mp4');
        expect(detectReviewMediaMime(Buffer.from('0000ftypqt  ', 'ascii'))).toBe('video/quicktime');
        expect(detectReviewMediaMime(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x00]))).toBe('video/webm');
    });

    test('requires declared and detected mime types to match', () => {
        expect(isReviewMediaMimeCompatible('image/jpg', 'image/jpeg')).toBe(true);
        expect(isReviewMediaMimeCompatible('image/png', 'image/jpeg')).toBe(false);
        expect(isReviewMediaMimeCompatible('image/png', '')).toBe(false);
    });
});
