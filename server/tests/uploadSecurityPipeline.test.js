jest.mock('../services/malwareScanService', () => ({
    scanUploadBuffer: jest.fn(),
}));

const AppError = require('../utils/AppError');
const { EICAR_TEST_SIGNATURE } = jest.requireActual('../services/malwareScanService');
const { scanUploadBuffer } = require('../services/malwareScanService');
const {
    validateAssistantAudioDataUriUpload,
    validateImageDataUriUpload,
} = require('../services/uploadSecurityPipeline');

const pngBuffer = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64'
);

const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08]);
const mp3Buffer = Buffer.from('ID3\x04\x00\x00\x00\x00\x00\x21', 'binary');
const toDataUrl = (mimeType, buffer) => `data:${mimeType};base64,${buffer.toString('base64')}`;

describe('uploadSecurityPipeline', () => {
    beforeEach(() => {
        scanUploadBuffer.mockResolvedValue({ status: 'skipped', engines: [] });
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    test('allows a valid image data URI through MIME, magic-byte, and malware gates', async () => {
        await expect(validateImageDataUriUpload({
            dataUrl: toDataUrl('image/png', pngBuffer),
            fileName: 'avatar.png',
            maxBytes: 1024,
            purpose: 'avatar',
        })).resolves.toMatchObject({
            mimeType: 'image/png',
            detectedMimeType: 'image/png',
            sizeBytes: pngBuffer.length,
            scanStatus: 'skipped',
        });
    });

    test('rejects declared MIME mismatch against provided MIME metadata', async () => {
        await expect(validateImageDataUriUpload({
            dataUrl: toDataUrl('image/png', pngBuffer),
            declaredMimeType: 'image/jpeg',
            fileName: 'avatar.png',
            maxBytes: 1024,
            purpose: 'avatar',
        })).rejects.toMatchObject({
            message: 'Uploaded file content does not match declared media type.',
            statusCode: 400,
        });
        expect(scanUploadBuffer).not.toHaveBeenCalled();
    });

    test('rejects magic-byte mismatch before malware scan', async () => {
        await expect(validateImageDataUriUpload({
            dataUrl: toDataUrl('image/png', jpegBuffer),
            fileName: 'listing.png',
            maxBytes: 1024,
            purpose: 'marketplace-listing-image',
        })).rejects.toMatchObject({
            statusCode: 400,
        });
        expect(scanUploadBuffer).not.toHaveBeenCalled();
    });

    test('rejects oversized decoded file buffers', async () => {
        await expect(validateImageDataUriUpload({
            dataUrl: toDataUrl('image/png', pngBuffer),
            fileName: 'visual-search.png',
            maxBytes: pngBuffer.length - 1,
            purpose: 'visual-search-image',
        })).rejects.toMatchObject({
            statusCode: 400,
        });
        expect(scanUploadBuffer).not.toHaveBeenCalled();
    });

    test('rejects EICAR or other malware signatures after magic-byte validation', async () => {
        const infectedPng = Buffer.concat([pngBuffer, Buffer.from(EICAR_TEST_SIGNATURE)]);
        scanUploadBuffer.mockResolvedValueOnce({
            status: 'infected',
            engines: [{ engine: 'builtin-eicar', signature: 'EICAR-Test-Signature', status: 'infected' }],
        });

        await expect(validateImageDataUriUpload({
            dataUrl: toDataUrl('image/png', infectedPng),
            fileName: 'assistant.png',
            maxBytes: infectedPng.length + 10,
            purpose: 'assistant-image',
        })).rejects.toMatchObject({
            statusCode: 400,
        });
    });

    test('blocks scan_failed by default', async () => {
        scanUploadBuffer.mockResolvedValueOnce({
            status: 'error',
            engines: [{ engine: 'clamav', status: 'error', detail: 'clamav unavailable' }],
        });

        await expect(validateImageDataUriUpload({
            dataUrl: toDataUrl('image/png', pngBuffer),
            fileName: 'assistant.png',
            maxBytes: 1024,
            purpose: 'assistant-image',
        })).rejects.toMatchObject({
            statusCode: 503,
        });
    });

    test('allows supported assistant audio data URIs', async () => {
        await expect(validateAssistantAudioDataUriUpload({
            dataUrl: toDataUrl('audio/mpeg', mp3Buffer),
            fileName: 'voice.mp3',
            maxBytes: 1024,
            purpose: 'assistant-audio',
        })).resolves.toMatchObject({
            mimeType: 'audio/mpeg',
            detectedMimeType: 'audio/mpeg',
        });
    });

    test('rejects unsupported SVG images instead of scanning them', async () => {
        await expect(validateImageDataUriUpload({
            dataUrl: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
            fileName: 'avatar.svg',
            maxBytes: 1024,
            purpose: 'avatar',
        })).rejects.toBeInstanceOf(AppError);
        expect(scanUploadBuffer).not.toHaveBeenCalled();
    });
});
