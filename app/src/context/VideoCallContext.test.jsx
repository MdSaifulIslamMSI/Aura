import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { IntlProvider } from 'react-intl';

vi.mock('./AuthContext', () => ({
    useAuth: () => ({ currentUser: null, profile: {}, roles: {} }),
}));
vi.mock('./SocketContext', () => ({
    useSocketDemand: vi.fn(() => ({})),
}));
vi.mock('../components/features/video/VideoCallOverlay', () => ({
    default: () => null,
}));
vi.mock('../services/api', () => ({
    listingApi: {
        startVideoSession: vi.fn(),
        joinVideoSession: vi.fn(),
        markVideoSessionConnected: vi.fn(),
        endVideoSession: vi.fn(),
    },
    supportApi: {
        startVideoSession: vi.fn(),
        joinVideoSession: vi.fn(),
        markVideoSessionConnected: vi.fn(),
        endVideoSession: vi.fn(),
    },
}));
vi.mock('../services/nativeAppExperience', () => ({
    addNativeAppResumeListener: vi.fn(() => () => {}),
    requestCallMediaReadiness: vi.fn(async () => ({ ok: true })),
    showSystemNotification: vi.fn(),
}));
vi.mock('sonner', () => ({
    toast: {
        error: vi.fn(),
        success: vi.fn(),
        warning: vi.fn(),
        info: vi.fn(),
    },
}));
vi.mock('livekit-client', () => {
    const ConnectionState = {
        Connected: 'connected',
        Connecting: 'connecting',
        Reconnecting: 'reconnecting',
        Disconnected: 'disconnected',
    };
    const RoomEvent = {
        Connected: 'Connected',
        Disconnected: 'Disconnected',
        LocalTrackPublished: 'LocalTrackPublished',
        LocalTrackUnpublished: 'LocalTrackUnpublished',
        TrackSubscribed: 'TrackSubscribed',
        TrackUnsubscribed: 'TrackUnsubscribed',
        ParticipantConnected: 'ParticipantConnected',
        ParticipantDisconnected: 'ParticipantDisconnected',
        Reconnecting: 'Reconnecting',
        Reconnected: 'Reconnected',
        MediaDevicesError: 'MediaDevicesError',
    };
    const Track = {
        Source: { Camera: 'camera', Microphone: 'microphone', ScreenShare: 'screenshare' },
    };

    class Room {
        constructor() {
            this.state = ConnectionState.Connected;
            this.localParticipant = {
                trackPublications: [],
                getTrackPublication: vi.fn(() => null),
                setCameraEnabled: vi.fn(async () => undefined),
                setMicrophoneEnabled: vi.fn(async () => undefined),
            };
            this.remoteParticipants = new Set();
            this.connect = vi.fn(async () => undefined);
            this.disconnect = vi.fn(async () => undefined);
            this.removeAllListeners = vi.fn();
            this.handlers = new Map();
        }
        on(event, handler) {
            const list = this.handlers.get(event) || [];
            list.push(handler);
            this.handlers.set(event, list);
        }
    }

    return { ConnectionState, RoomEvent, Track, Room };
});

import { toast } from 'sonner';
import { listingApi, supportApi } from '../services/api';
import { requestCallMediaReadiness } from '../services/nativeAppExperience';
import { VideoCallProvider, useVideoCall } from './VideoCallContext';

const renderVideoCall = () => renderHook(() => useVideoCall(), {
    wrapper: ({ children }) => (
        <IntlProvider locale="en" defaultLocale="en">
            <VideoCallProvider>{children}</VideoCallProvider>
        </IntlProvider>
    ),
});

const liveSessionPayload = (overrides = {}) => ({
    meta: {
        liveCall: {
            accessToken: 'token-1',
            wsUrl: 'wss://live.example',
            sessionKey: 'session-1',
            mediaMode: 'video',
            ...overrides,
        },
    },
});

const startCallIn = async (result) => {
    let outcome;
    await act(async () => {
        outcome = await result.current.startCall({
            listingId: 'listing-1',
            mediaMode: 'video',
        });
    });
    return outcome;
};

beforeEach(() => {
    vi.clearAllMocks();
    requestCallMediaReadiness.mockImplementation(async () => ({ ok: true }));
    Object.values(listingApi).forEach((fn) => {
        if (typeof fn.mockImplementation === 'function') {
            fn.mockImplementation(async () => ({ data: {} }));
        }
    });
    Object.values(supportApi).forEach((fn) => {
        if (typeof fn.mockImplementation === 'function') {
            fn.mockImplementation(async () => ({ data: {} }));
        }
    });
});

