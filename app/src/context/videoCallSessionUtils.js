export const normalizeLiveCallMediaMode = (value) => (
    String(value || '').trim().toLowerCase() === 'voice' ? 'voice' : 'video'
);

const EXPECTED_LIVEKIT_DISCONNECT_REASONS = new Set([1, 4, 5]);

const normalizeCallChannelType = (value) => (
    String(value || '').trim().toLowerCase() === 'support_ticket' ? 'support_ticket' : 'listing'
);

const normalizeContextId = (context = {}) => {
    const channelType = normalizeCallChannelType(context?.channelType);
    return String(
        channelType === 'support_ticket'
            ? (context?.supportTicketId || context?.contextId || '')
            : (context?.listingId || context?.contextId || '')
    ).trim();
};

const normalizeSessionKey = (context = {}) => String(context?.sessionKey || '').trim();

export const isSameLiveCallSession = (left, right) => {
    const leftContextId = normalizeContextId(left);
    const rightContextId = normalizeContextId(right);

    if (!leftContextId || !rightContextId) {
        return false;
    }

    if (normalizeCallChannelType(left?.channelType) !== normalizeCallChannelType(right?.channelType)) {
        return false;
    }

    const leftSessionKey = normalizeSessionKey(left);
    const rightSessionKey = normalizeSessionKey(right);

    if (leftSessionKey && rightSessionKey) {
        return leftContextId === rightContextId && leftSessionKey === rightSessionKey;
    }

    return leftContextId === rightContextId;
};

export const getIncomingCallDisposition = ({
    activeCallContext = null,
    callStatus = 'idle',
    nextContext = null,
} = {}) => {
    if (callStatus === 'idle' || !activeCallContext) {
        return 'accept';
    }

    return isSameLiveCallSession(activeCallContext, nextContext) ? 'duplicate' : 'busy';
};

export const shouldSynchronizeUnexpectedLiveKitDisconnect = (disconnectReason) => (
    !EXPECTED_LIVEKIT_DISCONNECT_REASONS.has(Number(disconnectReason))
);

export const getUnexpectedLiveKitDisconnectReason = ({
    callStatus = 'idle',
    roomConnectionState = 'idle',
    remoteParticipantCount = 0,
} = {}) => {
    const hasRemoteParticipants = Number(remoteParticipantCount || 0) > 0;
    const wasConnected = callStatus === 'connected'
        || roomConnectionState === 'connected'
        || roomConnectionState === 'reconnecting'
        || hasRemoteParticipants;

    return wasConnected ? 'connection_lost' : 'failed';
};
