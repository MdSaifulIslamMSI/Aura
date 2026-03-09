const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');

const REVIEW_UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'reviews');
const REVIEW_UPLOAD_S3_BUCKET = String(process.env.REVIEW_UPLOAD_S3_BUCKET || '').trim();
const REVIEW_UPLOAD_S3_PREFIX = String(process.env.REVIEW_UPLOAD_S3_PREFIX || 'reviews').trim().replace(/^\/+|\/+$/g, '');
const REVIEW_UPLOAD_PUBLIC_BASE_URL = String(process.env.REVIEW_UPLOAD_PUBLIC_BASE_URL || '').trim().replace(/\/+$/g, '');
const AWS_REGION = String(process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || '').trim();

const MIME_EXTENSION_MAP = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'video/quicktime': '.mov',
};

let s3Client = null;

const getStorageDriver = () => {
    const requested = String(process.env.UPLOAD_STORAGE_DRIVER || 'local').trim().toLowerCase();
    return requested === 's3' ? 's3' : 'local';
};

const ensureLocalStorageReady = async () => {
    await fs.promises.mkdir(REVIEW_UPLOAD_DIR, { recursive: true });
};

const getS3Client = () => {
    if (s3Client) return s3Client;

    if (!AWS_REGION) {
        throw new Error('AWS_REGION is required when UPLOAD_STORAGE_DRIVER=s3');
    }
    if (!REVIEW_UPLOAD_S3_BUCKET) {
        throw new Error('REVIEW_UPLOAD_S3_BUCKET is required when UPLOAD_STORAGE_DRIVER=s3');
    }

    s3Client = new S3Client({ region: AWS_REGION });
    return s3Client;
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

const storeReviewMediaInS3 = async ({ fileBuffer, fileName, mimeType }) => {
    const client = getS3Client();
    const storageKey = REVIEW_UPLOAD_S3_PREFIX
        ? `${REVIEW_UPLOAD_S3_PREFIX}/${fileName}`
        : fileName;

    await client.send(new PutObjectCommand({
        Bucket: REVIEW_UPLOAD_S3_BUCKET,
        Key: storageKey,
        Body: fileBuffer,
        ContentType: mimeType,
        CacheControl: 'public, max-age=31536000, immutable',
    }));

    return {
        storageDriver: 's3',
        storageKey,
        url: buildPublicUrl('s3', storageKey),
    };
};

const ensureReviewUploadStorageReady = async () => {
    if (getStorageDriver() === 's3') {
        getS3Client();
        return;
    }

    await ensureLocalStorageReady();
};

const storeReviewMedia = async ({ fileBuffer, fileName, mimeType }) => {
    const normalizedMimeType = String(mimeType || '').trim().toLowerCase();
    const normalizedFileName = sanitizeObjectKeySegment(fileName || 'review-media');
    const storedFileName = buildStoredFileName(normalizedFileName, normalizedMimeType);

    if (getStorageDriver() === 's3') {
        return storeReviewMediaInS3({
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
    if (getStorageDriver() !== 's3') {
        throw new Error('Review media object reads require S3 storage');
    }

    const client = getS3Client();
    const response = await client.send(new GetObjectCommand({
        Bucket: REVIEW_UPLOAD_S3_BUCKET,
        Key: String(storageKey || ''),
    }));

    return {
        body: response.Body || null,
        contentType: String(response.ContentType || ''),
        cacheControl: String(response.CacheControl || ''),
        contentLength: Number(response.ContentLength || 0),
        etag: String(response.ETag || ''),
        lastModified: response.LastModified || null,
    };
};

module.exports = {
    ensureReviewUploadStorageReady,
    getStorageDriver,
    getReviewMediaObject,
    storeReviewMedia,
};
