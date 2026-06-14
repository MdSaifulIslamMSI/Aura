const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
    CopyObjectCommand,
    DeleteObjectCommand,
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
const REVIEW_QUARANTINE_DIR = path.join(REVIEW_UPLOAD_DIR, '.quarantine');
const REVIEW_SCAN_STATE_DIR = path.join(REVIEW_UPLOAD_DIR, '.scan-state');
const REVIEW_MEDIA_SCAN_STATES = Object.freeze({
    PENDING: 'pending',
    CLEAN: 'clean',
    INFECTED: 'infected',
});

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

const ensureLocalQuarantineReady = async () => {
    await Promise.all([
        fs.promises.mkdir(REVIEW_UPLOAD_DIR, { recursive: true }),
        fs.promises.mkdir(REVIEW_QUARANTINE_DIR, { recursive: true }),
        fs.promises.mkdir(REVIEW_SCAN_STATE_DIR, { recursive: true }),
    ]);
};

const sanitizeObjectKeySegment = (value) => String(value || '')
    .trim()
    .replace(/[^\w.\-() ]+/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 220);

const normalizeScanState = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    return Object.values(REVIEW_MEDIA_SCAN_STATES).includes(normalized)
        ? normalized
        : REVIEW_MEDIA_SCAN_STATES.PENDING;
};

const sanitizeScanDetail = (value) => String(value || '').trim().slice(0, 500);

const buildScanStatePayload = ({
    storageKey,
    quarantineKey = '',
    scanStatus = REVIEW_MEDIA_SCAN_STATES.PENDING,
    mimeType = '',
    sizeBytes = 0,
    scanResult = null,
    detail = '',
} = {}) => ({
    storageKey: path.basename(String(storageKey || '')),
    quarantineKey: path.basename(String(quarantineKey || storageKey || '')),
    scanStatus: normalizeScanState(scanStatus),
    mimeType: String(mimeType || '').trim().toLowerCase(),
    sizeBytes: Number(sizeBytes || 0),
    detail: sanitizeScanDetail(detail),
    engines: Array.isArray(scanResult?.engines)
        ? scanResult.engines.map((engine) => ({
            engine: String(engine.engine || ''),
            status: String(engine.status || ''),
            signature: String(engine.signature || ''),
            detail: sanitizeScanDetail(engine.detail || ''),
        }))
        : [],
    updatedAt: new Date().toISOString(),
});

const buildScanStatePath = (storageKey = '') => {
    const safeName = path.basename(String(storageKey || '').trim());
    return safeName ? path.join(REVIEW_SCAN_STATE_DIR, `${safeName}.json`) : '';
};

