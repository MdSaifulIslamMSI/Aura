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

    it('preserves locally unsynced threads during authoritative server history sync', () => {
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
        expect(state.sessions.map((session) => session.id).sort()).toEqual([
            'server-session-1',
            staleLocalSessionId,
        ].sort());
        expect(state.sessions.some((session) => session.id === staleLocalSessionId)).toBe(true);
        expect(state.sessions.find((session) => session.id === staleLocalSessionId)?.serverSynced).toBe(false);
        expect(state.sessions.find((session) => session.id === 'server-session-1')?.serverSynced).toBe(true);
    });

    it('preserves a matching server-backed thread when local work changes during history sync', () => {
        useChatStore.getState().switchViewerScope({
            viewerScope: 'user:user-a',
            preservedContext: {
                route: '/assistant',
                isAuthenticated: true,
            },
        });
        const sessionId = useChatStore.getState().activeSessionId;
        useChatStore.getState().hydrateSessionFromServer({
            session: {
                id: sessionId,
                title: 'Server-backed thread',
                preview: 'Earlier server turn',
                originPath: '/assistant',
            },
            messages: [{
                id: 'server-message',
                role: 'assistant',
                text: 'Earlier server turn',
            }],
        }, {
            sessionId,
        });

        const expectedRevisions = {
            [sessionId]: useChatStore.getState().getSessionConversationRevision(sessionId),
        };
        useChatStore.getState().appendUserMessage('keep this in-flight question', { sessionId });
        const streamMessageId = useChatStore.getState().beginAssistantStream({ sessionId });

        useChatStore.getState().replaceSessionsFromServer([{
            id: sessionId,
            title: 'Stale server title',
            preview: 'Stale server preview',
            originPath: '/assistant',
        }], {
            authoritative: true,
            expectedViewerScope: 'user:user-a',
            expectedRevisions,
        });

        const state = useChatStore.getState();
        expect(state.messages.some((message) => message.text === 'keep this in-flight question')).toBe(true);
        expect(state.messages.some((message) => message.id === streamMessageId && message.isStreaming)).toBe(true);
        expect(state.activeSession).toMatchObject({
            id: sessionId,
            title: 'keep this in-flight question',
            serverSynced: true,
        });

        useChatStore.getState().replaceSessionsFromServer([], {
            authoritative: true,
            expectedViewerScope: 'user:user-a',
            expectedRevisions,
        });
        expect(useChatStore.getState().messages.some((message) => message.text === 'keep this in-flight question')).toBe(true);
    });

    it('rejects stale list and detail hydration from a previous viewer scope', () => {
        useChatStore.getState().switchViewerScope({
            viewerScope: 'user:user-a',
            preservedContext: {
                route: '/assistant',
                isAuthenticated: true,
            },
        });
        useChatStore.getState().switchViewerScope({
            viewerScope: 'user:user-b',
            preservedContext: {
                route: '/assistant',
                isAuthenticated: true,
            },
        });
        const userBSessionId = useChatStore.getState().activeSessionId;

        useChatStore.getState().replaceSessionsFromServer([{
            id: 'user-a-session',
            title: 'User A private thread',
            preview: 'User A private preview',
        }], {
            authoritative: true,
            expectedViewerScope: 'user:user-a',
        });
        useChatStore.getState().hydrateSessionFromServer({
            session: {
                id: userBSessionId,
                title: 'User A stale detail',
            },
            messages: [{
                id: 'user-a-private-message',
                role: 'assistant',
                text: 'User A private detail',
            }],
        }, {
            expectedViewerScope: 'user:user-a',
            sessionId: userBSessionId,
        });

        const state = useChatStore.getState();
        expect(state.viewerScope).toBe('user:user-b');
        expect(state.activeSessionId).toBe(userBSessionId);
        expect(state.sessions.some((session) => session.id === 'user-a-session')).toBe(false);
        expect(state.messages.some((message) => message.id === 'user-a-private-message')).toBe(false);
    });

    it('drops a previously server-synced thread omitted by authoritative history', () => {
        const sessionId = useChatStore.getState().activeSessionId;
        useChatStore.getState().appendUserMessage('this thread has reached the server');
        useChatStore.getState().replaceSessionsFromServer([{
            id: sessionId,
            title: 'Server-backed thread',
            preview: 'Synced from backend',
            originPath: '/assistant',
        }], { authoritative: true });

        expect(useChatStore.getState().sessions.find((session) => session.id === sessionId)?.serverSynced).toBe(true);

        useChatStore.getState().replaceSessionsFromServer([], { authoritative: true });

        expect(useChatStore.getState().sessions.some((session) => session.id === sessionId)).toBe(false);
    });

    it('guards late server hydration when the local conversation changed', () => {
        const sessionId = useChatStore.getState().activeSessionId;
        const expectedRevision = useChatStore.getState().getSessionConversationRevision(sessionId);
        useChatStore.getState().appendUserMessage('keep this newer local message');

        useChatStore.getState().hydrateSessionFromServer({
            session: {
                id: sessionId,
                title: 'Stale server title',
            },
            messages: [
                {
                    id: 'stale-server-message',
                    role: 'assistant',
                    text: 'stale server response',
                },
            ],
        }, {
            expectedRevision,
            sessionId,
        });

        expect(useChatStore.getState().messages.some((message) => message.text === 'keep this newer local message')).toBe(true);
        expect(useChatStore.getState().messages.some((message) => message.id === 'stale-server-message')).toBe(false);
    });

    it('hydrates a background session without stealing active-session focus', () => {
        const originalSessionId = useChatStore.getState().activeSessionId;
        useChatStore.getState().hydrateSessionFromServer({
            session: {
                id: 'server-session-background',
                title: 'Background thread',
            },
            messages: [{
                id: 'background-message',
                role: 'assistant',
                text: 'background history',
            }],
        }, {
            activate: false,
            sessionId: 'server-session-background',
        });

        expect(useChatStore.getState().activeSessionId).toBe(originalSessionId);
        expect(useChatStore.getState().sessions.find((session) => session.id === 'server-session-background')?.serverSynced).toBe(true);

        useChatStore.getState().hydrateSessionFromServer({
            session: {
                id: 'server-session-active',
                title: 'New active thread',
            },
            messages: [],
        });

        expect(useChatStore.getState().activeSessionId).toBe('server-session-active');
    });

    it('clears stale turn actions when a new user turn starts', () => {
        const sessionId = useChatStore.getState().activeSessionId;
        useChatStore.getState().setSurface({
            mode: 'product',
            primaryAction: { id: 'old-primary', kind: 'add-to-cart' },
            secondaryActions: [{ id: 'old-secondary', kind: 'view-details' }],
            supportPrefill: { subject: 'old context' },
        });
        useChatStore.getState().setPendingAction({ type: 'add_to_cart' }, sessionId);
        useChatStore.getState().setPendingConfirmation({ token: 'old-confirmation' });

        useChatStore.getState().appendUserMessage('start a different request');

        expect(useChatStore.getState()).toMatchObject({
            primaryAction: null,
            secondaryActions: [],
            supportPrefill: null,
            pendingAction: null,
            pendingConfirmation: null,
        });
    });

    it('clears the requested thread even if another thread becomes active', () => {
        const firstSessionId = useChatStore.getState().activeSessionId;
        useChatStore.getState().appendUserMessage('clear only this thread');
        useChatStore.getState().resetConversation();
        const secondSessionId = useChatStore.getState().activeSessionId;
        useChatStore.getState().appendUserMessage('keep this active thread');

        useChatStore.getState().clearActiveSessionConversation(firstSessionId);

        expect(useChatStore.getState().activeSessionId).toBe(secondSessionId);
        expect(useChatStore.getState().messages.some((message) => message.text === 'keep this active thread')).toBe(true);
        expect(useChatStore.getState().sessionStateById[firstSessionId].messages.some((message) => message.role === 'user')).toBe(false);
    });

    it('strips raw media and transient request state before persistence and rehydrate', async () => {
        const sessionId = useChatStore.getState().activeSessionId;
        useChatStore.getState().appendUserMessage('inspect attachment', {
            images: [{ id: 'image-1', fileName: 'sample.png', dataUrl: 'data:image/png;base64,secret-image' }],
            audio: [{ id: 'audio-1', fileName: 'sample.webm', dataUrl: 'data:audio/webm;base64,secret-audio' }],
        });
        useChatStore.getState().setPendingAction({ type: 'add_to_cart' }, sessionId);
        useChatStore.getState().setPendingConfirmation({ token: 'stale-token' });
        useChatStore.getState().beginAssistantStream({ sessionId });

        const persistedRaw = localStorage.getItem('aura-shopper-chat-v4');
        expect(persistedRaw).not.toContain('secret-image');
        expect(persistedRaw).not.toContain('secret-audio');

        await useChatStore.persist.rehydrate();

        const rehydratedSession = useChatStore.getState().sessionStateById[sessionId];
        const userMessage = rehydratedSession.messages.find((message) => message.role === 'user');
        expect(userMessage.images[0]).not.toHaveProperty('dataUrl');
        expect(userMessage.audio[0]).not.toHaveProperty('dataUrl');
        expect(rehydratedSession).toMatchObject({
            status: 'idle',
            isLoading: false,
            pendingAction: null,
            pendingConfirmation: null,
        });
        expect(rehydratedSession.messages.some((message) => message.isStreaming)).toBe(false);
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
