jest.mock('../services/ai/commerceAssistantService', () => ({
    processAssistantTurn: jest.fn().mockResolvedValue({ answer: 'ok' }),
    streamAssistantTurn: jest.fn(),
}));

jest.mock('../services/ai/providerRegistry', () => ({
    createVoiceSessionConfig: jest.fn(),
    synthesizeSpeech: jest.fn(),
}));

jest.mock('../services/chatQuotaService', () => ({
    assertPrivateChatQuota: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../services/malwareScanService', () => ({
    scanUploadBuffer: jest.fn(),
}));

const { processAssistantTurn } = require('../services/ai/commerceAssistantService');
const { scanUploadBuffer } = require('../services/malwareScanService');
const { handleAiChat } = require('../controllers/aiController');

const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const mp3Base64 = Buffer.from('ID3\x04\x00\x00\x00\x00\x00\x21', 'binary').toString('base64');

describe('aiController assistant media validation', () => {
    const buildRes = () => ({
        json: jest.fn(),
        status: jest.fn().mockReturnThis(),
    });

    beforeEach(() => {
        scanUploadBuffer.mockResolvedValue({ status: 'skipped', engines: [] });
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    test('scans valid assistant image data URIs before provider work', async () => {
        const req = {
            body: {
                message: 'what is this?',
                images: [{
                    dataUrl: `data:image/png;base64,${pngBase64}`,
                    mimeType: 'image/png',
                    fileName: 'camera.png',
                }],
            },
            user: { _id: 'user-1' },
        };
        const res = buildRes();
        const next = jest.fn();

        await handleAiChat(req, res, next);

        expect(scanUploadBuffer).toHaveBeenCalledWith(expect.objectContaining({
            fileBuffer: expect.any(Buffer),
            fileName: 'camera.png',
            mimeType: 'image/png',
            userId: 'user-1',
            purpose: 'assistant-image',
        }));
        expect(processAssistantTurn).toHaveBeenCalledWith(expect.objectContaining({
            images: [expect.objectContaining({
                dataUrl: `data:image/png;base64,${pngBase64}`,
                mimeType: 'image/png',
            })],
        }));
        expect(res.json).toHaveBeenCalledWith({ answer: 'ok' });
        expect(next).not.toHaveBeenCalled();
    });

    test('rejects assistant image data URI magic-byte mismatch before provider work', async () => {
        const req = {
            body: {
                message: 'what is this?',
                images: [{
                    dataUrl: `data:image/jpeg;base64,${pngBase64}`,
                    mimeType: 'image/jpeg',
                    fileName: 'camera.jpg',
                }],
            },
            user: { _id: 'user-1' },
        };
        const res = buildRes();
        const next = jest.fn();

        await handleAiChat(req, res, next);

        expect(next).toHaveBeenCalledWith(expect.objectContaining({
            message: 'Assistant image content does not match declared image type',
            statusCode: 400,
        }));
        expect(scanUploadBuffer).not.toHaveBeenCalled();
        expect(processAssistantTurn).not.toHaveBeenCalled();
    });

    test('rejects assistant image data URIs when malware scan detects infection', async () => {
        scanUploadBuffer.mockResolvedValueOnce({
            status: 'infected',
            engines: [{ engine: 'builtin-eicar', status: 'infected', signature: 'EICAR-Test-Signature' }],
        });
        const req = {
            body: {
                message: 'what is this?',
                images: [{
                    dataUrl: `data:image/png;base64,${pngBase64}`,
                    mimeType: 'image/png',
                    fileName: 'camera.png',
                }],
            },
            user: { _id: 'user-1' },
        };
        const res = buildRes();
        const next = jest.fn();

        await handleAiChat(req, res, next);

        expect(next).toHaveBeenCalledWith(expect.objectContaining({
            message: 'Assistant image failed malware scan',
            statusCode: 400,
        }));
        expect(processAssistantTurn).not.toHaveBeenCalled();
    });

    test('rejects assistant audio data URIs when malware scanning is unavailable', async () => {
        scanUploadBuffer.mockResolvedValueOnce({
            status: 'error',
            engines: [{ engine: 'clamav', status: 'error', detail: 'connection refused' }],
        });
        const req = {
            body: {
                message: 'listen to this',
                audio: [{
                    dataUrl: `data:audio/mpeg;base64,${mp3Base64}`,
                    mimeType: 'audio/mpeg',
                    fileName: 'voice.mp3',
                }],
            },
            user: { _id: 'user-1' },
        };
        const res = buildRes();
        const next = jest.fn();

        await handleAiChat(req, res, next);

        expect(next).toHaveBeenCalledWith(expect.objectContaining({
            message: 'Assistant audio malware scan unavailable. Please try again later.',
            statusCode: 503,
        }));
        expect(processAssistantTurn).not.toHaveBeenCalled();
    });
});
