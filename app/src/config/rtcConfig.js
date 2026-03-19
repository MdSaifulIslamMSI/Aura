const DEFAULT_ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
];

const normalizeIceServer = (entry) => {
    if (!entry || typeof entry !== 'object') return null;

    const urls = Array.isArray(entry.urls)
        ? entry.urls.map((value) => String(value || '').trim()).filter(Boolean)
        : String(entry.urls || '').trim();

    if ((!Array.isArray(urls) && !urls) || (Array.isArray(urls) && urls.length === 0)) {
        return null;
    }

    return {
        urls,
        ...(entry.username ? { username: String(entry.username) } : {}),
        ...(entry.credential ? { credential: String(entry.credential) } : {}),
    };
};

const parseIceServers = () => {
    const raw = String(import.meta.env.VITE_WEBRTC_ICE_SERVERS_JSON || '').trim();
    if (!raw) return DEFAULT_ICE_SERVERS;

    try {
        const parsed = JSON.parse(raw);
        const normalized = (Array.isArray(parsed) ? parsed : [])
            .map(normalizeIceServer)
            .filter(Boolean);
        return normalized.length > 0 ? normalized : DEFAULT_ICE_SERVERS;
    } catch {
        return DEFAULT_ICE_SERVERS;
    }
};

export const RTC_ICE_SERVERS = parseIceServers();
export const RTC_PEER_CONFIG = {
    iceServers: RTC_ICE_SERVERS,
};
export const RTC_HAS_CUSTOM_RELAY = String(import.meta.env.VITE_WEBRTC_ICE_SERVERS_JSON || '').trim().length > 0;
