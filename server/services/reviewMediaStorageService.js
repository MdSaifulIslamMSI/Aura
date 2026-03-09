const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REVIEW_UPLOAD_DIR = path.resolve(
    process.env.REVIEW_UPLOAD_DIR
    || path.join(__dirname, '..', 'uploads', 'reviews')
);

const MIME_EXTENSION_MAP = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'video/quicktime': '.mov',
};
const EXTENSION_MIME_MAP = Object.fromEntries(
    Object.entries(MIME_EXTENSION_MAP).map(([mimeType, extension]) => [extension, mimeType])
);

const getStorageDriver = () => {
    return 'local';
};

const ensureLocalStorageReady = async () => {
    await fs.promises.mkdir(REVIEW_UPLOAD_DIR, { recursive: true });
};

const sanitizeObjectKeySegment = (value) => String(value || '')
    .trim()
    .replace(/[^\w.\-() ]+/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 220);

const buildStoredFileName = (fileName, mimeType) => {
    const extension = MIME_EXTENSION_MAP[mimeType]
        || path.extname(String(fileName || '')).slice(0, 12)
        || '';
    const safeExtension = extension
        ? (extension.startsWith('.') ? extension.toLowerCase() : `.${extension.toLowerCase()}`)
        : '';

    return `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${safeExtension}`;
};

const encodeUrlPath = (value) => String(value || '')
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');

const buildReviewMediaStorageKey = (relativePath = '') => String(relativePath || '').replace(/^\/+|\/+$/g, '');

const buildPublicUrl = (storageDriver, storageKey) => {
    if (storageDriver !== 'local') {
        throw new Error(`Unsupported storage driver: ${storageDriver}`);
    }
    return `/uploads/reviews/${encodeUrlPath(path.basename(storageKey))}`;
};

const storeReviewMediaLocally = async ({ fileBuffer, fileName }) => {
    await ensureLocalStorageReady();
    const targetPath = path.join(REVIEW_UPLOAD_DIR, fileName);
    await fs.promises.writeFile(targetPath, fileBuffer);

    return {
        storageDriver: 'local',
        storageKey: fileName,
        url: buildPublicUrl('local', fileName),
    };
};

const ensureReviewUploadStorageReady = async () => {
    await ensureLocalStorageReady();
};

const storeReviewMedia = async ({ fileBuffer, fileName, mimeType }) => {
    const normalizedMimeType = String(mimeType || '').trim().toLowerCase();
    const normalizedFileName = sanitizeObjectKeySegment(fileName || 'review-media');
    const storedFileName = buildStoredFileName(normalizedFileName, normalizedMimeType);

    return storeReviewMediaLocally({
        fileBuffer,
        fileName: storedFileName,
    });
};

const getReviewMediaObject = async ({ storageKey }) => {
    const safeStorageKey = buildReviewMediaStorageKey(storageKey);
    if (!safeStorageKey) {
        const missingError = new Error('Upload not found');
        missingError.code = 404;
        throw missingError;
    }

    const targetPath = path.join(REVIEW_UPLOAD_DIR, path.basename(safeStorageKey));
    let stats;
    try {
        stats = await fs.promises.stat(targetPath);
    } catch (error) {
        if (error?.code === 'ENOENT') {
            error.code = 404;
        }
        throw error;
    }

    return {
        body: fs.createReadStream(targetPath),
        contentType: EXTENSION_MIME_MAP[path.extname(targetPath).toLowerCase()] || '',
        cacheControl: 'public, max-age=31536000, immutable',
        contentLength: Number(stats.size || 0),
        etag: '',
        lastModified: stats.mtime || null,
    };
};

module.exports = {
    buildReviewMediaStorageKey,
    ensureReviewUploadStorageReady,
    getStorageDriver,
    getReviewMediaObject,
    storeReviewMedia,
};
