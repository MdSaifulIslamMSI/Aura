const path = require('path');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const { scanUploadBuffer } = require('./malwareScanService');
const {
    detectReviewMediaMime,
    isReviewMediaMimeCompatible,
} = require('../utils/reviewMediaMagicBytes');
const { recordUploadSecurityEvent } = require('./uploadSecurityTelemetryService');

const IMAGE_UPLOAD_ALLOWED_MIME = new Set([
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
]);

const IMAGE_UPLOAD_ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

const ASSISTANT_AUDIO_ALLOWED_MIME = new Set([
    'audio/mpeg',
    'audio/mp3',
    'audio/wav',
    'audio/x-wav',
    'audio/webm',
    'audio/ogg',
    'audio/mp4',
    'audio/m4a',
]);

const ASSISTANT_AUDIO_ALLOWED_EXTENSIONS = new Set([
    '.mp3',
    '.wav',
    '.webm',
    '.ogg',
    '.m4a',
    '.mp4',
]);

const normalizeMimeType = (value) => String(value || '').split(';', 1)[0].trim().toLowerCase();

const canonicalMimeType = (value) => {
    const normalized = normalizeMimeType(value);
    if (normalized === 'image/jpg') return 'image/jpeg';
    if (normalized === 'audio/mp3') return 'audio/mpeg';
    if (normalized === 'audio/x-wav') return 'audio/wav';
    if (normalized === 'audio/m4a') return 'audio/mp4';
    return normalized;
};

const normalizeExtension = (value) => String(path.extname(String(value || '')).toLowerCase() || '').trim();

const getDataUrlParts = (dataUrl = '') => {
    const match = String(dataUrl || '').match(/^data:([^;]+);base64,([\s\S]+)$/i);
    if (!match) return null;
    return {
        mimeType: normalizeMimeType(match[1]),
        base64: String(match[2] || '').replace(/\s+/g, ''),
    };
};

const isValidBase64 = (value = '') => {
    const normalized = String(value || '');
    return Boolean(
        normalized
        && normalized.length % 4 !== 1
        && /^[A-Za-z0-9+/]+={0,2}$/.test(normalized)
    );
};

const detectAudioMime = (buffer) => {
    if (!Buffer.isBuffer(buffer) || buffer.length < 4) return '';

    if (buffer.subarray(0, 3).toString('ascii') === 'ID3') {
        return 'audio/mpeg';
    }
    if (buffer[0] === 0xFF && (buffer[1] & 0xE0) === 0xE0) {
        return 'audio/mpeg';
    }
    if (
        buffer.length >= 12
        && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
        && buffer.subarray(8, 12).toString('ascii') === 'WAVE'
    ) {
        return 'audio/wav';
    }
    if (buffer.subarray(0, 4).toString('ascii') === 'OggS') {
        return 'audio/ogg';
    }

    return '';
};

const detectSupportedUploadMime = (buffer) => (
    detectReviewMediaMime(buffer)
    || detectAudioMime(buffer)
);

const areMimeTypesCompatible = (declaredMime, detectedMime) => {
    const declared = canonicalMimeType(declaredMime);
    const detected = canonicalMimeType(detectedMime);
    if (isReviewMediaMimeCompatible(declared, detected)) return true;
    if (!declared || !detected) return false;

    if (declared === detected) return true;
    if (declared === 'audio/webm' && detected === 'video/webm') return true;
    if (declared === 'audio/mp4' && detected === 'video/mp4') return true;
    return false;
};

const serializeScanEngines = (engines = []) => (
    Array.isArray(engines)
        ? engines.map((engine) => ({
            engine: engine.engine,
            signature: engine.signature || '',
            status: engine.status,
            detail: engine.detail || '',
        }))
        : []
);

const getEventReason = (eventName = '') => String(eventName || '').split('.').pop() || 'upload_event';

const rejectUpload = ({ message, statusCode = 400, eventName = '', eventLevel = 'warn', event = {} }) => {
    if (eventName) {
        const reason = getEventReason(eventName);
        recordUploadSecurityEvent({
            event: reason,
            outcome: statusCode >= 500 ? 'failure' : 'blocked',
            reason,
            purpose: event.purpose,
            level: eventLevel,
            meta: event,
        });
        const log = eventLevel === 'error' ? logger.error : logger.warn;
        log(eventName, event);
    }
    throw new AppError(message, statusCode);
};

