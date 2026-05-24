const normalizeMimeType = (value) => String(value || '').trim().toLowerCase();

const bufferStartsWith = (buffer, signature) => (
    Buffer.isBuffer(buffer)
    && signature.every((byte, index) => buffer[index] === byte)
);

const readAscii = (buffer, start, end) => {
    if (!Buffer.isBuffer(buffer) || buffer.length < end) return '';
    return buffer.subarray(start, end).toString('ascii');
};

const detectReviewMediaMime = (buffer) => {
    if (!Buffer.isBuffer(buffer) || buffer.length < 4) return '';

    if (bufferStartsWith(buffer, [0xff, 0xd8, 0xff])) {
        return 'image/jpeg';
    }

    if (bufferStartsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
        return 'image/png';
    }

    if (readAscii(buffer, 0, 4) === 'RIFF' && readAscii(buffer, 8, 12) === 'WEBP') {
        return 'image/webp';
    }

    if (bufferStartsWith(buffer, [0x1a, 0x45, 0xdf, 0xa3])) {
        return 'video/webm';
    }

    if (readAscii(buffer, 4, 8) === 'ftyp') {
        const brand = readAscii(buffer, 8, 12);
        return brand === 'qt  ' ? 'video/quicktime' : 'video/mp4';
    }

    return '';
};

const canonicalReviewMime = (value) => {
    const normalized = normalizeMimeType(value);
    return normalized === 'image/jpg' ? 'image/jpeg' : normalized;
};

const isReviewMediaMimeCompatible = (declaredMime, detectedMime) => {
    const declared = canonicalReviewMime(declaredMime);
    const detected = canonicalReviewMime(detectedMime);
    return Boolean(declared && detected && declared === detected);
};

module.exports = {
    canonicalReviewMime,
    detectReviewMediaMime,
    isReviewMediaMimeCompatible,
};