describe('VideoCallContext', () => {
    it('starts idle with the full live-call API surface', () => {
        const { result } = renderVideoCall();

        expect(result.current.callStatus).toBe('idle');
        expect(result.current.callMeta.roomConnectionState).toBe('idle');
        expect(result.current.callMeta.remoteParticipantCount).toBe(0);
        expect(result.current.activeCallContext).toBeNull();
        expect(result.current.callError).toBe('');
        [
            'startCall',
            'answerCall',
            'hangUp',
            'switchCamera',
            'toggleScreenShare',
        ].forEach((fnName) => {
            expect(typeof result.current[fnName]).toBe('function');
        });
    });

    it('fails a listing call whose session details are incomplete and cleans up', async () => {
        listingApi.startVideoSession.mockResolvedValue({ data: {} });
        const { result } = renderVideoCall();

        const outcome = await startCallIn(result);

        expect(outcome).toBe(false);
        expect(listingApi.startVideoSession).toHaveBeenCalledWith(
            'listing-1',
            { mediaMode: 'video' }
        );
        expect(listingApi.endVideoSession).not.toHaveBeenCalled();
        expect(result.current.callStatus).toBe('idle');
        expect(result.current.callError).toBe('Live inspection session details are missing.');
        expect(toast.error).toHaveBeenCalledWith('Live inspection session details are missing.');
    });

    it('connects a listing call end to end and exposes the active call context', async () => {
        listingApi.startVideoSession.mockResolvedValue(
            liveSessionPayload({ contextLabel: 'Live inspection' })
        );
        const { result } = renderVideoCall();

        const outcome = await startCallIn(result);

        expect(outcome).toBe(true);
        expect(requestCallMediaReadiness).toHaveBeenCalledWith({ video: true });
        expect(result.current.callStatus).toBe('calling');
        expect(result.current.callMeta.roomConnectionState).toBe('connected');
        expect(result.current.activeCallContext).toMatchObject({
            listingId: 'listing-1',
            contextId: 'listing-1',
            transport: 'livekit',
            sessionKey: 'session-1',
            mediaMode: 'video',
            contextLabel: 'Live inspection',
        });
        expect(toast.error).not.toHaveBeenCalled();
    });

    it('aborts before joining the room when media readiness fails', async () => {
        listingApi.startVideoSession.mockResolvedValue(liveSessionPayload());
        requestCallMediaReadiness.mockResolvedValue({
            ok: false,
            message: 'Camera and microphone are blocked.',
        });
        const { result } = renderVideoCall();

        const outcome = await startCallIn(result);

        expect(outcome).toBe(false);
        expect(requestCallMediaReadiness).toHaveBeenCalledWith({ video: true });
        expect(toast.error).toHaveBeenCalledWith('Camera and microphone are blocked.');
        expect(result.current.callStatus).toBe('idle');
        expect(listingApi.endVideoSession).not.toHaveBeenCalled();
    });

    it('hangs up the active call and terminates the backend session', async () => {
        listingApi.startVideoSession.mockResolvedValue(liveSessionPayload());
        const { result } = renderVideoCall();
        await startCallIn(result);

        let hangUpOutcome;
        await act(async () => {
            hangUpOutcome = await result.current.hangUp();
        });

        expect(hangUpOutcome).toBe(true);
        expect(listingApi.endVideoSession).toHaveBeenCalledWith('listing-1', {
            sessionKey: 'session-1',
            reason: 'missed',
        });
        expect(result.current.callStatus).toBe('idle');
        expect(result.current.activeCallContext).toBeNull();
        expect(result.current.callMeta.roomConnectionState).toBe('idle');
    });

    it('refuses to answer when no call is pending', async () => {
        const { result } = renderVideoCall();

        let outcome;
        await act(async () => {
            outcome = await result.current.answerCall();
        });

        expect(outcome).toBe(false);
        expect(toast.error).toHaveBeenCalledWith('There is no live call waiting to be answered.');
        expect(listingApi.joinVideoSession).not.toHaveBeenCalled();
    });

    it('routes support ticket calls through the support session APIs', async () => {
        supportApi.startVideoSession.mockResolvedValue(
            liveSessionPayload({ sessionKey: 'session-2', mediaMode: 'voice' })
        );
        const { result } = renderVideoCall();

        let outcome;
        await act(async () => {
            outcome = await result.current.startCall({
                channelType: 'support_ticket',
                supportTicketId: 'ticket-9',
                targetUserId: 'user-42',
                mediaMode: 'voice',
            });
        });

        expect(outcome).toBe(true);
        expect(supportApi.startVideoSession).toHaveBeenCalledWith(
            'ticket-9',
            { mediaMode: 'voice' }
        );
        expect(result.current.activeCallContext).toMatchObject({
            channelType: 'support_ticket',
            supportTicketId: 'ticket-9',
            sessionKey: 'session-2',
            mediaMode: 'voice',
        });

        await act(async () => {
            await result.current.hangUp();
        });
        expect(supportApi.endVideoSession).toHaveBeenCalledWith('ticket-9', {
            sessionKey: 'session-2',
            reason: 'missed',
        });
        expect(listingApi.startVideoSession).not.toHaveBeenCalled();
    });
});
