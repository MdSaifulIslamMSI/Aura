import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from './AuthContext';
import { useSocketDemand } from './SocketContext';
import VideoCallOverlay from '../components/features/video/VideoCallOverlay';
import { listingApi, supportApi } from '../services/api';

const VideoCallContext = createContext(null);

export const useVideoCall = () => useContext(VideoCallContext);

let liveKitModulePromise = null;
const LIVEKIT_ENGINE_TIMEOUT_FRAGMENT = 'engine not connected within timeout';
const LIVEKIT_CONNECTION_READY_TIMEOUT_MS = 12000;
const LIVEKIT_CONNECTION_SETTLE_MS = 300;
const LIVEKIT_PUBLISH_RETRY_LIMIT = 2;
const LIVEKIT_PUBLISH_RETRY_DELAY_MS = 1200;

const loadLiveKitModule = async () => {
    if (!liveKitModulePromise) {
        liveKitModulePromise = import('livekit-client').then((module) => ({
            ConnectionState: module.ConnectionState,
            Room: module.Room,
            RoomEvent: module.RoomEvent,
            Track: module.Track,
        }));
    }

    return liveKitModulePromise;
};

const stopStreamTracks = (stream) => {
    stream?.getTracks?.().forEach((track) => {
        try {
            track.stop();
        } catch {
            // Ignore duplicate stop calls during cleanup.
        }
    });
};

const buildMediaStreamFromTracks = (tracks = []) => {
    const nextTracks = tracks.filter(Boolean);
    return nextTracks.length > 0 ? new MediaStream(nextTracks) : null;
};

const getVideoTrackDeviceId = (stream) => String(
    stream?.getVideoTracks?.()?.[0]?.getSettings?.()?.deviceId || ''
).trim();

const waitForDelay = (durationMs) => new Promise((resolve) => {
    window.setTimeout(resolve, durationMs);
});

const isLiveKitEngineTimeoutError = (error) => String(error?.message || '')
    .toLowerCase()
    .includes(LIVEKIT_ENGINE_TIMEOUT_FRAGMENT);

const formatLiveCallErrorMessage = (message, fallback = 'Live call failed') => {
    const nextMessage = String(message || '').trim();
    if (!nextMessage) {
        return fallback;
    }

    if (isLiveKitEngineTimeoutError({ message: nextMessage })) {
        return 'Live call media took too long to initialize. Rejoin and try again.';
    }

    return nextMessage;
};

const buildMediaPublishWarning = (results = []) => {
    const failedKinds = results
        .filter((result) => !result?.enabled)
        .map((result) => result.kind);

    if (failedKinds.length === 0) {
        return '';
    }

    if (failedKinds.length === 1 && failedKinds[0] === 'camera') {
        return 'Camera could not start. The live call will continue with audio only.';
    }

    if (failedKinds.length === 1 && failedKinds[0] === 'microphone') {
        return 'Microphone could not start. The live call will continue without your audio.';
    }

    return 'Some live-call media could not start. Rejoin if audio or video is missing.';
};

const buildMediaPublishFailureMessage = (results = []) => {
    const failedResults = results.filter((result) => !result?.enabled);
    if (failedResults.length === 0) {
        return 'Live call media failed';
    }

    if (failedResults.length === 1 && failedResults[0]?.kind === 'microphone') {
        return 'Microphone could not start for the live call. Check device permissions and try again.';
    }

    if (failedResults.length === 1 && failedResults[0]?.kind === 'camera') {
        return 'Camera could not start for the live call. Check device permissions and try again.';
    }

    if (failedResults.every((result) => isLiveKitEngineTimeoutError(result?.error))) {
        return 'Live call media took too long to initialize. Rejoin and try again.';
    }

    return 'Camera and microphone could not start for the live call. Check device permissions and try again.';
};

const readLiveCallMeta = (payload) => payload?.meta?.liveCall || payload?.liveCall || null;
const normalizeLiveCallMediaMode = (value) => (
    String(value || '').trim().toLowerCase() === 'voice' ? 'voice' : 'video'
);

