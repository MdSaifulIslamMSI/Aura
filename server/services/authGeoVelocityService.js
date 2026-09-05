const { getRedisClient, flags: redisFlags } = require('../config/redis');
const logger = require('../utils/logger');

// Server-side impossible-travel detection (A2). The risk engine consumed an
// `impossibleTravel` boolean that had no server producer (client/edge header
// only, detail literally 'geo_velocity_placeholder'). This module computes it
// from CloudFront viewer-country headers and a per-user last-seen record:
//
// - No geo headers (direct origin hits, tests, misconfigured edge) means NO
//   signal — never challenge on missing data, only on contradictory data.
// - A country change faster than MIN_FEASIBLE_TRAVEL_MS means impossible
//   travel. Same country (any city) never fires: city granularity without a
//   distance table is a false-positive machine.
// - Spoofed headers can only ADD friction (step-up), never remove it: the
//   signal feeds the risk score toward challenge, and CloudFront overwrites
//   these headers on the production path anyway.
// - State lives in Redis with a 30-day TTL and an in-memory fallback map with
//   lazy expiry. Observations are recorded pre-auth; poisoning the baseline
//   only ever escalates the attacker toward MFA, never past it.

const MIN_FEASIBLE_TRAVEL_MS = 4 * 60 * 60 * 1000;
const GEO_STATE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const GEO_STATE_PREFIX_SUFFIX = ':geo:velocity';

const safeString = (value) => String(value || '').trim();

const normalizeCountry = (value = '') => {
    const country = safeString(value).toUpperCase();
    return /^[A-Z]{2}$/.test(country) ? country : '';
};

const resolveRequestGeo = (req = {}) => {
    const headers = req.headers || {};
    const header = (name) => safeString(headers[name] || headers[name.toLowerCase()] || '');
    const country = normalizeCountry(
        header('cloudfront-viewer-country')
        || header('cf-ipcountry')
    );
    if (!country) return null;
    return { country };
};

const storeKey = (uid) => `${redisFlags.redisPrefix}:auth:${safeString(uid)}${GEO_STATE_PREFIX_SUFFIX}`;

const memoryGeoStates = new Map();

const readMemoryGeoState = (uid) => {
    const entry = memoryGeoStates.get(uid);
    if (!entry) return null;
    if (entry.seenAt + GEO_STATE_TTL_MS <= Date.now()) {
        memoryGeoStates.delete(uid);
        return null;
    }
    return entry;
};

const writeMemoryGeoState = (uid, state) => {
    memoryGeoStates.set(uid, state);
    if (memoryGeoStates.size > 5000) {
        const oldest = memoryGeoStates.keys().next().value;
        memoryGeoStates.delete(oldest);
    }
};

const isImpossibleTravel = ({ previous = null, current = null, elapsedMs = 0 } = {}) => {
    if (!previous?.country || !current?.country) return false;
    if (previous.country === current.country) return false;
    return Number(elapsedMs) < MIN_FEASIBLE_TRAVEL_MS;
};

// Evaluates the current request against the user's last-seen geography and
// records the current observation. Returns { impossibleTravel, previous }.
// Never throws: store failures degrade to "no signal".
const evaluateGeoVelocity = async ({ uid = '', req = {} } = {}) => {
    const current = resolveRequestGeo(req);
    const normalizedUid = safeString(uid);
    if (!current || !normalizedUid) {
        return { impossibleTravel: false, previous: null };
    }

    const now = Date.now();
    let previous = null;
    try {
        const client = getRedisClient();
        if (client && typeof client.sendCommand === 'function') {
            const raw = await client.sendCommand(['GET', storeKey(normalizedUid)]);
            if (raw) {
                try {
                    previous = JSON.parse(String(raw));
                } catch {
                    previous = null;
                }
            }
            await client.sendCommand([
                'SET',
                storeKey(normalizedUid),
                JSON.stringify({ country: current.country, seenAt: now }),
                'PX',
                String(GEO_STATE_TTL_MS),
            ]);
        } else {
            previous = readMemoryGeoState(normalizedUid);
            writeMemoryGeoState(normalizedUid, { country: current.country, seenAt: now });
        }
    } catch (error) {
        logger.warn('auth.geo_velocity_store_failed', { error: error?.message || 'unknown' });
        return { impossibleTravel: false, previous: null };
    }

    if (!previous?.country || !previous?.seenAt) {
        return { impossibleTravel: false, previous: null };
    }
    return {
        impossibleTravel: isImpossibleTravel({
            previous,
            current,
            elapsedMs: now - Number(previous.seenAt || 0),
        }),
        previous,
    };
};

module.exports = {
    MIN_FEASIBLE_TRAVEL_MS,
    GEO_STATE_TTL_MS,
    isImpossibleTravel,
    resolveRequestGeo,
    evaluateGeoVelocity,
};
