import { beforeEach, describe, expect, it } from 'vitest';
import {
    filterChatSessions,
    groupChatSessionsByRecency,
    resetChatStoreForTests,
    useChatStore,
} from './chatStore';

describe('chatStore', () => {
    beforeEach(() => {
        localStorage.clear();
        resetChatStoreForTests();
    });

    it('starts with a welcome thread and session metadata', () => {
        const state = useChatStore.getState();

        expect(state.activeSessionId).toEqual(expect.any(String));
        expect(state.sessions).toHaveLength(1);
        expect(state.activeSession).toMatchObject({
            id: state.activeSessionId,
            title: 'New chat',
        });
        expect(state.messages).toHaveLength(1);
        expect(state.messages[0]).toMatchObject({
            role: 'assistant',
            mode: 'explore',
        });
    });

    it('creates and switches between independent sessions', () => {
        const firstSessionId = useChatStore.getState().activeSessionId;
        useChatStore.getState().appendUserMessage('show me camera phones');
        useChatStore.getState().createSession({ originPath: '/cart' });

        const secondSessionId = useChatStore.getState().activeSessionId;
        expect(secondSessionId).not.toBe(firstSessionId);
        expect(useChatStore.getState().context.route).toBe('/cart');

        useChatStore.getState().appendUserMessage('review my cart');
        expect(useChatStore.getState().activeSession.title).toBe('review my cart');

        useChatStore.getState().setActiveSession(firstSessionId);
        expect(useChatStore.getState().messages.some((message) => message.text === 'show me camera phones')).toBe(true);
        expect(useChatStore.getState().messages.some((message) => message.text === 'review my cart')).toBe(false);
    });

    it('resets into a fresh session while preserving route and cart context', () => {
        useChatStore.getState().hydrateContext({
            route: '/product/101',
            cartCount: 3,
            isAuthenticated: true,
        });
        const previousSessionId = useChatStore.getState().activeSessionId;

        useChatStore.getState().appendUserMessage('compare this with other options');
        useChatStore.getState().resetConversation();

        const state = useChatStore.getState();
        expect(state.activeSessionId).not.toBe(previousSessionId);
        expect(state.messages).toHaveLength(1);
        expect(state.context).toMatchObject({
            route: '/product/101',
            cartCount: 3,
            isAuthenticated: true,
        });
    });

    it('supports session search, pinning, and recency grouping helpers', () => {
        const now = Date.now();
        const sessions = [
            {
                id: 'today-pinned',
                title: 'Pinned checkout',
                preview: 'You: go to checkout',
                originPath: '/checkout',
                pinned: true,
                createdAt: now,
                updatedAt: now,
            },
            {
                id: 'yesterday',
                title: 'Support handoff',
                preview: 'Opening support',
                originPath: '/orders',
                pinned: false,
                createdAt: now - (24 * 60 * 60 * 1000),
                updatedAt: now - (24 * 60 * 60 * 1000),
            },
            {
                id: 'older',
                title: 'Camera search',
                preview: 'You: best camera phones',
                originPath: '/search',
                pinned: false,
                createdAt: now - (9 * 24 * 60 * 60 * 1000),
                updatedAt: now - (9 * 24 * 60 * 60 * 1000),
            },
        ];

        expect(filterChatSessions(sessions, 'support')).toEqual([
            expect.objectContaining({ id: 'yesterday' }),
        ]);
        expect(groupChatSessionsByRecency(sessions, now)).toEqual([
            expect.objectContaining({
                key: 'today',
                sessions: [expect.objectContaining({ id: 'today-pinned' })],
            }),
            expect.objectContaining({
                key: 'yesterday',
                sessions: [expect.objectContaining({ id: 'yesterday' })],
            }),
            expect.objectContaining({
                key: 'older',
                sessions: [expect.objectContaining({ id: 'older' })],
            }),
        ]);
    });

    it('isolates guest sessions from signed-in user scopes', () => {
        useChatStore.getState().appendUserMessage('guest-only question');

        useChatStore.getState().switchViewerScope({
            viewerScope: 'user:user-a',
            preservedContext: {
                route: '/assistant',
                isAuthenticated: true,
            },
        });

        let state = useChatStore.getState();
        expect(state.context.isAuthenticated).toBe(true);
        expect(state.messages.some((message) => message.text === 'guest-only question')).toBe(false);

        useChatStore.getState().appendUserMessage('user-a question');
        useChatStore.getState().switchViewerScope({
            viewerScope: 'guest',
            preservedContext: {
                route: '/assistant',
                isAuthenticated: false,
            },
        });

        state = useChatStore.getState();
        expect(state.context.isAuthenticated).toBe(false);
        expect(state.messages.some((message) => message.text === 'guest-only question')).toBe(true);
        expect(state.messages.some((message) => message.text === 'user-a question')).toBe(false);

        useChatStore.getState().switchViewerScope({
            viewerScope: 'user:user-a',
            preservedContext: {
                route: '/assistant',
                isAuthenticated: true,
            },
        });

        state = useChatStore.getState();
        expect(state.messages.some((message) => message.text === 'user-a question')).toBe(true);
        expect(state.messages.some((message) => message.text === 'guest-only question')).toBe(false);
    });

    it('keeps assistant sessions distinct for different signed-in users on the same device', () => {
        useChatStore.getState().switchViewerScope({
            viewerScope: 'user:user-a',
            preservedContext: {
                route: '/assistant',
                isAuthenticated: true,
            },
        });
        useChatStore.getState().appendUserMessage('history for user a');

        useChatStore.getState().switchViewerScope({
            viewerScope: 'user:user-b',
            preservedContext: {
                route: '/assistant',
                isAuthenticated: true,
            },
        });

        let state = useChatStore.getState();
        expect(state.messages.some((message) => message.text === 'history for user a')).toBe(false);

        useChatStore.getState().appendUserMessage('history for user b');
        useChatStore.getState().switchViewerScope({
            viewerScope: 'user:user-a',
            preservedContext: {
                route: '/assistant',
                isAuthenticated: true,
            },
        });

        state = useChatStore.getState();
        expect(state.messages.some((message) => message.text === 'history for user a')).toBe(true);
        expect(state.messages.some((message) => message.text === 'history for user b')).toBe(false);
    });

    it('treats signed-in session history from the server as authoritative', () => {
        useChatStore.getState().switchViewerScope({
            viewerScope: 'user:user-a',
            preservedContext: {
                route: '/assistant',
                isAuthenticated: true,
            },
        });
        useChatStore.getState().appendUserMessage('stale local thread');

        const staleLocalSessionId = useChatStore.getState().activeSessionId;

        useChatStore.getState().replaceSessionsFromServer([
            {
                id: 'server-session-1',
                title: 'Saved server thread',
                preview: 'Synced from backend',
                originPath: '/assistant',
                createdAt: Date.now() - 5000,
                updatedAt: Date.now(),
            },
        ], { authoritative: true });

        const state = useChatStore.getState();
        expect(state.sessions.map((session) => session.id)).toEqual(['server-session-1']);
        expect(state.sessions.some((session) => session.id === staleLocalSessionId)).toBe(false);
    });

    it('tracks streaming metadata and finalizes a fast reply in place', () => {
        const sessionId = useChatStore.getState().activeSessionId;
        const streamId = useChatStore.getState().beginAssistantStream({
            sessionId,
        });

        useChatStore.getState().setAssistantStreamMeta(streamId, {
            sessionId,
            messageId: streamId,
            decision: 'HYBRID',
            provisional: true,
            upgradeEligible: true,
            traceId: 'trace_fast',
        }, sessionId);
        useChatStore.getState().appendAssistantStreamToken(streamId, 'Quick ', sessionId);
        useChatStore.getState().appendAssistantStreamToken(streamId, 'answer', sessionId);
        useChatStore.getState().finalizeAssistantStream(streamId, {
            text: 'Quick answer',
            provisional: true,
            upgradeEligible: true,
            decision: 'HYBRID',
            traceId: 'trace_fast',
            assistantTurn: {
                intent: 'general_knowledge',
                decision: 'respond',
                response: 'Quick answer',
                ui: {
                    surface: 'plain_answer',
                },
                followUps: ['Tell me more'],
            },
        }, sessionId);

        const state = useChatStore.getState();
        const finalizedMessage = state.messages.find((message) => message.id === streamId);
        expect(finalizedMessage).toMatchObject({
            id: streamId,
            text: 'Quick answer',
            provisional: true,
            upgradeEligible: true,
            decision: 'HYBRID',
            traceId: 'trace_fast',
            isStreaming: false,
            status: 'complete',
        });
        expect(state.sessionStateById[sessionId].pendingUpgradeMessageIds).toContain(streamId);
    });

    it('merges a refined socket upgrade into the same assistant message', () => {
        const sessionId = useChatStore.getState().activeSessionId;
        useChatStore.getState().appendAssistantTurn({
            sessionId,
            id: 'message-1',
            text: 'Quick answer',
            provisional: true,
            upgradeEligible: true,
            decision: 'HYBRID',
            assistantTurn: {
                intent: 'general_knowledge',
                decision: 'respond',
                response: 'Quick answer',
                ui: {
                    surface: 'plain_answer',
                },
            },
        });

        useChatStore.getState().mergeAssistantUpgrade({
            sessionId,
            messageId: 'message-1',
            content: 'Updated with deeper analysis.',
            citations: [{ id: 'c1', label: 'Source 1' }],
            verification: { label: 'app_grounded', summary: 'Checked against app state.' },
            providerInfo: { name: 'central-intelligence', model: 'gemma' },
            decision: 'HYBRID',
            traceId: 'trace_refined',
        });

        const upgradedMessage = useChatStore.getState().messages.find((message) => message.id === 'message-1');
        expect(upgradedMessage).toMatchObject({
            id: 'message-1',
            text: 'Updated with deeper analysis.',
            upgraded: true,
            provisional: false,
            upgradeEligible: false,
            traceId: 'trace_refined',
        });
        expect(upgradedMessage.assistantTurn).toMatchObject({
            response: 'Updated with deeper analysis.',
            verification: {
                label: 'app_grounded',
            },
        });
        expect(upgradedMessage.assistantTurn.citations).toHaveLength(1);
    });
});
