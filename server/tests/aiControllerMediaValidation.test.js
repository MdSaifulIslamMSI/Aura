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

const { processAssistantTurn } = require('../services/ai/commerceAssistantService');
const { handleAiChat } = require('../controllers/aiController');

const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('aiController assistant media validation', () => {
    const buildRes = () => ({
        json: jest.fn(),
        status: jest.fn().mockReturnThis(),
    });

    afterEach(() => {
        jest.clearAllMocks();
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
        expect(processAssistantTurn).not.toHaveBeenCalled();
    });
});
