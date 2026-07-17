import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getIdToken: vi.fn(),
    requestWithTrace: vi.fn(),
    createResponseError: vi.fn(),
    parseJsonSafely: vi.fn(),
}));

vi.mock('../config/firebase', () => ({
    auth: {
        currentUser: {
            getIdToken: mocks.getIdToken,
        },
    },
    isFirebaseReady: true,
}));

vi.mock('./apiBase', () => ({
    API_BASE_URL: 'https://api.example.test',
    buildApiUrl: (path) => `https://api.example.test${path}`,
    createResponseError: mocks.createResponseError,
    parseJsonSafely: mocks.parseJsonSafely,
    requestWithTrace: mocks.requestWithTrace,
}));

import { aiApi } from './aiApi';

describe('aiApi authenticated retry behavior', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getIdToken.mockResolvedValue('initial-token');
        mocks.createResponseError.mockResolvedValue(new Error('request failed'));
        mocks.parseJsonSafely.mockResolvedValue({ ok: true });
    });

    it('does not retry an authenticated 403 anonymously', async () => {
        mocks.requestWithTrace.mockResolvedValue({ ok: false, status: 403 });

        await expect(aiApi.chat({ message: 'hello' })).rejects.toThrow('request failed');

        expect(mocks.requestWithTrace).toHaveBeenCalledTimes(1);
        expect(mocks.requestWithTrace.mock.calls[0][1].headers.Authorization).toBe('Bearer initial-token');
        expect(mocks.getIdToken).toHaveBeenCalledTimes(1);
        expect(mocks.getIdToken).toHaveBeenCalledWith(false);
    });

    it('does not downgrade an authenticated stream after a 403', async () => {
        mocks.requestWithTrace.mockResolvedValue({ ok: false, status: 403 });

        await expect(aiApi.chatStream({ message: 'hello' }, vi.fn())).rejects.toThrow('request failed');

        expect(mocks.requestWithTrace).toHaveBeenCalledTimes(1);
        expect(mocks.requestWithTrace.mock.calls[0][1].headers.Authorization).toBe('Bearer initial-token');
    });

    it('refreshes authentication once after a 401 and keeps the retry authenticated', async () => {
        mocks.getIdToken
            .mockResolvedValueOnce('initial-token')
            .mockResolvedValueOnce('refreshed-token');
        mocks.requestWithTrace
            .mockResolvedValueOnce({ ok: false, status: 401 })
            .mockResolvedValueOnce({ ok: true, status: 200 });

        await expect(aiApi.chat({ message: 'hello' })).resolves.toEqual({ ok: true });

        expect(mocks.getIdToken).toHaveBeenNthCalledWith(1, false);
        expect(mocks.getIdToken).toHaveBeenNthCalledWith(2, true);
        expect(mocks.requestWithTrace).toHaveBeenCalledTimes(2);
        expect(mocks.requestWithTrace.mock.calls[1][1].headers.Authorization).toBe('Bearer refreshed-token');
    });

    it('parses CRLF, multi-line data, and a final SSE frame without a trailing delimiter', async () => {
        const encoder = new TextEncoder();
        const chunks = [
            'event: token\r\ndata: {"text":"hello"}\r\n\r\n',
            'event: final_turn\ndata: {"assistantTurn":\ndata: {"decision":"respond"}}',
        ].map((chunk) => encoder.encode(chunk));
        let chunkIndex = 0;
        mocks.requestWithTrace.mockResolvedValue({
            ok: true,
            status: 200,
            body: {
                getReader: () => ({
                    read: vi.fn(async () => (
                        chunkIndex < chunks.length
                            ? { done: false, value: chunks[chunkIndex++] }
                            : { done: true, value: undefined }
                    )),
                }),
            },
        });
        const onEvent = vi.fn();

        await aiApi.chatStream({ message: 'hello' }, onEvent);

        expect(onEvent).toHaveBeenNthCalledWith(1, 'token', { text: 'hello' });
        expect(onEvent).toHaveBeenNthCalledWith(2, 'final_turn', {
            assistantTurn: { decision: 'respond' },
        });
    });

    it('passes stream cancellation to the network request', async () => {
        const controller = new AbortController();
        mocks.requestWithTrace.mockResolvedValue({
            ok: true,
            status: 200,
            body: {
                getReader: () => ({
                    read: vi.fn().mockResolvedValue({ done: true, value: undefined }),
                }),
            },
        });

        await aiApi.chatStream({ message: 'hello' }, vi.fn(), {
            signal: controller.signal,
        });

        expect(mocks.requestWithTrace.mock.calls[0][1].signal).toBe(controller.signal);
    });
});
