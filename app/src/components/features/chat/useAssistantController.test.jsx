import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '@/context/AuthContext';
import { WishlistContext } from '@/context/WishlistContext';
import { productApi } from '@/services/api';
import { resetChatStoreForTests, useChatStore } from '@/store/chatStore';
import {
    resetCommerceStoreForTests,
    selectCartSummary,
    useCommerceStore,
} from '@/store/commerceStore';

const mocks = vi.hoisted(() => ({
    streamMessage: vi.fn(),
    sendMessage: vi.fn(),
}));

vi.mock('@/services/chatApi', () => ({
    chatApi: {
        streamMessage: mocks.streamMessage,
        sendMessage: mocks.sendMessage,
    },
}));

vi.mock('@/context/SocketContext', () => ({
    useSocket: () => ({ socket: null }),
}));

import { useAssistantController } from './useAssistantController';

const createDeferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, reject, resolve };
};

const wrapper = ({ children }) => (
    <IntlProvider locale="en" messages={{}}>
        <MemoryRouter initialEntries={['/assistant?from=%2Fproducts']}>
            <AuthContext.Provider value={{ isAuthenticated: false }}>
                <WishlistContext.Provider value={{ wishlistItems: [] }}>
                    {children}
                </WishlistContext.Provider>
            </AuthContext.Provider>
        </MemoryRouter>
    </IntlProvider>
);

describe('useAssistantController request ownership', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        mocks.streamMessage.mockReset();
        mocks.sendMessage.mockReset();
        resetChatStoreForTests();
        resetCommerceStoreForTests();
    });

    it('does not execute or expose a late action after the user switches threads', async () => {
        const response = createDeferred();
        mocks.streamMessage.mockReturnValue(response.promise);
        const productLookup = vi.spyOn(productApi, 'getProductById');
        const { result } = renderHook(() => useAssistantController(), { wrapper });
        const initiatingSessionId = useChatStore.getState().activeSessionId;
        let requestPromise;

        act(() => {
            requestPromise = result.current.handleUserInput('add product 101 to cart');
        });
        await waitFor(() => expect(mocks.streamMessage).toHaveBeenCalledTimes(1));

        act(() => {
            useChatStore.getState().resetConversation();
        });
        const nextSessionId = useChatStore.getState().activeSessionId;
        expect(nextSessionId).not.toBe(initiatingSessionId);

        response.resolve({
            assistantTurn: {
                intent: 'cart_action',
                decision: 'act',
                response: 'Ready to add the product.',
                actionRequest: {
                    type: 'add_to_cart',
                    productId: '101',
                    quantity: 1,
                },
                actions: [{
                    type: 'add_to_cart',
                    productId: '101',
                    quantity: 1,
                }],
                ui: {
                    surface: 'confirmation_card',
                    confirmation: {
                        token: 'stale-confirmation',
                    },
                    navigation: {
                        page: 'cart',
                    },
                },
            },
        });

        await act(async () => {
            await requestPromise;
        });

        const state = useChatStore.getState();
        const initiatingMessages = state.sessionStateById[initiatingSessionId].messages;
        const lateMessage = initiatingMessages[initiatingMessages.length - 1];
        expect(lateMessage.text).toMatch(/changed assistant threads/i);
        expect(lateMessage.confirmation).toBeNull();
        expect(lateMessage.assistantTurn).toMatchObject({
            decision: 'respond',
            actionRequest: null,
            actions: [],
            ui: {
                surface: 'plain_answer',
                confirmation: null,
                navigation: null,
            },
        });
        expect(state.sessionStateById[nextSessionId].messages.some((message) => message.text === 'Ready to add the product.')).toBe(false);
        expect(productLookup).not.toHaveBeenCalled();
        expect(selectCartSummary(useCommerceStore.getState()).totalItems).toBe(0);
    });

    it('aborts and discards the active stream when the session is invalidated', async () => {
        const response = createDeferred();
        mocks.streamMessage.mockReturnValue(response.promise);
        const { result } = renderHook(() => useAssistantController(), { wrapper });
        const sessionId = useChatStore.getState().activeSessionId;
        let requestPromise;

        act(() => {
            requestPromise = result.current.handleUserInput('show my cart');
        });
        await waitFor(() => expect(mocks.streamMessage).toHaveBeenCalledTimes(1));
        const signal = mocks.streamMessage.mock.calls[0][0].signal;
        expect(signal).toBeInstanceOf(AbortSignal);
        expect(signal.aborted).toBe(false);

        act(() => {
            result.current.invalidateSessionRequest(sessionId);
        });
        expect(signal.aborted).toBe(true);
        response.reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));

        await act(async () => {
            await requestPromise;
        });

        const sessionState = useChatStore.getState().sessionStateById[sessionId];
        expect(sessionState.status).toBe('idle');
        expect(sessionState.isLoading).toBe(false);
        expect(sessionState.messages.some((message) => message.isStreaming)).toBe(false);
        expect(sessionState.messages.some((message) => /live assistant is unavailable/i.test(message.text))).toBe(false);
    });
});
