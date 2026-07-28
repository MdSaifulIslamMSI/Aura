const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
    CopyObjectCommand,
    DeleteObjectCommand,
    GetObjectCommand,
    HeadBucketCommand,
    ListObjectsV2Command,
    PutObjectCommand,
    S3Client,
} = require('@aws-sdk/client-s3');

const DEFAULT_QUARANTINE_TTL_MS = 24 * 60 * 60 * 1000;
let s3Client = null;
let s3BucketReadyPromise = null;

const getStorageDriver = () => (
    String(process.env.UPLOAD_STORAGE_DRIVER || 'local').trim().toLowerCase() === 's3'
        ? 's3'
        : 'local'
);
const getAvatarUploadDir = () => path.resolve(
    process.env.AVATAR_UPLOAD_DIR
    || path.join(__dirname, '..', 'uploads', 'avatars')
);
const getQuarantineDir = () => path.join(getAvatarUploadDir(), '.quarantine');
const getS3Bucket = () => String(
    process.env.AWS_S3_AVATAR_BUCKET
    || process.env.AWS_S3_REVIEW_BUCKET
    || ''
).trim();
const getS3Prefix = () => String(
    process.env.AWS_S3_AVATAR_PREFIX
    || 'avatar-media'
).trim().replace(/^\/+|\/+$/g, '');
const getAwsRegion = () => String(
    process.env.AWS_REGION
    || process.env.AWS_DEFAULT_REGION
    || ''
).trim();

const getS3Client = () => {
    if (s3Client) return s3Client;
    const region = getAwsRegion();
    if (!region) throw new Error('AWS_REGION is required when UPLOAD_STORAGE_DRIVER=s3');
    const options = { region };
    const endpoint = String(process.env.AWS_S3_ENDPOINT || '').trim();
    if (endpoint) options.endpoint = endpoint;
    if (['1', 'true', 'yes', 'on'].includes(String(process.env.AWS_S3_FORCE_PATH_STYLE || '').trim().toLowerCase())) {
        options.forcePathStyle = true;
    }
    s3Client = new S3Client(options);
    return s3Client;
};

const ensureS3Ready = async () => {
    if (s3BucketReadyPromise) return s3BucketReadyPromise;
    const bucket = getS3Bucket();
    if (!bucket) throw new Error('AWS_S3_AVATAR_BUCKET is required when UPLOAD_STORAGE_DRIVER=s3');
    s3BucketReadyPromise = getS3Client().send(new HeadBucketCommand({ Bucket: bucket }))
        .catch((error) => {
            s3BucketReadyPromise = null;
            throw error;
        });
    return s3BucketReadyPromise;
};

const ensureLocalReady = async () => {
    await Promise.all([
        fs.promises.mkdir(getAvatarUploadDir(), { recursive: true }),
        fs.promises.mkdir(getQuarantineDir(), { recursive: true }),
    ]);
};

const safeStorageKey = (value) => {
    const key = path.basename(String(value || '').trim());
    return /^[A-Za-z0-9_-]+\.webp$/.test(key) ? key : '';
};
const buildStorageKey = () => `${Date.now()}-${crypto.randomBytes(12).toString('hex')}.webp`;
const buildFinalS3Key = (storageKey) => `${getS3Prefix()}/${safeStorageKey(storageKey)}`;
const buildQuarantineS3Key = (storageKey) => `${getS3Prefix()}/quarantine/${safeStorageKey(storageKey)}`;
const encodeCopySource = (bucket, key) => `${bucket}/${String(key).split('/').map(encodeURIComponent).join('/')}`;
const buildPublicUrl = (storageKey) => `/uploads/avatars/${encodeURIComponent(safeStorageKey(storageKey))}`;

const bodyToBuffer = async (body) => {
    if (Buffer.isBuffer(body)) return body;
    if (typeof body?.transformToByteArray === 'function') {
        return Buffer.from(await body.transformToByteArray());
    }
    if (body && typeof body[Symbol.asyncIterator] === 'function') {
        const chunks = [];
        for await (const chunk of body) chunks.push(Buffer.from(chunk));
        return Buffer.concat(chunks);
    }
    throw new Error('Unsupported avatar object body');
};

