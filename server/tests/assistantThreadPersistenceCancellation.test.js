jest.mock('../models/AssistantActionAudit', () => ({
    insertMany: jest.fn(),
    deleteMany: jest.fn(),
}));

jest.mock('../models/AssistantProductSnapshot', () => ({
    insertMany: jest.fn(),
    deleteMany: jest.fn(),
}));

jest.mock('../models/AssistantThread', () => ({
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    updateOne: jest.fn(),
    deleteOne: jest.fn(),
}));

jest.mock('../models/AssistantThreadMessage', () => ({
    create: jest.fn(),
    deleteMany: jest.fn(),
}));

jest.mock('../utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
}));

const AssistantActionAudit = require('../models/AssistantActionAudit');
const AssistantProductSnapshot = require('../models/AssistantProductSnapshot');
const AssistantThread = require('../models/AssistantThread');
const AssistantThreadMessage = require('../models/AssistantThreadMessage');
const logger = require('../utils/logger');
const { persistAssistantExchange } = require('../services/ai/assistantThreadPersistenceService');

const createDeferred = () => {
    let resolve;
    const promise = new Promise((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
};

describe('assistantThreadPersistenceService cancellation', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('compensates every exchange write when cancellation lands during the final thread update', async () => {
        const abortController = new AbortController();
        const previousThread = {
            _id: 'thread-1',
            assistantMode: 'chat',
            originPath: '/cart',
            title: 'Earlier thread',
            preview: 'Earlier response',
            lastRoute: 'ECOMMERCE',
            lastProvider: 'rule',
            lastProviderModel: '',
            lastMessageAt: new Date('2026-07-16T10:00:00.000Z'),
            assistantSessionState: { lastIntent: 'product_search' },
            metadata: { retained: true },
            messageCount: 4,
        };

        AssistantThread.findOne.mockReturnValue({
            lean: jest.fn().mockResolvedValue(previousThread),
        });
        AssistantThread.findOneAndUpdate.mockResolvedValue({
            ...previousThread,
            preview: 'Timed-out response',
            messageCount: 4,
        });
        AssistantThreadMessage.create
            .mockResolvedValueOnce({ _id: 'message-user', role: 'user' })
            .mockResolvedValueOnce({ _id: 'message-assistant', role: 'assistant' });
        AssistantProductSnapshot.insertMany.mockResolvedValue([]);
        AssistantActionAudit.insertMany.mockResolvedValue([]);
        AssistantProductSnapshot.deleteMany.mockResolvedValue({ deletedCount: 1 });
        AssistantActionAudit.deleteMany.mockResolvedValue({ deletedCount: 1 });
        AssistantThreadMessage.deleteMany.mockResolvedValue({ deletedCount: 2 });
        AssistantThread.updateOne
            .mockImplementationOnce(async () => {
                abortController.abort(new Error('assistant_timeout'));
                return { modifiedCount: 1 };
            })
            .mockResolvedValue({ modifiedCount: 1 });
        AssistantThread.deleteOne.mockResolvedValue({ deletedCount: 0 });

        await expect(persistAssistantExchange({
            user: { _id: 'user-1' },
            sessionId: 'session-1',
            context: { route: '/assistant' },
            userMessage: 'show phones under 30000',
            responseText: 'Here are matching phones.',
            route: 'ECOMMERCE',
            provider: 'rule',
            retrievalProducts: [{ id: 101, score: 0.9 }],
            assistantTurn: {
                response: 'Here are matching phones.',
                actions: [{ type: 'select_product', productId: '101' }],
            },
            assistantSession: { lastIntent: 'product_search' },
            abortSignal: abortController.signal,
        })).rejects.toMatchObject({
            name: 'AssistantAbortError',
            code: 'ASSISTANT_REQUEST_ABORTED',
        });

        expect(AssistantProductSnapshot.deleteMany).toHaveBeenCalledWith({
            thread: 'thread-1',
            message: { $in: ['message-assistant'] },
        });
        expect(AssistantActionAudit.deleteMany).toHaveBeenCalledWith({
            thread: 'thread-1',
            message: { $in: ['message-assistant'] },
        });
        expect(AssistantThreadMessage.deleteMany).toHaveBeenCalledWith({
            thread: 'thread-1',
            _id: { $in: ['message-user', 'message-assistant'] },
        });
        expect(AssistantThread.updateOne).toHaveBeenNthCalledWith(2, {
            _id: 'thread-1',
            messageCount: { $gte: 2 },
        }, {
            $inc: { messageCount: -2 },
            $pull: {
                'metadata.activePersistenceExchangeIds': expect.any(String),
            },
        });

        const [restoreFilter, restoreUpdate] = AssistantThread.updateOne.mock.calls[2];
        expect(restoreFilter).toMatchObject({
            _id: 'thread-1',
            'metadata.lastPersistenceExchangeId': expect.any(String),
            'metadata.activePersistenceExchangeIds': { $size: 0 },
            lastMessageAt: expect.any(Date),
        });
        expect(restoreUpdate.$set).toMatchObject({
            title: 'Earlier thread',
            preview: 'Earlier response',
            lastMessageAt: previousThread.lastMessageAt,
            assistantSessionState: previousThread.assistantSessionState,
            metadata: previousThread.metadata,
        });
        expect(AssistantThread.deleteOne).not.toHaveBeenCalled();
        expect(logger.error).not.toHaveBeenCalled();
    });

    test('does not delete a newly-created thread while another first exchange is still writing it', async () => {
        const abortController = new AbortController();
        const finalUpdateStarted = createDeferred();
        const releaseFinalUpdate = createDeferred();
        const state = {
            exists: true,
            activeExchangeIds: new Set(),
            creationExchangeId: '',
            lastExchangeId: '',
            messageCount: 0,
            messages: [],
        };
        let upsertCount = 0;

        AssistantThread.findOne.mockImplementation(() => ({
            lean: jest.fn().mockResolvedValue(null),
        }));
        AssistantThread.findOneAndUpdate.mockImplementation(async (_filter, update) => {
            upsertCount += 1;
            const exchangeId = update?.$addToSet?.['metadata.activePersistenceExchangeIds'];
            state.activeExchangeIds.add(exchangeId);
            state.creationExchangeId ||= update?.$setOnInsert?.['metadata.creationPersistenceExchangeId'];
            state.lastExchangeId = update?.$set?.['metadata.lastPersistenceExchangeId'];
            if (upsertCount === 2) {
                abortController.abort(new Error('assistant_timeout'));
            }
            return {
                _id: 'thread-new',
                messageCount: state.messageCount,
            };
        });
        AssistantThreadMessage.create.mockImplementation(async (payload) => {
            const message = {
                _id: `message-${state.messages.length + 1}`,
                role: payload.role,
            };
            state.messages.push(message);
            return message;
        });
        AssistantThreadMessage.deleteMany.mockResolvedValue({ deletedCount: 0 });
        AssistantThread.updateOne.mockImplementation(async (_filter, update) => {
            const activeExchangeId = update?.$pull?.['metadata.activePersistenceExchangeIds'];
            if (Number(update?.$inc?.messageCount || 0) > 0) {
                finalUpdateStarted.resolve();
                await releaseFinalUpdate.promise;
                state.messageCount += Number(update.$inc.messageCount);
                state.lastExchangeId = update?.$set?.['metadata.lastPersistenceExchangeId'] || state.lastExchangeId;
            } else if (Number(update?.$inc?.messageCount || 0) < 0) {
                state.messageCount += Number(update.$inc.messageCount);
            }
            if (activeExchangeId) {
                state.activeExchangeIds.delete(activeExchangeId);
            }
            return { modifiedCount: 1 };
        });
        AssistantThread.deleteOne.mockImplementation(async (filter) => {
            const canDelete = state.exists
                && filter?.['metadata.creationPersistenceExchangeId'] === state.creationExchangeId
                && filter?.['metadata.lastPersistenceExchangeId'] === state.lastExchangeId
                && filter?.['metadata.activePersistenceExchangeIds']?.$size === 0
                && state.activeExchangeIds.size === 0
                && state.messageCount <= Number(filter?.messageCount?.$lte || 0);
            if (canDelete) state.exists = false;
            return { deletedCount: canDelete ? 1 : 0 };
        });

        const successfulExchange = persistAssistantExchange({
            user: { _id: 'user-1' },
            sessionId: 'shared-session',
            userMessage: 'first successful message',
            responseText: 'successful response',
            assistantTurn: { response: 'successful response', actions: [] },
        });
        await finalUpdateStarted.promise;

        await expect(persistAssistantExchange({
            user: { _id: 'user-1' },
            sessionId: 'shared-session',
            userMessage: 'aborted concurrent message',
            responseText: 'aborted response',
            assistantTurn: { response: 'aborted response', actions: [] },
            abortSignal: abortController.signal,
        })).rejects.toMatchObject({
            code: 'ASSISTANT_REQUEST_ABORTED',
        });

        expect(state.exists).toBe(true);
        expect(state.activeExchangeIds.size).toBe(1);
        expect(AssistantThread.deleteOne).toHaveBeenCalledWith(expect.objectContaining({
            'metadata.creationPersistenceExchangeId': expect.any(String),
            'metadata.activePersistenceExchangeIds': { $size: 0 },
        }));

        releaseFinalUpdate.resolve();
        await expect(successfulExchange).resolves.toMatchObject({ thread: { _id: 'thread-new' } });
        expect(state.exists).toBe(true);
        expect(state.messageCount).toBe(2);
        expect(state.messages).toHaveLength(2);
        expect(state.activeExchangeIds.size).toBe(0);
        expect(logger.error).not.toHaveBeenCalled();
    });
});
