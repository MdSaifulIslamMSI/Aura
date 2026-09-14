// SIMULATED serviceability data. This zone matrix is a placeholder for a real
// courier serviceability feed — the shape of the response is what the
// storefront and the order deliveryPromise field will keep consuming once a
// real provider lands. Zones map by the first two pincode digits.
const ZONE_MATRIX = [
    { zone: 'metro', prefixes: ['11', '40', '56', '60', '70'], standardDays: 2, expressDays: 1 },
    { zone: 'tier2', prefixes: ['30', '38', '41', '46', '50', '52', '53', '54', '58', '62', '63', '64', '68'], standardDays: 4, expressDays: 2 },
    { zone: 'tier3', prefixes: ['75', '76', '77', '78', '79', '80', '81', '82', '83', '84', '85'], standardDays: 6, expressDays: 3 },
];

const DEFAULT_ZONE = { zone: 'rest-of-india', standardDays: 7, expressDays: 3 };
const MAX_ZONE_PREFIX = 99;

const resolveZone = (postalCode) => {
    const prefix = Number.parseInt(String(postalCode || '').slice(0, 2), 10);
    if (!Number.isSafeInteger(prefix) || prefix < 0 || prefix > MAX_ZONE_PREFIX) return DEFAULT_ZONE;
    const prefixKey = String(prefix).padStart(2, '0');
    return ZONE_MATRIX.find((entry) => entry.prefixes.includes(prefixKey)) || DEFAULT_ZONE;
};

/**
 * Checks pincode serviceability and derives the delivery promise. Always
 * serviceable in the simulated matrix; the zone (or an explicit
 * DENYLIST_PINCODE_PREFIXES env list) is where real carrier data will plug in.
 */
const checkServiceability = ({ postalCode, deliveryOption = 'standard', now = new Date() }) => {
    const normalized = String(postalCode || '').trim();
    if (!/^[0-9]{5,6}$/.test(normalized)) {
        return {
            serviceable: false,
            reason: 'invalid_postal_code',
            zone: '',
            estimatedDays: null,
            promisedDate: null,
            estimateText: '',
            source: 'simulated-zone-matrix',
        };
    }

    const denylist = String(process.env.DENYLIST_PINCODE_PREFIXES || '')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
    if (denylist.some((prefix) => normalized.startsWith(prefix))) {
        return {
            serviceable: false,
            reason: 'pincode_not_serviceable',
            zone: resolveZone(normalized).zone,
            estimatedDays: null,
            promisedDate: null,
            estimateText: 'Not serviceable',
            source: 'simulated-zone-matrix',
        };
    }

    const zoneInfo = resolveZone(normalized);
    const days = deliveryOption === 'express' ? zoneInfo.expressDays : zoneInfo.standardDays;
    const promisedDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    const estimateText = deliveryOption === 'express'
        ? `${zoneInfo.expressDays} day${zoneInfo.expressDays > 1 ? 's' : ''} (express)`
        : `${zoneInfo.standardDays} days (standard)`;

    return {
        serviceable: true,
        zone: zoneInfo.zone,
        estimatedDays: days,
        promisedDate,
        estimateText,
        source: 'simulated-zone-matrix',
    };
};

module.exports = {
    checkServiceability,
    resolveZone,
};