const validateUploadBuffer = async ({
    fileBuffer,
    fileName = 'upload.bin',
    mimeType = '',
    allowedMimeTypes = IMAGE_UPLOAD_ALLOWED_MIME,
    allowedExtensions = IMAGE_UPLOAD_ALLOWED_EXTENSIONS,
    maxBytes,
    purpose,
    userId = '',
    eventPrefix = 'upload.security',
    allowMissingExtension = true,
    unsupportedMessage = 'Unsupported upload file type.',
    oversizedMessage = 'Uploaded file is too large.',
    emptyMessage = 'Uploaded file is empty.',
    mismatchMessage = 'Uploaded file content does not match declared media type.',
    infectedMessage = 'Uploaded file failed malware scan.',
    scanFailedMessage = 'Upload malware scan unavailable. Please try again later.',
} = {}) => {
    const normalizedMimeType = normalizeMimeType(mimeType);
    if (!allowedMimeTypes.has(normalizedMimeType)) {
        rejectUpload({
            message: unsupportedMessage,
            eventName: `${eventPrefix}.unsupported_mime`,
            event: {
                userId: String(userId || ''),
                purpose,
                mimeType: normalizedMimeType,
            },
        });
    }

    const extension = normalizeExtension(fileName);
    if (extension && allowedExtensions && !allowedExtensions.has(extension)) {
        rejectUpload({
            message: unsupportedMessage,
            eventName: `${eventPrefix}.unsupported_extension`,
            event: {
                userId: String(userId || ''),
                purpose,
                extension,
                mimeType: normalizedMimeType,
            },
        });
    }
    if (!extension && !allowMissingExtension) {
        rejectUpload({
            message: unsupportedMessage,
            eventName: `${eventPrefix}.missing_extension`,
            event: {
                userId: String(userId || ''),
                purpose,
                mimeType: normalizedMimeType,
            },
        });
    }

    if (!Buffer.isBuffer(fileBuffer) || fileBuffer.length === 0) {
        rejectUpload({
            message: emptyMessage,
            eventName: `${eventPrefix}.empty`,
            event: { userId: String(userId || ''), purpose, mimeType: normalizedMimeType },
        });
    }
    if (Number.isFinite(Number(maxBytes)) && fileBuffer.length > Number(maxBytes)) {
        rejectUpload({
            message: oversizedMessage,
            eventName: `${eventPrefix}.oversized`,
            event: {
                userId: String(userId || ''),
                purpose,
                mimeType: normalizedMimeType,
                bytes: fileBuffer.length,
                maxBytes: Number(maxBytes),
            },
        });
    }

    const detectedMimeType = detectSupportedUploadMime(fileBuffer);
    if (!areMimeTypesCompatible(normalizedMimeType, detectedMimeType)) {
        rejectUpload({
            message: mismatchMessage,
            eventName: `${eventPrefix}.magic_mismatch`,
            event: {
                userId: String(userId || ''),
                purpose,
                declaredMimeType: normalizedMimeType,
                detectedMimeType: detectedMimeType || 'unknown',
            },
        });
    }

    const scanResult = await scanUploadBuffer({
        fileBuffer,
        fileName,
        mimeType: normalizedMimeType,
        userId: String(userId || ''),
        purpose,
    });

    if (scanResult.status === 'infected') {
        rejectUpload({
            message: infectedMessage,
            eventName: `${eventPrefix}.malware_blocked`,
            event: {
                userId: String(userId || ''),
                purpose,
                mimeType: normalizedMimeType,
                engines: serializeScanEngines(scanResult.engines),
            },
        });
    }
    if (scanResult.status === 'error') {
        rejectUpload({
            message: scanFailedMessage,
            statusCode: 503,
            eventName: `${eventPrefix}.malware_scan_unavailable`,
            eventLevel: 'error',
            event: {
                userId: String(userId || ''),
                purpose,
                mimeType: normalizedMimeType,
                engines: serializeScanEngines(scanResult.engines),
            },
        });
    }

    return {
        fileBuffer,
        fileName,
        mimeType: normalizedMimeType,
        detectedMimeType,
        sizeBytes: fileBuffer.length,
        scanStatus: scanResult.status,
        scanResult,
    };
};

