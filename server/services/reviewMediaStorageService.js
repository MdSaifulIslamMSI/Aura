const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { BlobServiceClient } = require('@azure/storage-blob');

const REVIEW_UPLOAD_DIR = path.resolve(
    process.env.REVIEW_UPLOAD_DIR
    || path.join(__dirname, '..', 'uploads', 'reviews')
);
const AZURE_STORAGE_CONTAINER_NAME = String(
    process.env.AZURE_STORAGE_CONTAINER_NAME
    || 'review-media'
).trim();
const AZURE_STORAGE_CONNECTION_STRING = String(
    process.env.AZURE_STORAGE_CONNECTION_STRING
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
const EXTENSION_MIME_MAP = Object.fromEntries(
    Object.entries(MIME_EXTENSION_MAP).map(([mimeType, extension]) => [extension, mimeType])
);

let blobContainerClientPromise = null;

const getStorageDriver = () => {
    const normalized = String(process.env.UPLOAD_STORAGE_DRIVER || 'local').trim().toLowerCase();
    return normalized === 'azure-blob' ? 'azure-blob' : 'local';
};

const ensureLocalStorageReady = async () => {
    await fs.promises.mkdir(REVIEW_UPLOAD_DIR, { recursive: true });
};

const getAzureBlobContainerClient = async () => {
    if (blobContainerClientPromise) {
        return blobContainerClientPromise;
    }

    if (!AZURE_STORAGE_CONNECTION_STRING) {
        throw new Error('AZURE_STORAGE_CONNECTION_STRING is required when UPLOAD_STORAGE_DRIVER=azure-blob');
    }

    blobContainerClientPromise = Promise.resolve().then(async () => {
        const blobServiceClient = BlobServiceClient.fromConnectionString(AZURE_STORAGE_CONNECTION_STRING);
        return blobServiceClient.getContainerClient(AZURE_STORAGE_CONTAINER_NAME);
    }).catch((error) => {
        blobContainerClientPromise = null;
        throw error;
    });

    return blobContainerClientPromise;
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
    if (!['local', 'azure-blob'].includes(storageDriver)) {
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

const ensureAzureBlobStorageReady = async () => {
    const containerClient = await getAzureBlobContainerClient();
    await containerClient.createIfNotExists({
        access: undefined,
    });
};

const storeReviewMediaInAzureBlob = async ({ fileBuffer, fileName, mimeType }) => {
    await ensureAzureBlobStorageReady();
    const containerClient = await getAzureBlobContainerClient();
    const blobClient = containerClient.getBlockBlobClient(fileName);
    await blobClient.uploadData(fileBuffer, {
        blobHTTPHeaders: {
            blobContentType: mimeType || undefined,
            blobCacheControl: 'public, max-age=31536000, immutable',
        },
    });

    return {
        storageDriver: 'azure-blob',
        storageKey: fileName,
        url: buildPublicUrl('azure-blob', fileName),
    };
};

const ensureReviewUploadStorageReady = async () => {
    if (getStorageDriver() === 'azure-blob') {
        await ensureAzureBlobStorageReady();
        return;
    }
    await ensureLocalStorageReady();
};

const storeReviewMedia = async ({ fileBuffer, fileName, mimeType }) => {
    const normalizedMimeType = String(mimeType || '').trim().toLowerCase();
    const normalizedFileName = sanitizeObjectKeySegment(fileName || 'review-media');
    const storedFileName = buildStoredFileName(normalizedFileName, normalizedMimeType);

    if (getStorageDriver() === 'azure-blob') {
        return storeReviewMediaInAzureBlob({
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

    if (getStorageDriver() === 'azure-blob') {
        const containerClient = await getAzureBlobContainerClient();
        const blobClient = containerClient.getBlobClient(path.basename(safeStorageKey));
        try {
            const downloadResponse = await blobClient.download();
            return {
                body: downloadResponse.readableStreamBody,
                contentType: downloadResponse.contentType || '',
                cacheControl: downloadResponse.cacheControl || 'public, max-age=31536000, immutable',
                contentLength: Number(downloadResponse.contentLength || 0),
                etag: String(downloadResponse.etag || ''),
                lastModified: downloadResponse.lastModified || null,
            };
        } catch (error) {
            if (Number(error?.statusCode || 0) === 404) {
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