const normalizeCallRequest = (targetOrRequest, listingId) => {
    if (targetOrRequest && typeof targetOrRequest === 'object') {
        const channelType = targetOrRequest.channelType === 'support_ticket' ? 'support_ticket' : 'listing';
        const contextId = String(
            targetOrRequest.contextId
            || targetOrRequest.supportTicketId
            || targetOrRequest.listingId
            || listingId
            || ''
        );

        return {
            targetUserId: String(targetOrRequest.targetUserId || targetOrRequest.toUserId || '').trim(),
            listingId: channelType === 'listing'
                ? String(targetOrRequest.listingId || targetOrRequest.contextId || listingId || '').trim()
                : '',
            supportTicketId: channelType === 'support_ticket'
                ? String(targetOrRequest.supportTicketId || targetOrRequest.contextId || '').trim()
                : '',
            channelType,
            contextId,
            contextLabel: String(targetOrRequest.contextLabel || targetOrRequest.title || '').trim(),
            callerName: String(targetOrRequest.callerName || '').trim(),
            transport: String(targetOrRequest.transport || 'livekit').trim() || 'livekit',
            sessionKey: String(targetOrRequest.sessionKey || '').trim(),
            mediaMode: normalizeLiveCallMediaMode(targetOrRequest.mediaMode),
        };
    }

    return {
        targetUserId: String(targetOrRequest || '').trim(),
        listingId: String(listingId || '').trim(),
        supportTicketId: '',
        channelType: 'listing',
        contextId: String(listingId || '').trim(),
        contextLabel: '',
        callerName: '',
        transport: 'livekit',
        sessionKey: '',
        mediaMode: 'video',
    };
};

const collectLocalTracks = (room, trackApi) => {
    if (!trackApi?.Source) {
        return null;
    }

    const cameraTrack = room.localParticipant
        .getTrackPublication(trackApi.Source.Camera)
        ?.videoTrack
        ?.mediaStreamTrack;
    const microphoneTrack = room.localParticipant
        .getTrackPublication(trackApi.Source.Microphone)
        ?.audioTrack
        ?.mediaStreamTrack;

    return buildMediaStreamFromTracks([cameraTrack, microphoneTrack]);
};

const collectRemoteTracks = (room) => {
    const tracks = [];

    room.remoteParticipants.forEach((participant) => {
        participant.trackPublications.forEach((publication) => {
            if (publication.track?.mediaStreamTrack) {
                tracks.push(publication.track.mediaStreamTrack);
            }
        });
    });

    return buildMediaStreamFromTracks(tracks);
};