const quarantineAvatarMedia = async ({ fileBuffer, ownerId }) => {
    const storageKey = buildStorageKey();
    if (getStorageDriver() === 's3') {
        await ensureS3Ready();
        await getS3Client().send(new PutObjectCommand({
            Bucket: getS3Bucket(),
            Key: buildQuarantineS3Key(storageKey),
            Body: fileBuffer,
            ContentType: 'image/webp',
            Metadata: {
                'scan-status': 'clean',
                'owner-hash': crypto.createHash('sha256').update(String(ownerId || '')).digest('hex').slice(0, 24),
            },
        }));
    } else {
        await ensureLocalReady();
        await fs.promises.writeFile(path.join(getQuarantineDir(), storageKey), fileBuffer, { mode: 0o600 });
    }
    return { storageKey, storageDriver: getStorageDriver() };
};

const getQuarantinedAvatarMedia = async ({ storageKey }) => {
    const key = safeStorageKey(storageKey);
    if (!key) throw new Error('Avatar upload not found');
    if (getStorageDriver() === 's3') {
        await ensureS3Ready();
        const response = await getS3Client().send(new GetObjectCommand({
            Bucket: getS3Bucket(),
            Key: buildQuarantineS3Key(key),
        }));
        return bodyToBuffer(response.Body);
    }
    return fs.promises.readFile(path.join(getQuarantineDir(), key));
};

const promoteAvatarMedia = async ({ storageKey }) => {
    const key = safeStorageKey(storageKey);
    if (!key) throw new Error('Avatar upload not found');
    if (getStorageDriver() === 's3') {
        await ensureS3Ready();
        const bucket = getS3Bucket();
        const sourceKey = buildQuarantineS3Key(key);
        await getS3Client().send(new CopyObjectCommand({
            Bucket: bucket,
            Key: buildFinalS3Key(key),
            CopySource: encodeCopySource(bucket, sourceKey),
            ContentType: 'image/webp',
            CacheControl: 'public, max-age=31536000, immutable',
            MetadataDirective: 'REPLACE',
            Metadata: { 'scan-status': 'clean' },
        }));
        await getS3Client().send(new DeleteObjectCommand({ Bucket: bucket, Key: sourceKey }));
    } else {
        await ensureLocalReady();
        await fs.promises.rename(
            path.join(getQuarantineDir(), key),
            path.join(getAvatarUploadDir(), key)
        );
    }
    return {
        storageKey: key,
        storageDriver: getStorageDriver(),
        url: buildPublicUrl(key),
    };
};

const deleteAvatarMedia = async ({ storageKey, quarantine = false }) => {
    const key = safeStorageKey(storageKey);
    if (!key) return false;
    if (getStorageDriver() === 's3') {
        await ensureS3Ready();
        await getS3Client().send(new DeleteObjectCommand({
            Bucket: getS3Bucket(),
            Key: quarantine ? buildQuarantineS3Key(key) : buildFinalS3Key(key),
        }));
        return true;
    }
    const target = path.join(quarantine ? getQuarantineDir() : getAvatarUploadDir(), key);
    try {
        await fs.promises.unlink(target);
        return true;
    } catch (error) {
        if (error?.code === 'ENOENT') return false;
        throw error;
    }
};

const getAvatarMediaObject = async ({ storageKey }) => {
    const key = safeStorageKey(storageKey);
    if (!key) throw Object.assign(new Error('Avatar not found'), { code: 404 });
    if (getStorageDriver() === 's3') {
        await ensureS3Ready();
        const response = await getS3Client().send(new GetObjectCommand({
            Bucket: getS3Bucket(),
            Key: buildFinalS3Key(key),
        }));
        return {
            body: response.Body,
            contentType: response.ContentType || 'image/webp',
            contentLength: Number(response.ContentLength || 0),
            cacheControl: response.CacheControl || 'public, max-age=31536000, immutable',
            etag: String(response.ETag || ''),
            lastModified: response.LastModified || null,
        };
    }
    const target = path.join(getAvatarUploadDir(), key);
    try {
        const stats = await fs.promises.stat(target);
        return {
            body: fs.createReadStream(target),
            contentType: 'image/webp',
            contentLength: stats.size,
            cacheControl: 'public, max-age=31536000, immutable',
            etag: '',
            lastModified: stats.mtime,
        };
    } catch (error) {
        if (error?.code === 'ENOENT') error.code = 404;
        throw error;
    }
};

