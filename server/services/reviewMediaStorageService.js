const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
    GetObjectCommand,
    HeadBucketCommand,
    PutObjectCommand,
    S3Client,
} = require('@aws-sdk/client-s3');

const REVIEW_UPLOAD_DIR = path.resolve(
    process.env.REVIEW_UPLOAD_DIR
    || path.join(__dirname, '..', 'uploads', 'reviews')
);
const AWS_S3_REVIEW_BUCKET = String(
    process.env.AWS_S3_REVIEW_BUCKET
    || ''
).trim();
const AWS_S3_REVIEW_PREFIX = String(
    process.env.AWS_S3_REVIEW_PREFIX
    || 'review-media'
).trim().replace(/^\/+|\/+$/g, '');

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

let s3Client = null;
let s3BucketReadyPromise = null;

const getStorageDriver = () => {
    const normalized = String(process.env.UPLOAD_STORAGE_DRIVER || 'local').trim().toLowerCase();
    return normalized === 's3' ? 's3' : 'local';
};

const getAwsRegion = () => String(process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || '').trim();

const getS3Client = () => {
    if (s3Client) {
        return s3Client;
    }

    const region = getAwsRegion();
    if (!region) {
        throw new Error('AWS_REGION is required when UPLOAD_STORAGE_DRIVER=s3');
    }

    const endpoint = String(process.env.AWS_S3_ENDPOINT || '').trim();
    const forcePathStyle = ['1', 'true', 'yes', 'on'].includes(
        String(process.env.AWS_S3_FORCE_PATH_STYLE || '').trim().toLowerCase()
    );

    const clientOptions = { region };
    if (endpoint) {
        clientOptions.endpoint = endpoint;
    }
    if (forcePathStyle) {
        clientOptions.forcePathStyle = true;
    }

    s3Client = new S3Client(clientOptions);
    return s3Client;
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

const buildS3ObjectKey = (fileName = '') => {
    const safeFileName = path.basename(String(fileName || '').trim());
    if (!safeFileName) {
        return '';
    }
    if (!AWS_S3_REVIEW_PREFIX) {
        return safeFileName;
    }
    return `${AWS_S3_REVIEW_PREFIX}/${safeFileName}`;
};

const buildPublicUrl = (storageDriver, storageKey) => {
    if (!['local', 's3'].includes(storageDriver)) {
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

const ensureS3StorageReady = async () => {
    if (s3BucketReadyPromise) {
        return s3BucketReadyPromise;
    }

    if (!AWS_S3_REVIEW_BUCKET) {
        throw new Error('AWS_S3_REVIEW_BUCKET is required when UPLOAD_STORAGE_DRIVER=s3');
    }

    s3BucketReadyPromise = Promise.resolve().then(async () => {
        const client = getS3Client();
        await client.send(new HeadBucketCommand({
            Bucket: AWS_S3_REVIEW_BUCKET,
        }));
    }).catch((error) => {
        s3BucketReadyPromise = null;
        throw error;
    });

    return s3BucketReadyPromise;
};

const storeReviewMediaInS3 = async ({ fileBuffer, fileName, mimeType }) => {
    await ensureS3StorageReady();
    const client = getS3Client();
    await client.send(new PutObjectCommand({
        Bucket: AWS_S3_REVIEW_BUCKET,
        Key: buildS3ObjectKey(fileName),
        Body: fileBuffer,
        ContentType: mimeType || undefined,
        CacheControl: 'public, max-age=31536000, immutable',
    }));

    return {
        storageDriver: 's3',
        storageKey: fileName,
        url: buildPublicUrl('s3', fileName),
    };
};

const ensureReviewUploadStorageReady = async () => {
    if (getStorageDriver() === 's3') {
        await ensureS3StorageReady();
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
    const safeStorageKey = buildReviewMediaStorageKey(storageKey);
    if (!safeStorageKey) {
        const missingError = new Error('Upload not found');
        missingError.code = 404;
        throw missingError;
    }

    if (getStorageDriver() === 's3') {
        const client = getS3Client();
        try {
            const downloadResponse = await client.send(new GetObjectCommand({
                Bucket: AWS_S3_REVIEW_BUCKET,
                Key: buildS3ObjectKey(path.basename(safeStorageKey)),
            }));
            return {
                body: downloadResponse.Body,
                contentType: downloadResponse.ContentType || '',
                cacheControl: downloadResponse.CacheControl || 'public, max-age=31536000, immutable',
                contentLength: Number(downloadResponse.ContentLength || 0),
                etag: String(downloadResponse.ETag || ''),
                lastModified: downloadResponse.LastModified || null,
            };
        } catch (error) {
            if (
                Number(error?.$metadata?.httpStatusCode || 0) === 404
                || error?.name === 'NotFound'
                || error?.name === 'NoSuchKey'
            ) {
                error.code = 404;
            }
            throw error;
        }
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