const writeLocalScanState = async (state) => {
    await ensureLocalQuarantineReady();
    const targetPath = buildScanStatePath(state.storageKey);
    if (!targetPath) return null;
    await fs.promises.writeFile(targetPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    return state;
};

const readLocalScanState = async (storageKey = '') => {
    const targetPath = buildScanStatePath(storageKey);
    if (!targetPath) return null;
    try {
        const raw = await fs.promises.readFile(targetPath, 'utf8');
        return JSON.parse(raw);
    } catch (error) {
        if (error?.code === 'ENOENT') return null;
        throw error;
    }
};

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

const buildS3QuarantineObjectKey = (fileName = '') => {
    const safeFileName = path.basename(String(fileName || '').trim());
    if (!safeFileName) {
        return '';
    }
    const quarantinePrefix = AWS_S3_REVIEW_PREFIX
        ? `${AWS_S3_REVIEW_PREFIX}/quarantine`
        : 'quarantine';
    return `${quarantinePrefix}/${safeFileName}`;
};

const encodeS3CopySource = (bucket, key) => `${bucket}/${String(key || '')
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')}`;

const buildS3ScanMetadata = (state) => ({
    'scan-status': state.scanStatus,
    'scan-updated-at': state.updatedAt,
});

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

const quarantineReviewMediaLocally = async ({ fileBuffer, fileName, mimeType }) => {
    await ensureLocalQuarantineReady();
    const targetPath = path.join(REVIEW_QUARANTINE_DIR, fileName);
    await fs.promises.writeFile(targetPath, fileBuffer, { mode: 0o600 });
    const state = buildScanStatePayload({
        storageKey: fileName,
        quarantineKey: fileName,
        scanStatus: REVIEW_MEDIA_SCAN_STATES.PENDING,
        mimeType,
        sizeBytes: fileBuffer.length,
    });
    await writeLocalScanState(state);

    return {
        storageDriver: 'local',
        storageKey: fileName,
        quarantineKey: fileName,
        scanStatus: state.scanStatus,
        url: buildPublicUrl('local', fileName),
    };
};

const markReviewMediaScanStateLocally = async ({
    storageKey,
    quarantineKey = storageKey,
    scanStatus,
    mimeType = '',
    sizeBytes = 0,
    scanResult = null,
    detail = '',
} = {}) => writeLocalScanState(buildScanStatePayload({
    storageKey,
    quarantineKey,
    scanStatus,
    mimeType,
    sizeBytes,
    scanResult,
    detail,
}));

const promoteReviewMediaFromLocalQuarantine = async ({ storageKey, quarantineKey = storageKey, mimeType = '' }) => {
    await ensureLocalQuarantineReady();
    const safeStorageKey = path.basename(String(storageKey || '').trim());
    const safeQuarantineKey = path.basename(String(quarantineKey || safeStorageKey).trim());
    const sourcePath = path.join(REVIEW_QUARANTINE_DIR, safeQuarantineKey);
    const targetPath = path.join(REVIEW_UPLOAD_DIR, safeStorageKey);
    await fs.promises.rename(sourcePath, targetPath);
    const stats = await fs.promises.stat(targetPath);
    await markReviewMediaScanStateLocally({
        storageKey: safeStorageKey,
        quarantineKey: safeQuarantineKey,
        scanStatus: REVIEW_MEDIA_SCAN_STATES.CLEAN,
        mimeType,
        sizeBytes: stats.size,
    });

    return {
        storageDriver: 'local',
        storageKey: safeStorageKey,
        quarantineKey: safeQuarantineKey,
        scanStatus: REVIEW_MEDIA_SCAN_STATES.CLEAN,
        url: buildPublicUrl('local', safeStorageKey),
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

const quarantineReviewMediaInS3 = async ({ fileBuffer, fileName, mimeType }) => {
    await ensureS3StorageReady();
    const client = getS3Client();
    const state = buildScanStatePayload({
        storageKey: fileName,
        quarantineKey: fileName,
        scanStatus: REVIEW_MEDIA_SCAN_STATES.PENDING,
        mimeType,
        sizeBytes: fileBuffer.length,
    });
    await client.send(new PutObjectCommand({
        Bucket: AWS_S3_REVIEW_BUCKET,
        Key: buildS3QuarantineObjectKey(fileName),
        Body: fileBuffer,
        ContentType: mimeType || undefined,
        Metadata: buildS3ScanMetadata(state),
    }));

    return {
        storageDriver: 's3',
        storageKey: fileName,
        quarantineKey: fileName,
        scanStatus: state.scanStatus,
        url: buildPublicUrl('s3', fileName),
    };
};

const markReviewMediaScanStateInS3 = async ({
    storageKey,
    quarantineKey = storageKey,
    scanStatus,
    mimeType = '',
    sizeBytes = 0,
    scanResult = null,
    detail = '',
} = {}) => {
    await ensureS3StorageReady();
    const client = getS3Client();
    const state = buildScanStatePayload({
        storageKey,
        quarantineKey,
        scanStatus,
        mimeType,
        sizeBytes,
        scanResult,
        detail,
    });
    const key = buildS3QuarantineObjectKey(quarantineKey || storageKey);
    await client.send(new CopyObjectCommand({
        Bucket: AWS_S3_REVIEW_BUCKET,
        Key: key,
        CopySource: encodeS3CopySource(AWS_S3_REVIEW_BUCKET, key),
        ContentType: mimeType || undefined,
        MetadataDirective: 'REPLACE',
        Metadata: buildS3ScanMetadata(state),
    }));
    return state;
};

const promoteReviewMediaFromS3Quarantine = async ({ storageKey, quarantineKey = storageKey, mimeType = '' }) => {
    await ensureS3StorageReady();
    const client = getS3Client();
    const sourceKey = buildS3QuarantineObjectKey(quarantineKey || storageKey);
    const targetKey = buildS3ObjectKey(storageKey);
    const state = buildScanStatePayload({
        storageKey,
        quarantineKey,
        scanStatus: REVIEW_MEDIA_SCAN_STATES.CLEAN,
        mimeType,
    });

    await client.send(new CopyObjectCommand({
        Bucket: AWS_S3_REVIEW_BUCKET,
        Key: targetKey,
        CopySource: encodeS3CopySource(AWS_S3_REVIEW_BUCKET, sourceKey),
        ContentType: mimeType || undefined,
        CacheControl: 'public, max-age=31536000, immutable',
        MetadataDirective: 'REPLACE',
        Metadata: buildS3ScanMetadata(state),
    }));
    await client.send(new DeleteObjectCommand({
        Bucket: AWS_S3_REVIEW_BUCKET,
        Key: sourceKey,
    }));

    return {
        storageDriver: 's3',
        storageKey,
        quarantineKey,
        scanStatus: REVIEW_MEDIA_SCAN_STATES.CLEAN,
        url: buildPublicUrl('s3', storageKey),
    };
};

const ensureReviewUploadStorageReady = async () => {
    if (getStorageDriver() === 's3') {
        await ensureS3StorageReady();
        return;
    }
    await ensureLocalStorageReady();
};

const getReviewUploadStorageHealth = async () => {
    const storageDriver = getStorageDriver();
    try {
        await ensureReviewUploadStorageReady();
        return {
            ok: true,
            status: 'ok',
            driver: storageDriver,
        };
    } catch (error) {
        return {
            ok: false,
            status: 'degraded',
            driver: storageDriver,
            errorMessage: error?.message || 'upload_storage_unavailable',
        };
    }
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

const quarantineReviewMedia = async ({ fileBuffer, fileName, mimeType }) => {
    const normalizedMimeType = String(mimeType || '').trim().toLowerCase();
    const normalizedFileName = sanitizeObjectKeySegment(fileName || 'review-media');
    const storedFileName = buildStoredFileName(normalizedFileName, normalizedMimeType);

    if (getStorageDriver() === 's3') {
        return quarantineReviewMediaInS3({
            fileBuffer,
            fileName: storedFileName,
            mimeType: normalizedMimeType,
        });
    }

    return quarantineReviewMediaLocally({
        fileBuffer,
        fileName: storedFileName,
        mimeType: normalizedMimeType,
    });
};

const markReviewMediaScanState = async (options = {}) => {
    const scanStatus = normalizeScanState(options.scanStatus);
    if (getStorageDriver() === 's3') {
        return markReviewMediaScanStateInS3({
            ...options,
            scanStatus,
        });
    }

    return markReviewMediaScanStateLocally({
        ...options,
        scanStatus,
    });
};

const promoteReviewMediaFromQuarantine = async (options = {}) => {
    if (getStorageDriver() === 's3') {
        return promoteReviewMediaFromS3Quarantine(options);
    }

    return promoteReviewMediaFromLocalQuarantine(options);
};

const buildBlockedReviewMediaError = () => {
    const blockedError = new Error('Upload not found');
    blockedError.code = 404;
    return blockedError;
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
            const scanStatus = normalizeScanState(downloadResponse.Metadata?.['scan-status'] || '');
            if (scanStatus !== REVIEW_MEDIA_SCAN_STATES.CLEAN) {
                throw buildBlockedReviewMediaError();
            }
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

    const scanState = await readLocalScanState(safeStorageKey);
    if (scanState?.scanStatus && normalizeScanState(scanState.scanStatus) !== REVIEW_MEDIA_SCAN_STATES.CLEAN) {
        throw buildBlockedReviewMediaError();
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
    REVIEW_MEDIA_SCAN_STATES,
    buildReviewMediaStorageKey,
    ensureReviewUploadStorageReady,
    getStorageDriver,
    getReviewUploadStorageHealth,
    getReviewMediaObject,
    markReviewMediaScanState,
    promoteReviewMediaFromQuarantine,
    quarantineReviewMedia,
    storeReviewMedia,
};