const cleanupStaleAvatarQuarantine = async ({
    olderThanMs = DEFAULT_QUARANTINE_TTL_MS,
    dryRun = false,
} = {}) => {
    const cutoff = Date.now() - Math.max(60_000, Number(olderThanMs) || DEFAULT_QUARANTINE_TTL_MS);
    let removed = 0;
    if (getStorageDriver() === 's3') {
        await ensureS3Ready();
        const bucket = getS3Bucket();
        const prefix = `${getS3Prefix()}/quarantine/`;
        let continuationToken;
        do {
            const page = await getS3Client().send(new ListObjectsV2Command({
                Bucket: bucket,
                Prefix: prefix,
                ContinuationToken: continuationToken,
            }));
            for (const object of page.Contents || []) {
                if (new Date(object.LastModified || 0).getTime() >= cutoff) continue;
                if (!dryRun) {
                    await getS3Client().send(new DeleteObjectCommand({ Bucket: bucket, Key: object.Key }));
                }
                removed += 1;
            }
            continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
        } while (continuationToken);
        return { removed };
    }

    await ensureLocalReady();
    for (const entry of await fs.promises.readdir(getQuarantineDir(), { withFileTypes: true })) {
        if (!entry.isFile() || !safeStorageKey(entry.name)) continue;
        const target = path.join(getQuarantineDir(), entry.name);
        const stats = await fs.promises.stat(target);
        if (stats.mtimeMs >= cutoff) continue;
        if (!dryRun) await fs.promises.unlink(target);
        removed += 1;
    }
    return { removed };
};

const cleanupOrphanedAvatarMedia = async ({
    referencedKeys = [],
    olderThanMs = 7 * 24 * 60 * 60 * 1000,
    dryRun = false,
} = {}) => {
    const referenced = new Set(
        Array.from(referencedKeys || []).map(safeStorageKey).filter(Boolean)
    );
    const cutoff = Date.now() - Math.max(60_000, Number(olderThanMs) || 0);
    let removed = 0;
    if (getStorageDriver() === 's3') {
        await ensureS3Ready();
        const bucket = getS3Bucket();
        const prefix = `${getS3Prefix()}/`;
        const quarantinePrefix = `${prefix}quarantine/`;
        let continuationToken;
        do {
            const page = await getS3Client().send(new ListObjectsV2Command({
                Bucket: bucket,
                Prefix: prefix,
                ContinuationToken: continuationToken,
            }));
            for (const object of page.Contents || []) {
                if (String(object.Key || '').startsWith(quarantinePrefix)) continue;
                const key = safeStorageKey(object.Key);
                if (!key || referenced.has(key)) continue;
                if (new Date(object.LastModified || 0).getTime() >= cutoff) continue;
                if (!dryRun) {
                    await getS3Client().send(new DeleteObjectCommand({ Bucket: bucket, Key: object.Key }));
                }
                removed += 1;
            }
            continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
        } while (continuationToken);
        return { removed };
    }

    await ensureLocalReady();
    for (const entry of await fs.promises.readdir(getAvatarUploadDir(), { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        const key = safeStorageKey(entry.name);
        if (!key || referenced.has(key)) continue;
        const target = path.join(getAvatarUploadDir(), key);
        const stats = await fs.promises.stat(target);
        if (stats.mtimeMs >= cutoff) continue;
        if (!dryRun) await fs.promises.unlink(target);
        removed += 1;
    }
    return { removed };
};

module.exports = {
    buildPublicUrl,
    cleanupOrphanedAvatarMedia,
    cleanupStaleAvatarQuarantine,
    deleteAvatarMedia,
    getAvatarMediaObject,
    getQuarantinedAvatarMedia,
    getStorageDriver,
    promoteAvatarMedia,
    quarantineAvatarMedia,
    __private: {
        safeStorageKey,
        resetS3Client: () => {
            s3Client = null;
            s3BucketReadyPromise = null;
        },
    },
};
