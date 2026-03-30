import {
    createContext,
    startTransition,
    useCallback,
    useContext,
    useEffect,
    useEffectEvent,
    useMemo,
    useRef,
    useState,
} from 'react';
import { useLocation } from 'react-router-dom';
import VoiceSearch from '@/components/shared/VoiceSearch';
import { useChatStore } from '@/store/chatStore';
import { useVideoCall } from './VideoCallContext';

const MultimodalAssistantContext = createContext(null);

const MAX_SESSION_EVENTS = 18;

const parseListingIdFromPath = (pathname = '') => {
    const match = String(pathname || '').match(/^\/listing\/([^/?#]+)/i);
    return match?.[1] ? String(match[1]).trim() : '';
};

const resolveRouteLabel = (pathname = '') => {
    const path = String(pathname || '').toLowerCase();

    if (path === '/') return 'Home feed';
    if (path.startsWith('/listing/')) return 'Marketplace listing';
    if (path.startsWith('/product/')) return 'Product detail';
    if (path.startsWith('/marketplace')) return 'Marketplace';
    if (path.startsWith('/cart')) return 'Cart';
    if (path.startsWith('/checkout')) return 'Checkout';
    if (path.startsWith('/orders')) return 'Orders';
    if (path.startsWith('/visual-search')) return 'Visual search';
    if (path.startsWith('/bundles')) return 'Smart bundles';
    if (path.startsWith('/mission-control')) return 'Mission control';
    if (path.startsWith('/compare')) return 'AI compare';
    return 'Shopping flow';
};

const normalizePermissionState = (value = 'prompt') => {
    const normalized = String(value || '').trim().toLowerCase();
    if (['granted', 'denied', 'prompt'].includes(normalized)) {
        return normalized;
    }
    return 'prompt';
};

const getNetworkProfile = () => {
    if (typeof navigator === 'undefined') {
        return {
            status: 'offline',
            profile: 'unknown',
        };
    }

    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    return {
        status: navigator.onLine ? 'online' : 'offline',
        profile: String(connection?.effectiveType || '').trim() || 'unknown',
    };
};

const queryPermissionState = async (name) => {
    if (!navigator?.permissions?.query) {
        return 'prompt';
    }

    try {
        const result = await navigator.permissions.query({ name });
        return normalizePermissionState(result?.state);
    } catch {
        return 'prompt';
    }
};

const createTimelineEvent = (payload = {}) => ({
    id: payload.id || `mm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: String(payload.title || 'Session update').trim(),
    detail: String(payload.detail || '').trim(),
    channel: String(payload.channel || 'system').trim() || 'system',
    tone: String(payload.tone || 'neutral').trim() || 'neutral',
    createdAt: Number(payload.createdAt || Date.now()),
});

export const useMultimodalAssistant = () => useContext(MultimodalAssistantContext);

export const MultimodalAssistantProvider = ({ children }) => {
    const location = useLocation();
    const { startCall, callStatus, activeCallContext, callerInfo, callMeta } = useVideoCall();

    const chatMessages = useChatStore((state) => state.messages);
    const chatMode = useChatStore((state) => state.mode);
    const chatStatus = useChatStore((state) => state.status);
    const inputValue = useChatStore((state) => state.inputValue);
    const chatContext = useChatStore((state) => state.context);
    const currentIntent = useChatStore((state) => state.currentIntent);
    const openChat = useChatStore((state) => state.open);

    const [isVoiceAssistantOpen, setIsVoiceAssistantOpen] = useState(false);
    const [voiceLaunchState, setVoiceLaunchState] = useState({
        initialCommand: '',
        origin: 'navigation',
        openedAt: 0,
    });
    const [sessionEvents, setSessionEvents] = useState([]);
    const [readiness, setReadiness] = useState({
        microphone: 'prompt',
        camera: 'prompt',
        network: 'online',
        networkProfile: 'unknown',
        browserSpeech: false,
    });

    const lastLoggedMessageIdRef = useRef('');
    const lastCallSignatureRef = useRef('');

    const routeContext = useMemo(() => {
        const listingId = parseListingIdFromPath(location.pathname);
        return {
            pathname: location.pathname,
            routeLabel: resolveRouteLabel(location.pathname),
            listingId,
            canLaunchInspection: Boolean(listingId),
        };
    }, [location.pathname]);

    const recordSessionEvent = useCallback((payload = {}) => {
        const nextEvent = createTimelineEvent(payload);
        startTransition(() => {
            setSessionEvents((previous) => [nextEvent, ...previous].slice(0, MAX_SESSION_EVENTS));
        });
    }, []);

    const captureChatEvent = useEffectEvent((message) => {
        if (!message?.role || !message?.id) return;

        const snippet = String(message.text || '').trim();
        recordSessionEvent({
            id: `chat-${message.id}`,
            channel: message.role === 'assistant' ? 'chat-assistant' : 'chat-user',
            tone: message.role === 'assistant' ? 'accent' : 'neutral',
            title: message.role === 'assistant' ? 'Assistant advanced the flow' : 'You updated the brief',
            detail: snippet || (message.role === 'assistant' ? 'Structured UI response updated the surface.' : 'A new multimodal brief is ready.'),
            createdAt: Number(message.createdAt || Date.now()),
        });
    });

    const refreshReadiness = useCallback(async () => {
        const [microphone, camera] = await Promise.all([
            queryPermissionState('microphone'),
            queryPermissionState('camera'),
        ]);
        const network = getNetworkProfile();

        setReadiness({
            microphone,
            camera,
            network: network.status,
            networkProfile: network.profile,
            browserSpeech: typeof window !== 'undefined'
                && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition),
        });
    }, []);

    useEffect(() => {
        void refreshReadiness();

        const handleNetworkChange = () => {
            void refreshReadiness();
        };

        window.addEventListener('online', handleNetworkChange);
        window.addEventListener('offline', handleNetworkChange);

        const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        connection?.addEventListener?.('change', handleNetworkChange);

        return () => {
            window.removeEventListener('online', handleNetworkChange);
            window.removeEventListener('offline', handleNetworkChange);
            connection?.removeEventListener?.('change', handleNetworkChange);
        };
    }, [refreshReadiness]);

    useEffect(() => {
        const latestMessage = chatMessages[chatMessages.length - 1];
        if (!latestMessage?.id || latestMessage.id === lastLoggedMessageIdRef.current) {
            return;
        }

        lastLoggedMessageIdRef.current = latestMessage.id;
        captureChatEvent(latestMessage);
    }, [captureChatEvent, chatMessages]);

    useEffect(() => {
        const signature = [
            callStatus,
            activeCallContext?.contextId || '',
            activeCallContext?.mediaMode || '',
            callerInfo?.name || '',
        ].join(':');

        if (signature === lastCallSignatureRef.current) {
            return;
        }

        lastCallSignatureRef.current = signature;
        if (callStatus === 'idle') {
            return;
        }

        const mediaLabel = activeCallContext?.mediaMode === 'voice' ? 'voice' : 'video';
        const counterpart = callerInfo?.name || 'Marketplace counterpart';
        const tone = callStatus === 'connected' ? 'success' : callStatus === 'incoming' ? 'accent' : 'neutral';
        const title = callStatus === 'connected'
            ? `${mediaLabel === 'voice' ? 'Voice' : 'Video'} lane connected`
            : callStatus === 'incoming'
                ? `Incoming ${mediaLabel} lane`
                : `Launching ${mediaLabel} lane`;

        recordSessionEvent({
            channel: `call-${mediaLabel}`,
            tone,
            title,
            detail: `${counterpart}${activeCallContext?.contextLabel ? ` | ${activeCallContext.contextLabel}` : ''}`,
        });
    }, [
        activeCallContext?.contextId,
        activeCallContext?.contextLabel,
        activeCallContext?.mediaMode,
        callStatus,
        callerInfo?.name,
        recordSessionEvent,
    ]);

    const closeVoiceAssistant = useCallback(() => {
        setIsVoiceAssistantOpen(false);
        setVoiceLaunchState({
            initialCommand: '',
            origin: 'navigation',
            openedAt: 0,
        });
    }, []);

    const openVoiceAssistant = useCallback((options = {}) => {
        const initialCommand = String(options.initialCommand ?? '').trim();
        const origin = String(options.origin || 'navigation').trim() || 'navigation';

        setVoiceLaunchState({
            initialCommand,
            origin,
            openedAt: Date.now(),
        });
        setIsVoiceAssistantOpen(true);

        recordSessionEvent({
            channel: 'voice',
            tone: 'accent',
            title: 'Voice copilot armed',
            detail: initialCommand || `Opened from ${origin.replace(/_/g, ' ')}.`,
        });
    }, [recordSessionEvent]);

    const openChatAssistant = useCallback(() => {
        closeVoiceAssistant();
        openChat();
        recordSessionEvent({
            channel: 'chat',
            tone: 'accent',
            title: 'Chat resumed',
            detail: 'The multimodal brief is now back inside the assistant panel.',
        });
    }, [closeVoiceAssistant, openChat, recordSessionEvent]);

    const startContextualCall = useCallback(async ({ mediaMode = 'video', source = 'multimodal_dock' } = {}) => {
        if (!routeContext.canLaunchInspection || !routeContext.listingId) {
            recordSessionEvent({
                channel: 'call-routing',
                tone: 'warning',
                title: 'Live inspection needs a listing',
                detail: 'Open a marketplace listing to launch a voice or video inspection lane.',
            });
            return false;
        }

        closeVoiceAssistant();
        const callTarget = {
            channelType: 'listing',
            listingId: routeContext.listingId,
            contextId: routeContext.listingId,
            contextLabel: `${routeContext.routeLabel} live inspection`,
            callerName: 'Marketplace peer',
            mediaMode,
        };

        const success = await startCall(callTarget, routeContext.listingId);

        recordSessionEvent({
            channel: mediaMode === 'voice' ? 'call-voice' : 'call-video',
            tone: success ? 'success' : 'warning',
            title: success
                ? `Live ${mediaMode} lane launched`
                : `Live ${mediaMode} lane failed`,
            detail: success
                ? `Opened from ${source.replace(/_/g, ' ')} on ${routeContext.routeLabel.toLowerCase()}.`
                : 'The listing lane did not finish connecting. Try again in a moment.',
        });

        return success;
    }, [closeVoiceAssistant, recordSessionEvent, routeContext.canLaunchInspection, routeContext.listingId, routeContext.routeLabel, startCall]);

    const handleVoiceTelemetry = useCallback((event = {}) => {
        const type = String(event.type || '').trim();
        if (!type) return;

        if (type === 'session_ready') {
            recordSessionEvent({
                channel: 'voice',
                tone: 'success',
                title: 'Voice engine ready',
                detail: `${event.provider || 'Browser'} speech stack is warmed up for ${event.locale || 'your locale'}.`,
            });
            return;
        }

        if (type === 'command_submitted') {
            recordSessionEvent({
                channel: 'voice',
                tone: 'accent',
                title: 'Voice brief captured',
                detail: String(event.transcript || '').trim() || 'A live voice prompt was captured.',
            });
            return;
        }

        if (type === 'command_completed') {
            recordSessionEvent({
                channel: 'voice',
                tone: 'success',
                title: 'Voice command resolved',
                detail: String(event.answer || event.transcript || '').trim() || 'The voice assistant completed a command.',
            });
            return;
        }

        if (type === 'command_fallback') {
            recordSessionEvent({
                channel: 'voice',
                tone: 'warning',
                title: 'Voice fallback engaged',
                detail: String(event.transcript || '').trim() || 'The assistant fell back to local voice handling.',
            });
        }
    }, [recordSessionEvent]);

    const continuityContext = useMemo(() => ({
        routeLabel: routeContext.routeLabel,
        lastQuery: String(chatContext.lastQuery || '').trim(),
        activeProductId: String(chatContext.activeProductId || '').trim(),
        cartCount: Number(chatContext.cartCount || 0),
        listingId: routeContext.listingId,
        canLaunchInspection: routeContext.canLaunchInspection,
        chatMode,
        chatStatus,
        currentIntent: String(currentIntent || chatContext.sessionMemory?.currentIntent || '').trim(),
        inputValue: String(inputValue || '').trim(),
        activeCallStatus: callStatus,
    }), [
        callStatus,
        chatContext.activeProductId,
        chatContext.cartCount,
        chatContext.lastQuery,
        chatContext.sessionMemory?.currentIntent,
        chatMode,
        chatStatus,
        currentIntent,
        inputValue,
        routeContext.canLaunchInspection,
        routeContext.listingId,
        routeContext.routeLabel,
    ]);

    const activeChannel = callStatus !== 'idle'
        ? activeCallContext?.mediaMode === 'voice'
            ? 'live-voice'
            : 'live-video'
        : isVoiceAssistantOpen
            ? 'voice'
            : 'chat';

    const value = useMemo(() => ({
        activeChannel,
        activeCallSummary: {
            active: callStatus !== 'idle',
            status: callStatus,
            mediaMode: activeCallContext?.mediaMode === 'voice' ? 'voice' : 'video',
            label: String(activeCallContext?.contextLabel || '').trim(),
            remoteParticipantCount: Number(callMeta?.remoteParticipantCount || 0),
        },
        continuityContext,
        isVoiceAssistantOpen,
        openChatAssistant,
        openVoiceAssistant,
        closeVoiceAssistant,
        readiness,
        routeContext,
        sessionEvents,
        startContextualCall,
    }), [
        activeCallContext?.contextLabel,
        activeCallContext?.mediaMode,
        activeChannel,
        callMeta?.remoteParticipantCount,
        callStatus,
        continuityContext,
        isVoiceAssistantOpen,
        openChatAssistant,
        openVoiceAssistant,
        closeVoiceAssistant,
        readiness,
        routeContext,
        sessionEvents,
        startContextualCall,
    ]);

    return (
        <MultimodalAssistantContext.Provider value={value}>
            {children}
            {isVoiceAssistantOpen ? (
                <VoiceSearch
                    key={`multimodal-voice-${voiceLaunchState.openedAt || 'idle'}`}
                    initialCommand={voiceLaunchState.initialCommand}
                    handoffContext={continuityContext}
                    onClose={closeVoiceAssistant}
                    onOpenChat={openChatAssistant}
                    onTelemetryEvent={handleVoiceTelemetry}
                />
            ) : null}
        </MultimodalAssistantContext.Provider>
    );
};

export default MultimodalAssistantProvider;
