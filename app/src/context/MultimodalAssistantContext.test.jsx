import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act, screen } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { MemoryRouter } from 'react-router-dom';

vi.mock('./VideoCallContext', () => ({ useVideoCall: vi.fn() }));
vi.mock('@/components/shared/VoiceSearch', () => ({
    default: () => <div data-testid="voice-search-probe" />,
}));
vi.mock('@/store/chatStore', () => ({ useChatStore: vi.fn() }));

import { useVideoCall } from './VideoCallContext';
import { useChatStore } from '@/store/chatStore';
import {
    MultimodalAssistantProvider,
    useMultimodalAssistant,
} from './MultimodalAssistantContext';

const openChat = vi.fn();

const chatState = {
    messages: [],
    mode: 'explore',
    status: 'idle',
    inputValue: '  fresh brief  ',
    currentIntent: 'price-check',
    context: {
        lastQuery: 'wireless earbuds',
        activeProductId: 'prod-9',
        cartCount: 2,
        sessionMemory: { currentIntent: 'price-check' },
    },
    open: openChat,
};

const videoCallState = {
    startCall: vi.fn(async () => true),
    callStatus: 'idle',
    activeCallContext: null,
    callerInfo: null,
    callMeta: { remoteParticipantCount: 0 },
};

const renderAssistant = ({ pathname = '/' } = {}) => renderHook(
    () => useMultimodalAssistant(),
    {
        wrapper: ({ children }) => (
            <IntlProvider locale="en" defaultLocale="en">
                <MemoryRouter initialEntries={[pathname]}>
                    <MultimodalAssistantProvider>{children}</MultimodalAssistantProvider>
                </MemoryRouter>
            </IntlProvider>
        ),
    }
);

beforeEach(() => {
    openChat.mockClear();
    videoCallState.startCall.mockClear();
    videoCallState.startCall.mockResolvedValue(true);
    videoCallState.callStatus = 'idle';
    videoCallState.activeCallContext = null;
    videoCallState.callerInfo = null;
    videoCallState.callMeta = { remoteParticipantCount: 0 };
    useChatStore.mockImplementation((selector) => selector(chatState));
    useVideoCall.mockReturnValue(videoCallState);
});

describe('MultimodalAssistantContext defaults', () => {
    it('starts on the chat channel with no voice assistant or session events', () => {
        const { result } = renderAssistant();
        expect(result.current.activeChannel).toBe('chat');
        expect(result.current.isVoiceAssistantOpen).toBe(false);
        expect(result.current.sessionEvents).toEqual([]);
        expect(result.current.readiness.network).toBe('online');
    });

    it('summarizes the idle live-call lane', () => {
        const { result } = renderAssistant();
        expect(result.current.activeCallSummary).toEqual({
            active: false,
            status: 'idle',
            mediaMode: 'video',
            label: '',
            remoteParticipantCount: 0,
        });
    });
});

describe('MultimodalAssistantContext route awareness', () => {
    it('derives the listing context from the current listing route', () => {
        const { result } = renderAssistant({ pathname: '/listing/abc-123?ref=nav' });
        expect(result.current.routeContext).toMatchObject({
            routeLabel: 'Marketplace listing',
            listingId: 'abc-123',
            canLaunchInspection: true,
        });
    });

    it('falls back to a generic shopping label outside listings', () => {
        const { result } = renderAssistant({ pathname: '/somewhere-else' });
        expect(result.current.routeContext).toMatchObject({
            routeLabel: 'Shopping flow',
            listingId: '',
            canLaunchInspection: false,
        });
    });

    it('maps chat store state into the handoff continuity context', () => {
        const { result } = renderAssistant({ pathname: '/' });
        expect(result.current.continuityContext).toMatchObject({
            routeLabel: 'Home feed',
            lastQuery: 'wireless earbuds',
            activeProductId: 'prod-9',
            cartCount: 2,
            currentIntent: 'price-check',
            inputValue: 'fresh brief',
            chatMode: 'explore',
            chatStatus: 'idle',
        });
    });
});

