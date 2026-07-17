import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    chat: vi.fn(),
    chatStream: vi.fn(),
}));

vi.mock('./aiApi', () => ({
    aiApi: {
        chat: mocks.chat,
        chatStream: mocks.chatStream,
    },
}));

import { chatApi } from './chatApi';

const finalTurn = {
    assistantTurn: {
        intent: 'general_knowledge',
        decision: 'respond',
        response: 'Done.',
        ui: {
            surface: 'plain_answer',
        },
        actions: [],
        followUps: [],
    },
};

describe('chatApi cancellation contract', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('forwards an AbortSignal out of band instead of serializing it into stream payloads', async () => {
        const controller = new AbortController();
        mocks.chatStream.mockImplementation(async (payload, onEvent) => {
            onEvent('final_turn', finalTurn);
        });

        await chatApi.streamMessage({
            message: 'hello',
            context: { clientSessionId: 'session-1' },
            signal: controller.signal,
        });

        const [payload, _onEvent, options] = mocks.chatStream.mock.calls[0];
        expect(payload).not.toHaveProperty('signal');
        expect(options).toEqual({ signal: controller.signal });
    });

    it('forwards an AbortSignal out of band for non-streaming turns', async () => {
        const controller = new AbortController();
        mocks.chat.mockResolvedValue(finalTurn);

        await chatApi.sendMessage({
            message: 'hello',
            signal: controller.signal,
        });

        const [payload, options] = mocks.chat.mock.calls[0];
        expect(payload).not.toHaveProperty('signal');
        expect(options).toEqual({ signal: controller.signal });
    });
});
