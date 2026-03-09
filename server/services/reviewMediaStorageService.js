const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Storage } = require('@google-cloud/storage');

const REVIEW_UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'reviews');
const REVIEW_UPLOAD_GCS_BUCKET = String(process.env.REVIEW_UPLOAD_GCS_BUCKET || '').trim();
const REVIEW_UPLOAD_GCS_PREFIX = String(process.env.REVIEW_UPLOAD_GCS_PREFIX || 'reviews').trim().replace(/^\/+|\/+$/g, '');
const REVIEW_UPLOAD_PUBLIC_BASE_URL = String(process.env.REVIEW_UPLOAD_PUBLIC_BASE_URL || '').trim().replace(/\/+$/g, '');
const GCP_PROJECT_ID = String(
    process.env.GCP_PROJECT_ID
    || process.env.GOOGLE_CLOUD_PROJECT
    || process.env.GCLOUD_PROJECT
    || ''
).trim();

const MIME_EXTENSION_MAP = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'video/quicktime': '.mov',
};

let storageClient = null;

const getStorageDriver = () => {
    const requested = String(process.env.UPLOAD_STORAGE_DRIVER || 'local').trim().toLowerCase();
    return requested === 'gcs' ? 'gcs' : 'local';
};

const ensureLocalStorageReady = async () => {
    await fs.promises.mkdir(REVIEW_UPLOAD_DIR, { recursive: true });
};

const getStorageClient = () => {
    if (storageClient) return storageClient;

    if (!REVIEW_UPLOAD_GCS_BUCKET) {
        throw new Error('REVIEW_UPLOAD_GCS_BUCKET is required when UPLOAD_STORAGE_DRIVER=gcs');
    }

    storageClient = GCP_PROJECT_ID
        ? new Storage({ projectId: GCP_PROJECT_ID })
        : new Storage();
    return storageClient;
};

const getStorageBucket = () => getStorageClient().bucket(REVIEW_UPLOAD_GCS_BUCKET);

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

const buildReviewMediaStorageKey = (relativePath = '') => {
    const cleanPath = String(relativePath || '').replace(/^\/+|\/+$/g, '');
    if (!cleanPath) {
        return REVIEW_UPLOAD_GCS_PREFIX || 'reviews';
    }

    return REVIEW_UPLOAD_GCS_PREFIX
        ? `${REVIEW_UPLOAD_GCS_PREFIX}/${cleanPath}`.replace(/\/+/g, '/')
        : cleanPath;
};

const buildPublicUrl = (storageDriver, storageKey) => {
    if (storageDriver === 'local') {
        return `/uploads/reviews/${path.basename(storageKey)}`;
    }

    if (REVIEW_UPLOAD_PUBLIC_BASE_URL) {
        return `${REVIEW_UPLOAD_PUBLIC_BASE_URL}/${encodeUrlPath(storageKey)}`;
    }

    return `/uploads/${encodeUrlPath(storageKey)}`;
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

const storeReviewMediaInGcs = async ({ fileBuffer, fileName, mimeType }) => {
    const storageKey = buildReviewMediaStorageKey(fileName);
    const file = getStorageBucket().file(storageKey);

    await file.save(fileBuffer, {
        resumable: false,
        contentType: mimeType,
        metadata: {
            cacheControl: 'public, max-age=31536000, immutable',
        },
    });

    return {
        storageDriver: 'gcs',
        storageKey,
        url: buildPublicUrl('gcs', storageKey),
    };
};

const ensureReviewUploadStorageReady = async () => {
    if (getStorageDriver() === 'gcs') {
        getStorageBucket();
        return;
    }

    await ensureLocalStorageReady();
};

const storeReviewMedia = async ({ fileBuffer, fileName, mimeType }) => {
    const normalizedMimeType = String(mimeType || '').trim().toLowerCase();
    const normalizedFileName = sanitizeObjectKeySegment(fileName || 'review-media');
    const storedFileName = buildStoredFileName(normalizedFileName, normalizedMimeType);

    if (getStorageDriver() === 'gcs') {
        return storeReviewMediaInGcs({
            fileBuffer,
            fileName: storedFileName,
            mimeType: normalizedMimeType,
        });
    }

    return storeReviewMediaLocally({
        fileBuffer,
        fileName: storedFileName,
    });
};

const getReviewMediaObject = async ({ storageKey }) => {
    if (getStorageDriver() !== 'gcs') {
        throw new Error('Review media object reads require GCS storage');
    }

    const file = getStorageBucket().file(String(storageKey || ''));
    const [metadata] = await file.getMetadata();

    return {
        body: file.createReadStream(),
        contentType: String(metadata.contentType || ''),
        cacheControl: String(metadata.cacheControl || ''),
        contentLength: Number(metadata.size || 0),
        etag: String(metadata.etag || ''),
        lastModified: metadata.updated || null,
    };
};

module.exports = {
    buildReviewMediaStorageKey,
    ensureReviewUploadStorageReady,
    getStorageDriver,
    getReviewMediaObject,
    storeReviewMedia,
};