const validateDataUriUpload = async ({
    dataUrl,
    fileName = 'upload.bin',
    declaredMimeType = '',
    allowedMimeTypes = IMAGE_UPLOAD_ALLOWED_MIME,
    allowedExtensions = IMAGE_UPLOAD_ALLOWED_EXTENSIONS,
    maxBytes,
    purpose,
    userId = '',
    eventPrefix = 'upload.security',
    allowMissingExtension = true,
    invalidFormatMessage = 'Invalid upload format. Must be a base64 data URI.',
    unsupportedMessage = 'Unsupported upload file type.',
    oversizedMessage = 'Uploaded file is too large.',
    emptyMessage = 'Uploaded file is empty.',
    mismatchMessage = 'Uploaded file content does not match declared media type.',
    infectedMessage = 'Uploaded file failed malware scan.',
    scanFailedMessage = 'Upload malware scan unavailable. Please try again later.',
} = {}) => {
    const parsedData = getDataUrlParts(dataUrl);
    if (!parsedData || !isValidBase64(parsedData.base64)) {
        rejectUpload({
            message: invalidFormatMessage,
            eventName: `${eventPrefix}.invalid_data_uri`,
            event: { userId: String(userId || ''), purpose },
        });
    }

    const parsedMimeType = normalizeMimeType(parsedData.mimeType);
    const providedMimeType = normalizeMimeType(declaredMimeType);
    if (providedMimeType && canonicalMimeType(providedMimeType) !== canonicalMimeType(parsedMimeType)) {
        rejectUpload({
            message: mismatchMessage,
            eventName: `${eventPrefix}.mime_mismatch`,
            event: {
                userId: String(userId || ''),
                purpose,
                declaredMimeType: providedMimeType,
                dataUrlMimeType: parsedMimeType,
            },
        });
    }

    if (!allowedMimeTypes.has(parsedMimeType)) {
        rejectUpload({
            message: unsupportedMessage,
            eventName: `${eventPrefix}.unsupported_mime`,
            event: {
                userId: String(userId || ''),
                purpose,
                mimeType: parsedMimeType,
            },
        });
    }

    const extension = normalizeExtension(fileName);
    if (extension && allowedExtensions && !allowedExtensions.has(extension)) {
        rejectUpload({
            message: unsupportedMessage,
            eventName: `${eventPrefix}.unsupported_extension`,
            event: {
                userId: String(userId || ''),
                purpose,
                extension,
                mimeType: parsedMimeType,
            },
        });
    }
    if (!extension && !allowMissingExtension) {
        rejectUpload({
            message: unsupportedMessage,
            eventName: `${eventPrefix}.missing_extension`,
            event: {
                userId: String(userId || ''),
                purpose,
                mimeType: parsedMimeType,
            },
        });
    }

    const fileBuffer = Buffer.from(parsedData.base64, 'base64');
    if (!fileBuffer || fileBuffer.length === 0) {
        rejectUpload({
            message: emptyMessage,
            eventName: `${eventPrefix}.empty`,
            event: { userId: String(userId || ''), purpose, mimeType: parsedMimeType },
        });
    }
    if (Number.isFinite(Number(maxBytes)) && fileBuffer.length > Number(maxBytes)) {
        rejectUpload({
            message: oversizedMessage,
            eventName: `${eventPrefix}.oversized`,
            event: {
                userId: String(userId || ''),
                purpose,
                mimeType: parsedMimeType,
                bytes: fileBuffer.length,
                maxBytes: Number(maxBytes),
            },
        });
    }

    const detectedMimeType = detectSupportedUploadMime(fileBuffer);
    if (!areMimeTypesCompatible(parsedMimeType, detectedMimeType)) {
        rejectUpload({
            message: mismatchMessage,
            eventName: `${eventPrefix}.magic_mismatch`,
            event: {
                userId: String(userId || ''),
                purpose,
                declaredMimeType: parsedMimeType,
                detectedMimeType: detectedMimeType || 'unknown',
            },
        });
    }

    const scanResult = await scanUploadBuffer({
        fileBuffer,
        fileName,
        mimeType: parsedMimeType,
        userId: String(userId || ''),
        purpose,
    });

    if (scanResult.status === 'infected') {
        rejectUpload({
            message: infectedMessage,
            eventName: `${eventPrefix}.malware_blocked`,
            event: {
                userId: String(userId || ''),
                purpose,
                mimeType: parsedMimeType,
                engines: serializeScanEngines(scanResult.engines),
            },
        });
    }
    if (scanResult.status === 'error') {
        rejectUpload({
            message: scanFailedMessage,
            statusCode: 503,
            eventName: `${eventPrefix}.malware_scan_unavailable`,
            eventLevel: 'error',
            event: {
                userId: String(userId || ''),
                purpose,
                mimeType: parsedMimeType,
                engines: serializeScanEngines(scanResult.engines),
            },
        });
    }

    return {
        dataUrl: `data:${parsedMimeType};base64,${parsedData.base64}`,
        fileBuffer,
        fileName,
        mimeType: parsedMimeType,
        detectedMimeType,
        sizeBytes: fileBuffer.length,
        scanStatus: scanResult.status,
        scanResult,
    };
};

const validateImageDataUriUpload = (options = {}) => validateDataUriUpload({
    allowedMimeTypes: IMAGE_UPLOAD_ALLOWED_MIME,
    allowedExtensions: IMAGE_UPLOAD_ALLOWED_EXTENSIONS,
    unsupportedMessage: 'Unsupported image type. Only JPEG, PNG, and WebP are allowed.',
    ...options,
});

const validateAssistantAudioDataUriUpload = (options = {}) => validateDataUriUpload({
    allowedMimeTypes: ASSISTANT_AUDIO_ALLOWED_MIME,
    allowedExtensions: ASSISTANT_AUDIO_ALLOWED_EXTENSIONS,
    unsupportedMessage: 'Unsupported audio type. Only MP3, WAV, WebM, OGG, M4A, and MP4 audio are allowed.',
    ...options,
});

module.exports = {
    ASSISTANT_AUDIO_ALLOWED_EXTENSIONS,
    ASSISTANT_AUDIO_ALLOWED_MIME,
    IMAGE_UPLOAD_ALLOWED_EXTENSIONS,
    IMAGE_UPLOAD_ALLOWED_MIME,
    areMimeTypesCompatible,
    canonicalMimeType,
    detectSupportedUploadMime,
    getDataUrlParts,
    normalizeMimeType,
    validateAssistantAudioDataUriUpload,
    validateDataUriUpload,
    validateImageDataUriUpload,
    validateUploadBuffer,
};