describe('MultimodalAssistantContext voice assistant lifecycle', () => {
    it('opens the voice assistant, renders VoiceSearch, and records the armed event', async () => {
        const { result } = renderAssistant({ pathname: '/' });

        await act(async () => {
            result.current.openVoiceAssistant({ initialCommand: 'find deals', origin: 'listing_card' });
        });

        expect(result.current.isVoiceAssistantOpen).toBe(true);
        expect(result.current.activeChannel).toBe('voice');
        expect(screen.getByTestId('voice-search-probe')).toBeInTheDocument();
        expect(result.current.sessionEvents[0]).toMatchObject({
            channel: 'voice',
            tone: 'accent',
            title: 'Voice copilot armed',
            detail: 'find deals',
        });
    });

    it('closes the voice assistant and unmounts VoiceSearch', async () => {
        const { result } = renderAssistant({ pathname: '/' });

        await act(async () => {
            result.current.openVoiceAssistant();
        });
        expect(screen.getByTestId('voice-search-probe')).toBeInTheDocument();

        await act(async () => {
            result.current.closeVoiceAssistant();
        });

        expect(result.current.isVoiceAssistantOpen).toBe(false);
        expect(screen.queryByTestId('voice-search-probe')).not.toBeInTheDocument();
    });

    it('resumes chat through the store and records the chat event', async () => {
        const { result } = renderAssistant({ pathname: '/' });

        await act(async () => {
            result.current.openVoiceAssistant();
        });
        await act(async () => {
            result.current.openChatAssistant();
        });

        expect(openChat).toHaveBeenCalledTimes(1);
        expect(result.current.isVoiceAssistantOpen).toBe(false);
        expect(result.current.sessionEvents[0]).toMatchObject({
            channel: 'chat',
            tone: 'accent',
            title: 'Chat resumed',
        });
    });
});

describe('MultimodalAssistantContext.startContextualCall', () => {
    it('refuses to launch a live lane without a listing context', async () => {
        const { result } = renderAssistant({ pathname: '/cart' });

        let launched;
        await act(async () => {
            launched = await result.current.startContextualCall();
        });

        expect(launched).toBe(false);
        expect(videoCallState.startCall).not.toHaveBeenCalled();
        expect(result.current.sessionEvents[0]).toMatchObject({
            channel: 'call-routing',
            tone: 'warning',
            title: 'Live inspection needs a listing',
        });
    });

    it('launches a listing-scoped call and records a success event', async () => {
        const { result } = renderAssistant({ pathname: '/listing/abc-123' });

        let launched;
        await act(async () => {
            launched = await result.current.startContextualCall({ mediaMode: 'voice' });
        });

        expect(launched).toBe(true);
        expect(videoCallState.startCall).toHaveBeenCalledWith(
            expect.objectContaining({
                channelType: 'listing',
                listingId: 'abc-123',
                contextId: 'abc-123',
                callerName: 'Marketplace peer',
                mediaMode: 'voice',
            }),
            'abc-123'
        );
        expect(result.current.sessionEvents[0]).toMatchObject({
            channel: 'call-voice',
            tone: 'success',
            title: 'Live voice lane launched',
        });
    });

    it('records a warning event when the call fails to launch', async () => {
        videoCallState.startCall.mockResolvedValue(false);
        const { result } = renderAssistant({ pathname: '/listing/abc-123' });

        let launched;
        await act(async () => {
            launched = await result.current.startContextualCall();
        });

        expect(launched).toBe(false);
        expect(result.current.sessionEvents[0]).toMatchObject({
            channel: 'call-video',
            tone: 'warning',
            title: 'Live video lane failed',
        });
    });

    it('caps the session timeline at 18 events', async () => {
        const { result } = renderAssistant({ pathname: '/listing/abc-123' });

        await act(async () => {
            for (let index = 0; index < 22; index += 1) {
                // eslint-disable-next-line no-await-in-loop
                await result.current.startContextualCall({ mediaMode: 'video' });
            }
        });

        expect(result.current.sessionEvents).toHaveLength(18);
    });
});

describe('MultimodalAssistantContext live-call awareness', () => {
    it('switches to the live-voice channel while a voice call is active', () => {
        videoCallState.callStatus = 'ringing';
        videoCallState.activeCallContext = { mediaMode: 'voice', contextLabel: ' Support lane ' };
        videoCallState.callMeta = { remoteParticipantCount: 1 };

        const { result } = renderAssistant({ pathname: '/' });
        expect(result.current.activeChannel).toBe('live-voice');
        expect(result.current.activeCallSummary).toEqual({
            active: true,
            status: 'ringing',
            mediaMode: 'voice',
            label: 'Support lane',
            remoteParticipantCount: 1,
        });
    });
});
