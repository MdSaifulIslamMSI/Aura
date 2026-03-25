const { randomUUID } = require('crypto');
const { AccessToken, RoomServiceClient } = require('livekit-server-sdk');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');

const DEFAULT_TTL_SECONDS = 600;
const DEFAULT_SUPPORT_ROOM_PREFIX = 'aura-support';
const DEFAULT_LISTING_ROOM_PREFIX = 'aura-listing';

const normalizeText = (value) => String(value || '').trim();

const parsePositiveInteger = (value, fallback) => {
    const parsed = Number.parseInt(String(value || ''), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const normalizeUrlProtocol = (rawUrl, targetProtocol) => {
    const normalizedUrl = normalizeText(rawUrl);
    if (!normalizedUrl) {
        throw new AppError('LiveKit is not configured for support calls', 503);
    }

    let parsedUrl;
    try {
        parsedUrl = new URL(normalizedUrl);
    } catch {
        throw new AppError('LIVEKIT_URL must be a valid absolute URL', 500);
    }

    parsedUrl.protocol = targetProtocol;
    return parsedUrl.toString().replace(/\/$/, '');
};

const getLiveKitConfig = () => {
    const rawUrl = normalizeText(process.env.LIVEKIT_URL);
    const apiKey = normalizeText(process.env.LIVEKIT_API_KEY);
    const apiSecret = normalizeText(process.env.LIVEKIT_API_SECRET);

    if (!rawUrl || !apiKey || !apiSecret) {
        throw new AppError('LiveKit credentials are missing. Set LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET.', 503);
    }

    return {
        apiKey,
        apiSecret,
        apiUrl: normalizeUrlProtocol(rawUrl, rawUrl.startsWith('wss:') ? 'https:' : rawUrl.startsWith('ws:') ? 'http:' : new URL(rawUrl).protocol),
        wsUrl: normalizeUrlProtocol(rawUrl, rawUrl.startsWith('https:') ? 'wss:' : rawUrl.startsWith('http:') ? 'ws:' : new URL(rawUrl).protocol),
        ttlSeconds: parsePositiveInteger(process.env.LIVEKIT_TTL_SECONDS, DEFAULT_TTL_SECONDS),
        supportRoomPrefix: normalizeText(process.env.LIVEKIT_SUPPORT_ROOM_PREFIX) || DEFAULT_SUPPORT_ROOM_PREFIX,
        listingRoomPrefix: normalizeText(process.env.LIVEKIT_LISTING_ROOM_PREFIX) || DEFAULT_LISTING_ROOM_PREFIX,
    };
};

let roomServiceClient = null;
let roomServiceClientHost = '';

const getRoomServiceClient = () => {
    const config = getLiveKitConfig();
    if (!roomServiceClient || roomServiceClientHost !== config.apiUrl) {
        roomServiceClient = new RoomServiceClient(config.apiUrl, config.apiKey, config.apiSecret);
        roomServiceClientHost = config.apiUrl;
    }

    return {
        client: roomServiceClient,
        config,
    };
};

const buildRoomName = ({ prefix, entityId, fallbackLabel }) => {
    const safeEntityId = normalizeText(entityId).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48) || fallbackLabel;
    const uniqueSuffix = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
    return `${prefix}-${safeEntityId}-${uniqueSuffix}`.slice(0, 160);
};

const buildSupportRoomName = (ticketId) => {
    const { supportRoomPrefix } = getLiveKitConfig();
    return buildRoomName({
        prefix: supportRoomPrefix,
        entityId: ticketId,
        fallbackLabel: 'ticket',
    });
};

const buildListingRoomName = (listingId) => {
    const { listingRoomPrefix } = getLiveKitConfig();
    return buildRoomName({
        prefix: listingRoomPrefix,
        entityId: listingId,
        fallbackLabel: 'listing',
    });
};

const ensureSupportRoom = async (roomName, metadata = {}) => {
    const normalizedRoomName = normalizeText(roomName);
    if (!normalizedRoomName) {
        throw new AppError('Support call room name is missing', 500);
    }

    const { client } = getRoomServiceClient();
    const metadataJson = JSON.stringify(metadata || {});

    try {
        await client.createRoom({
            name: normalizedRoomName,
            emptyTimeout: 60,
            departureTimeout: 20,
            maxParticipants: 2,
            metadata: metadataJson,
        });
    } catch (error) {
        const reason = String(error?.message || '').toLowerCase();
        if (!reason.includes('already exists')) {
            throw error;
        }
    }

    return normalizedRoomName;
};

const buildSupportParticipantIdentity = ({ ticketId, userId, role }) => (
    `support-${normalizeText(role) || 'participant'}-${normalizeText(ticketId)}-${normalizeText(userId)}`.slice(0, 200)
);

const createSupportParticipantSession = async ({
    ticketId,
    roomName,
    role,
    user,
    contextLabel = '',
}) => {
    const { apiKey, apiSecret, ttlSeconds, wsUrl } = getLiveKitConfig();
    const identity = buildSupportParticipantIdentity({
        ticketId,
        userId: user?._id || '',
        role,
    });

    const token = new AccessToken(apiKey, apiSecret, {
        identity,
        name: normalizeText(user?.name) || (role === 'admin' ? 'Aura Support' : 'Support User'),
        ttl: ttlSeconds,
        metadata: JSON.stringify({
            supportTicketId: String(ticketId || ''),
            role: normalizeText(role) || 'user',
        }),
        attributes: {
            supportTicketId: String(ticketId || ''),
            role: normalizeText(role) || 'user',
        },
    });

    token.addGrant({
        roomJoin: true,
        room: normalizeText(roomName),
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
    });

    return {
        accessToken: await token.toJwt(),
        wsUrl,
        roomName: normalizeText(roomName),
        sessionKey: normalizeText(roomName),
        participantIdentity: identity,
        participantName: normalizeText(user?.name) || (role === 'admin' ? 'Aura Support' : 'Support User'),
        role: normalizeText(role) || 'user',
        supportTicketId: String(ticketId || ''),
        contextLabel: normalizeText(contextLabel),
        expiresInSeconds: ttlSeconds,
    };
};

const deleteSupportRoom = async (roomName) => {
    const normalizedRoomName = normalizeText(roomName);
    if (!normalizedRoomName) return;

    const { client } = getRoomServiceClient();

    try {
        await client.deleteRoom(normalizedRoomName);
    } catch (error) {
        const reason = String(error?.message || '').toLowerCase();
        if (reason.includes('not found')) {
            return;
        }

        logger.warn('support.livekit_room_delete_failed', {
            roomName: normalizedRoomName,
            reason: error?.message || 'unknown',
        });
        throw error;
    }
};

module.exports = {
    buildListingRoomName,
    buildSupportRoomName,
    createSupportParticipantSession,
    deleteSupportRoom,
    ensureSupportRoom,
    getLiveKitConfig,
};