export const VideoCallProvider = ({ children }) => {
    const { currentUser, profile, roles } = useAuth();
    const socketContext = useSocketDemand('video-calls-global', Boolean(currentUser));
    const { socket } = socketContext || {};

    const [activeCallContext, setActiveCallContext] = useState(null);
    const [localStream, setLocalStream] = useState(null);
    const [remoteStream, setRemoteStream] = useState(null);
    const [callStatus, setCallStatus] = useState('idle');
    const [callerInfo, setCallerInfo] = useState(null);
    const [callError, setCallError] = useState('');
    const [roomConnectionState, setRoomConnectionState] = useState('idle');
    const [remoteParticipantCount, setRemoteParticipantCount] = useState(0);
    const [videoInputDevices, setVideoInputDevices] = useState([]);
    const [activeVideoInputId, setActiveVideoInputId] = useState('');
    const [switchingCamera, setSwitchingCamera] = useState(false);

    const callContextRef = useRef(null);
    const supportRoomRef = useRef(null);
    const supportSessionRef = useRef(null);
    const supportMarkedConnectedRef = useRef(false);
    const supportEndingRef = useRef(false);
    const localStreamRef = useRef(null);
    const remoteStreamRef = useRef(null);
    const callStatusRef = useRef('idle');

    const isSupportAdmin = Boolean(roles?.isAdmin || profile?.isAdmin);

    const getLiveKitApi = (channelType) => (
        channelType === 'support_ticket'
            ? {
                start: supportApi.startVideoSession,
                join: supportApi.joinVideoSession,
                markConnected: supportApi.markVideoSessionConnected,
                end: supportApi.endVideoSession,
            }
            : {
                start: listingApi.startVideoSession,
                join: listingApi.joinVideoSession,
                markConnected: listingApi.markVideoSessionConnected,
                end: listingApi.endVideoSession,
            }
    );

    useEffect(() => {
        callStatusRef.current = callStatus;
    }, [callStatus]);

    useEffect(() => {
        if (callStatus === 'idle') return undefined;

        const handleBeforeUnload = (event) => {
            event.preventDefault();
            event.returnValue = '';
            return '';
        };

        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [callStatus]);

    const refreshVideoInputDevices = useCallback(async () => {
        if (!navigator?.mediaDevices?.enumerateDevices) {
            setVideoInputDevices([]);
            setActiveVideoInputId(getVideoTrackDeviceId(localStreamRef.current));
            return [];
        }

        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const nextInputs = devices
                .filter((device) => device.kind === 'videoinput')
                .map((device, index) => ({
                    deviceId: String(device.deviceId || ''),
                    label: String(device.label || `Camera ${index + 1}`),
                }));

            setVideoInputDevices(nextInputs);
            setActiveVideoInputId(getVideoTrackDeviceId(localStreamRef.current));
            return nextInputs;
        } catch {
            setVideoInputDevices([]);
            setActiveVideoInputId(getVideoTrackDeviceId(localStreamRef.current));
            return [];
        }
    }, []);

    const setLocalMediaStream = (stream) => {
        localStreamRef.current = stream || null;
        setLocalStream(stream || null);
    };

    const setRemoteMediaStream = (stream) => {
        remoteStreamRef.current = stream || null;
        setRemoteStream(stream || null);
    };

    useEffect(() => {
        if (callStatus === 'idle' || !navigator?.mediaDevices?.addEventListener) {
            return undefined;
        }

        const handleDeviceChange = () => {
            void refreshVideoInputDevices();
        };

        navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);
        return () => navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
    }, [callStatus, refreshVideoInputDevices]);

    const reportCallError = (message) => {
        const nextMessage = formatLiveCallErrorMessage(message, 'Live call failed');
        setCallError(nextMessage);
        toast.error(nextMessage);
    };

    const cleanupCallState = async ({ disconnectSupportRoom = true, preserveError = false } = {}) => {
        const room = supportRoomRef.current;
        supportRoomRef.current = null;
        supportSessionRef.current = null;
        supportMarkedConnectedRef.current = false;
        supportEndingRef.current = false;

        if (room && disconnectSupportRoom) {
            room.removeAllListeners?.();
            try {
                await room.disconnect(true);
            } catch {
                // Best-effort cleanup.
            }
        }

        stopStreamTracks(localStreamRef.current);
        stopStreamTracks(remoteStreamRef.current);
        setLocalMediaStream(null);
        setRemoteMediaStream(null);
        setCallStatus('idle');
        setCallerInfo(null);
        setRoomConnectionState('idle');
        setRemoteParticipantCount(0);
        setVideoInputDevices([]);
        setActiveVideoInputId('');
        setSwitchingCamera(false);
        setActiveCallContext(null);
        callContextRef.current = null;
        if (!preserveError) {
            setCallError('');
        }
    };

    const syncSupportRoomState = async (room, trackApi) => {
        if (supportRoomRef.current !== room) {
            return;
        }

        setLocalMediaStream(collectLocalTracks(room, trackApi));
        setRemoteMediaStream(collectRemoteTracks(room));
        setRemoteParticipantCount(room.remoteParticipants.size);
        setRoomConnectionState((previous) => (previous === 'reconnecting' ? previous : 'connected'));
        await refreshVideoInputDevices();

        if (room.remoteParticipants.size > 0) {
            setCallStatus('connected');
            setCallError('');

            if (!supportMarkedConnectedRef.current && supportSessionRef.current?.contextId) {
                supportMarkedConnectedRef.current = true;
                const liveKitApi = getLiveKitApi(supportSessionRef.current.channelType);
                await liveKitApi.markConnected(supportSessionRef.current.contextId, {
                    sessionKey: supportSessionRef.current.sessionKey,
                }).catch((error) => {
                    console.warn('Live support connection mark failed', error);
                });
            }
        }
    };

    const waitForRoomConnected = async (room, liveKitApi) => {
        const { ConnectionState, RoomEvent } = liveKitApi;

        if (room?.state === ConnectionState.Connected) {
            await waitForDelay(LIVEKIT_CONNECTION_SETTLE_MS);
            return;
        }

        await new Promise((resolve, reject) => {
            let settled = false;
            let timeoutId = null;

            const cleanup = () => {
                if (timeoutId) {
                    window.clearTimeout(timeoutId);
                    timeoutId = null;
                }
                room.off(RoomEvent.Connected, handleConnected);
                room.off(RoomEvent.Disconnected, handleDisconnected);
            };

            const finish = (callback) => {
                if (settled) {
                    return;
                }
                settled = true;
                cleanup();
                callback();
            };

            const handleConnected = () => {
                finish(resolve);
            };

            const handleDisconnected = () => {
                finish(() => reject(new Error('Live call disconnected before media could start.')));
            };

            timeoutId = window.setTimeout(() => {
                finish(() => reject(new Error('Live call connection did not finish initializing in time.')));
            }, LIVEKIT_CONNECTION_READY_TIMEOUT_MS);

            room.on(RoomEvent.Connected, handleConnected);
            room.on(RoomEvent.Disconnected, handleDisconnected);
        });

        await waitForDelay(LIVEKIT_CONNECTION_SETTLE_MS);
    };

    const enableRoomParticipantTrack = async ({ room, liveKitApi, kind }) => {
        const run = kind === 'camera'
            ? () => room.localParticipant.setCameraEnabled(true)
            : () => room.localParticipant.setMicrophoneEnabled(true);

        let lastError = null;

        for (let attempt = 1; attempt <= LIVEKIT_PUBLISH_RETRY_LIMIT; attempt += 1) {
            try {
                await waitForRoomConnected(room, liveKitApi);
                await run();
                return {
                    kind,
                    enabled: true,
                    error: null,
                };
            } catch (error) {
                lastError = error;
                const shouldRetry = isLiveKitEngineTimeoutError(error)
                    && attempt < LIVEKIT_PUBLISH_RETRY_LIMIT
                    && room?.state !== liveKitApi.ConnectionState.Disconnected;

                if (!shouldRetry) {
                    break;
                }

                await waitForDelay(LIVEKIT_PUBLISH_RETRY_DELAY_MS * attempt);
            }
        }

        return {
            kind,
            enabled: false,
            error: lastError,
        };
    };

    const connectSupportRoom = async ({ session, nextContext, status = 'calling' }) => {
        const liveKitApi = await loadLiveKitModule();
        const { Room, RoomEvent, Track } = liveKitApi;
        const room = new Room();
        const mediaMode = normalizeLiveCallMediaMode(session?.mediaMode || nextContext?.mediaMode);
        supportRoomRef.current = room;
        supportSessionRef.current = session;
        supportMarkedConnectedRef.current = false;
        setRoomConnectionState('connecting');
        setRemoteParticipantCount(0);

        room.on(RoomEvent.LocalTrackPublished, () => {
            void syncSupportRoomState(room, Track);
        });
        room.on(RoomEvent.LocalTrackUnpublished, () => {
            void syncSupportRoomState(room, Track);
        });
        room.on(RoomEvent.TrackSubscribed, () => {
            void syncSupportRoomState(room, Track);
        });
        room.on(RoomEvent.TrackUnsubscribed, () => {
            void syncSupportRoomState(room, Track);
        });
        room.on(RoomEvent.ParticipantConnected, () => {
            void syncSupportRoomState(room, Track);
        });
        room.on(RoomEvent.ParticipantDisconnected, () => {
            void syncSupportRoomState(room, Track);
        });
        if (RoomEvent.Reconnecting) {
            room.on(RoomEvent.Reconnecting, () => {
                if (supportRoomRef.current === room) {
                    setRoomConnectionState('reconnecting');
                }
            });
        }
        if (RoomEvent.Reconnected) {
            room.on(RoomEvent.Reconnected, () => {
                if (supportRoomRef.current === room) {
                    setRoomConnectionState('connected');
                    void syncSupportRoomState(room, Track);
                }
            });
        }
        room.on(RoomEvent.Disconnected, () => {
            if (supportRoomRef.current === room) {
                void cleanupCallState({ disconnectSupportRoom: false });
            }
        });
        room.on(RoomEvent.MediaDevicesError, (error) => {
            reportCallError(error?.message || 'Unable to access camera or microphone');
        });

        if (typeof room.prepareConnection === 'function') {
            void room.prepareConnection(session.wsUrl, session.accessToken).catch(() => null);
        }

        await room.connect(session.wsUrl, session.accessToken);
        await waitForRoomConnected(room, liveKitApi);
        setRoomConnectionState('connected');

        const mediaResults = [];
        mediaResults.push(await enableRoomParticipantTrack({ room, liveKitApi, kind: 'microphone' }));
        if (mediaMode === 'video') {
            mediaResults.unshift(await enableRoomParticipantTrack({ room, liveKitApi, kind: 'camera' }));
        }
        const enabledMediaCount = mediaResults.filter((result) => result.enabled).length;
        if (enabledMediaCount === 0) {
            throw new Error(buildMediaPublishFailureMessage(mediaResults));
        }

        const warningMessage = buildMediaPublishWarning(mediaResults);
        if (warningMessage) {
            toast.warning(warningMessage);
        }

        const resolvedContext = {
            ...nextContext,
            mediaMode,
        };
        setActiveCallContext(resolvedContext);
        callContextRef.current = resolvedContext;
        setCallStatus(status);
        await syncSupportRoomState(room, Track);
    };

    const startLiveKitCall = async (targetOrRequest, listingId) => {
        const request = normalizeCallRequest(targetOrRequest, listingId);
        const contextId = String(
            request.channelType === 'support_ticket'
                ? (request.supportTicketId || request.contextId || '')
                : (request.listingId || request.contextId || '')
        ).trim();
        const shouldStartLiveKitSession = Boolean(
            request.channelType === 'listing'
            || isSupportAdmin
            || request.targetUserId
        );

        if (!contextId) {
            reportCallError(request.channelType === 'support_ticket'
                ? 'Support live call is missing a ticket context.'
                : 'Live inspection is missing a listing context.');
            return false;
        }

        try {
            setCallError('');
            setCallerInfo(request.callerName ? { name: request.callerName } : null);
            setRoomConnectionState('connecting');
            setRemoteParticipantCount(0);
            setActiveCallContext({
                ...request,
                supportTicketId: request.channelType === 'support_ticket' ? contextId : '',
                listingId: request.channelType === 'listing' ? contextId : request.listingId,
                contextId,
                transport: 'livekit',
            });
            callContextRef.current = {
                ...request,
                supportTicketId: request.channelType === 'support_ticket' ? contextId : '',
                listingId: request.channelType === 'listing' ? contextId : request.listingId,
                contextId,
                transport: 'livekit',
            };
            setCallStatus('calling');

            const liveKitApi = getLiveKitApi(request.channelType);
            const response = shouldStartLiveKitSession
                ? await liveKitApi.start(contextId, {
                    mediaMode: request.mediaMode,
                })
                : await liveKitApi.join(contextId, {
                    sessionKey: request.sessionKey || undefined,
                    mediaMode: request.mediaMode,
                });

            const session = readLiveCallMeta(response);
            if (!session?.accessToken || !session?.wsUrl || !session?.sessionKey) {
                throw new Error(request.channelType === 'support_ticket'
                    ? 'Support live call session details are missing.'
                    : 'Live inspection session details are missing.');
            }

            const nextContext = {
                ...request,
                supportTicketId: request.channelType === 'support_ticket' ? contextId : '',
                listingId: request.channelType === 'listing' ? contextId : request.listingId,
                contextId,
                contextLabel: String(session.contextLabel || request.contextLabel || '').trim(),
                transport: 'livekit',
                sessionKey: String(session.sessionKey || '').trim(),
                roomName: String(session.roomName || '').trim(),
                mediaMode: normalizeLiveCallMediaMode(session.mediaMode || request.mediaMode),
            };

            await connectSupportRoom({
                session,
                nextContext,
                status: 'calling',
            });
            return true;
        } catch (error) {
            console.error('LiveKit: Failed to start call', error);
            reportCallError(error?.message || (request.channelType === 'support_ticket'
                ? 'Failed to start live support call'
                : 'Failed to start live inspection'));

            if (shouldStartLiveKitSession && contextId && supportSessionRef.current?.sessionKey) {
                const liveKitApi = getLiveKitApi(request.channelType);
                await liveKitApi.end(contextId, {
                    sessionKey: supportSessionRef.current.sessionKey,
                    reason: 'failed',
                }).catch(() => null);
            }

            await cleanupCallState({ preserveError: true });
            return false;
        }
    };

    const joinLiveKitCall = async (targetOrRequest) => {
        const request = normalizeCallRequest(targetOrRequest, '');
        const contextId = String(
            request.channelType === 'support_ticket'
                ? (request.supportTicketId || request.contextId || '')
                : (request.listingId || request.contextId || '')
        ).trim();

        if (!contextId) {
            reportCallError(request.channelType === 'support_ticket'
                ? 'Support live call is missing a ticket context.'
                : 'Live inspection is missing a listing context.');
            return false;
        }

        try {
            setCallError('');
            setCallerInfo((previous) => previous || {
                name: request.callerName || (request.channelType === 'support_ticket' ? 'Aura Support' : 'Marketplace user'),
            });
            setRoomConnectionState('connecting');
            setRemoteParticipantCount(0);
            setActiveCallContext({
                ...request,
                supportTicketId: request.channelType === 'support_ticket' ? contextId : '',
                listingId: request.channelType === 'listing' ? contextId : request.listingId,
                contextId,
                transport: 'livekit',
            });
            callContextRef.current = {
                ...request,
                supportTicketId: request.channelType === 'support_ticket' ? contextId : '',
                listingId: request.channelType === 'listing' ? contextId : request.listingId,
                contextId,
                transport: 'livekit',
            };
            setCallStatus('calling');

            const liveKitApi = getLiveKitApi(request.channelType);
            const response = await liveKitApi.join(contextId, {
                sessionKey: request.sessionKey || undefined,
                mediaMode: request.mediaMode,
            });
            const session = readLiveCallMeta(response);

            if (!session?.accessToken || !session?.wsUrl || !session?.sessionKey) {
                throw new Error(request.channelType === 'support_ticket'
                    ? 'Support live call session details are missing.'
                    : 'Live inspection session details are missing.');
            }

            const nextContext = {
                ...request,
                supportTicketId: request.channelType === 'support_ticket' ? contextId : '',
                listingId: request.channelType === 'listing' ? contextId : request.listingId,
                contextId,
                contextLabel: String(session.contextLabel || request.contextLabel || '').trim(),
                transport: 'livekit',
                sessionKey: String(session.sessionKey || '').trim(),
                roomName: String(session.roomName || '').trim(),
                mediaMode: normalizeLiveCallMediaMode(session.mediaMode || request.mediaMode),
            };

            await connectSupportRoom({
                session,
                nextContext,
                status: 'calling',
            });
            return true;
        } catch (error) {
            console.error('LiveKit: Failed to join call', error);
            reportCallError(error?.message || (request.channelType === 'support_ticket'
                ? 'Failed to join live support call'
                : 'Failed to join live inspection'));
            await cleanupCallState({ preserveError: true });
            return false;
        }
    };

    const terminateLiveKitCall = async ({ reason = 'hangup', preserveError = false } = {}) => {
        const activeContext = callContextRef.current;
        const contextId = String(
            activeContext?.channelType === 'support_ticket'
                ? (activeContext?.supportTicketId || activeContext?.contextId || '')
                : (activeContext?.listingId || activeContext?.contextId || '')
        ).trim();
        const sessionKey = String(
            supportSessionRef.current?.sessionKey
            || activeContext?.sessionKey
            || ''
        ).trim();

        if (supportEndingRef.current) {
            return true;
        }

        supportEndingRef.current = true;
        try {
            if (contextId) {
                const liveKitApi = getLiveKitApi(activeContext?.channelType);
                await liveKitApi.end(contextId, {
                    sessionKey: sessionKey || undefined,
                    reason,
                });
            }
            await cleanupCallState({ preserveError });
            return true;
        } catch (error) {
            console.error('LiveKit: Failed to end call', error);
            reportCallError(error?.message || (activeContext?.channelType === 'support_ticket'
                ? 'Failed to end live support call'
                : 'Failed to end live inspection'));
            await cleanupCallState({ preserveError: true });
            return false;
        }
    };

    const startCall = async (targetOrRequest, listingId) => {
        return startLiveKitCall(targetOrRequest, listingId);
    };

    const answerCall = async () => {
        if (!callContextRef.current) {
            reportCallError('There is no live call waiting to be answered.');
            return false;
        }

        return joinLiveKitCall(callContextRef.current);
    };

    const hangUp = async () => {
        const nextReason = callStatusRef.current === 'incoming'
            ? 'declined'
            : callStatusRef.current === 'calling'
                ? 'missed'
                : 'hangup';
        return terminateLiveKitCall({ reason: nextReason });
    };

    const switchCamera = useCallback(async () => {
        if (switchingCamera) {
            return false;
        }

        if (normalizeLiveCallMediaMode(callContextRef.current?.mediaMode) !== 'video') {
            toast.error('Camera switching is available during video calls only.');
            return false;
        }

        const room = supportRoomRef.current;
        if (!room || typeof room.switchActiveDevice !== 'function') {
            toast.error('Camera switching is not available in this call yet.');
            return false;
        }

        const devices = await refreshVideoInputDevices();
        const nextDevices = Array.isArray(devices) && devices.length > 0 ? devices : videoInputDevices;
        if (nextDevices.length < 2) {
            toast.error('Connect another camera to switch video input.');
            return false;
        }

        const currentDeviceId = String(activeVideoInputId || getVideoTrackDeviceId(localStreamRef.current) || '').trim();
        const currentIndex = nextDevices.findIndex((device) => String(device.deviceId || '') === currentDeviceId);
        const nextIndex = currentIndex >= 0
            ? (currentIndex + 1) % nextDevices.length
            : 0;
        const nextDevice = nextDevices[nextIndex];

        if (!nextDevice?.deviceId || String(nextDevice.deviceId) === currentDeviceId) {
            return false;
        }

        try {
            setSwitchingCamera(true);
            await room.switchActiveDevice('videoinput', nextDevice.deviceId);
            await waitForDelay(250);
            const liveKitApi = await loadLiveKitModule();
            await syncSupportRoomState(room, liveKitApi.Track);
            await refreshVideoInputDevices();
            toast.success(`Switched to ${nextDevice.label || 'next camera'}`);
            return true;
        } catch (error) {
            console.error('LiveKit: Failed to switch camera', error);
            toast.error(error?.message || 'Unable to switch camera');
            return false;
        } finally {
            setSwitchingCamera(false);
        }
    }, [activeVideoInputId, refreshVideoInputDevices, switchingCamera, videoInputDevices]);

    useEffect(() => {
        if (!socket) return undefined;

        const handleIncoming = (payload) => {
            const nextContext = {
                channelType: payload.channelType === 'support_ticket' ? 'support_ticket' : 'listing',
                contextId: String(payload.contextId || payload.listingId || payload.supportTicketId || ''),
                listingId: String(payload.listingId || ''),
                supportTicketId: String(payload.supportTicketId || ''),
                contextLabel: String(payload.contextLabel || '').trim(),
                transport: String(payload.transport || 'livekit').trim() || 'livekit',
                sessionKey: String(payload.sessionKey || '').trim(),
                mediaMode: normalizeLiveCallMediaMode(payload.mediaMode),
            };

            setCallerInfo({ userId: payload.fromUserId, name: payload.fromName });
            setRoomConnectionState('idle');
            setRemoteParticipantCount(0);
            setActiveCallContext(nextContext);
            callContextRef.current = nextContext;
            setCallStatus('incoming');
            setCallError('');
        };

        const handleSupportTerminated = (payload = {}) => {
            const activeContext = callContextRef.current;
            if (!activeContext) {
                return;
            }

            const matchesContext = String(activeContext.contextId || '')
                === String(payload.contextId || payload.supportTicketId || payload.listingId || '');
            const matchesSession = !payload.sessionKey || String(activeContext.sessionKey || '') === String(payload.sessionKey || '');

            if (matchesContext && matchesSession) {
                void cleanupCallState();
            }
        };
        socket.on('support:video:incoming', handleIncoming);
        socket.on('support:video:terminated', handleSupportTerminated);
        socket.on('listing:video:incoming', handleIncoming);
        socket.on('listing:video:terminated', handleSupportTerminated);

        return () => {
            socket.off('support:video:incoming', handleIncoming);
            socket.off('support:video:terminated', handleSupportTerminated);
            socket.off('listing:video:incoming', handleIncoming);
            socket.off('listing:video:terminated', handleSupportTerminated);
        };
    }, [socket]);

    return (
        <VideoCallContext.Provider value={{
            startCall,
            joinCall: joinLiveKitCall,
            answerCall,
            hangUp,
            switchCamera,
            joinSupportCall: joinLiveKitCall,
            callStatus,
            activeListingId: activeCallContext?.listingId || null,
            activeCallContext,
            callerInfo,
            callError,
            callMeta: {
                roomConnectionState,
                remoteParticipantCount,
                participantCount: 1 + Number(remoteParticipantCount || 0),
                mediaMode: normalizeLiveCallMediaMode(activeCallContext?.mediaMode),
                canSwitchCamera: normalizeLiveCallMediaMode(activeCallContext?.mediaMode) === 'video' && videoInputDevices.length > 1,
                availableCameraCount: videoInputDevices.length,
                activeVideoInputId,
                switchingCamera,
            },
            clearCallError: () => setCallError(''),
        }}>
            {children}
            <VideoCallOverlay
                localStream={localStream}
                remoteStream={remoteStream}
                callStatus={callStatus}
                callerInfo={callerInfo}
                callContext={activeCallContext}
                callError={callError}
                callMeta={{
                    roomConnectionState,
                    remoteParticipantCount,
                    participantCount: 1 + Number(remoteParticipantCount || 0),
                    mediaMode: normalizeLiveCallMediaMode(activeCallContext?.mediaMode),
                    canSwitchCamera: normalizeLiveCallMediaMode(activeCallContext?.mediaMode) === 'video' && videoInputDevices.length > 1,
                    availableCameraCount: videoInputDevices.length,
                    activeVideoInputId,
                    switchingCamera,
                }}
                onAnswer={answerCall}
                onHangUp={hangUp}
                onSwitchCamera={switchCamera}
            />
        </VideoCallContext.Provider>
    );
};
