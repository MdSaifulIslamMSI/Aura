const GEOLOCATION_TIMEOUT_MS = 12000;
const GEOLOCATION_MAX_AGE_MS = 60_000;
const REVERSE_GEOCODE_TIMEOUT_MS = 9500;
const REVERSE_GEOCODE_PRIMARY_ENDPOINT = 'https://api.bigdatacloud.net/data/reverse-geocode-client';
const REVERSE_GEOCODE_SECONDARY_ENDPOINT = 'https://nominatim.openstreetmap.org/reverse';
const REVERSE_CACHE_KEY = 'aura_geo_reverse_cache_v2';
const REVERSE_CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_CACHE_ITEMS = 24;

const asCleanText = (value) => {
    const normalized = String(value || '').trim();
    return normalized || '';
};

const roundTo = (value, precision = 4) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    const factor = 10 ** precision;
    return Math.round(numeric * factor) / factor;
};

const buildCoordinateKey = (latitude, longitude) => `${roundTo(latitude, 3)}:${roundTo(longitude, 3)}`;

const readReverseCache = () => {
    if (typeof window === 'undefined') return [];
    try {
        const parsed = JSON.parse(window.localStorage.getItem(REVERSE_CACHE_KEY) || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

const writeReverseCache = (entries) => {
    if (typeof window === 'undefined') return;
    try {
        const safeEntries = Array.isArray(entries) ? entries.slice(0, MAX_CACHE_ITEMS) : [];
        window.localStorage.setItem(REVERSE_CACHE_KEY, JSON.stringify(safeEntries));
    } catch {
        // Ignore cache write failures to keep GPS flow resilient.
    }
};

const getCachedReverseResult = (latitude, longitude) => {
    const key = buildCoordinateKey(latitude, longitude);
    const now = Date.now();
    const entries = readReverseCache()
        .filter((entry) => entry?.key && Number(entry.expiresAt || 0) > now);

    if (entries.length === 0) {
        writeReverseCache([]);
        return null;
    }

    writeReverseCache(entries);
    const cached = entries.find((entry) => entry.key === key);
    return cached?.value || null;
};

const putCachedReverseResult = (latitude, longitude, value) => {
    const now = Date.now();
    const key = buildCoordinateKey(latitude, longitude);
    const entry = {
        key,
        expiresAt: now + REVERSE_CACHE_TTL_MS,
        value,
    };

    const entries = readReverseCache()
        .filter((item) => item?.key && Number(item.expiresAt || 0) > now && item.key !== key);

    entries.unshift(entry);
    writeReverseCache(entries);
};

const mapGeolocationError = (error) => {
    switch (error?.code) {
        case 1:
            return 'Location permission denied. Allow location access and try again.';
        case 2:
            return 'Your location is unavailable right now. Try again in a moment.';
        case 3:
            return 'Location request timed out. Please retry.';
        default:
            return 'Could not detect your location.';
    }
};

const getLocationAttempt = (profile) =>
    new Promise((resolve, reject) => {
        if (typeof navigator === 'undefined' || !navigator?.geolocation) {
            reject(new Error('GPS is not supported in this browser.'));
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (position) =>
                resolve({
                    latitude: Number(position?.coords?.latitude),
                    longitude: Number(position?.coords?.longitude),
                    accuracy: Number(position?.coords?.accuracy || 0),
                    altitude: Number(position?.coords?.altitude || 0),
                    heading: Number(position?.coords?.heading || 0),
                    speed: Number(position?.coords?.speed || 0),
                    positionSource: profile?.source || 'gps',
                    capturedAt: new Date().toISOString(),
                }),
            (error) => reject(new Error(mapGeolocationError(error))),
            {
                enableHighAccuracy: profile.enableHighAccuracy,
                timeout: profile.timeout,
                maximumAge: profile.maximumAge,
            }
        );
    });

const getLocationFromBrowser = async (options = {}) => {
    const profiles = [
        {
            source: 'gps_precise',
            enableHighAccuracy: true,
            timeout: Number(options.timeoutMs) || GEOLOCATION_TIMEOUT_MS,
            maximumAge: Number(options.maximumAgeMs) || GEOLOCATION_MAX_AGE_MS,
        },
        {
            source: 'network_fallback',
            enableHighAccuracy: false,
            timeout: Math.max(6000, Math.floor((Number(options.timeoutMs) || GEOLOCATION_TIMEOUT_MS) * 0.75)),
            maximumAge: Math.max(120_000, Number(options.maximumAgeMs) || GEOLOCATION_MAX_AGE_MS),
        },
    ];

    let lastError = null;
    for (const profile of profiles) {
        try {
            const result = await getLocationAttempt(profile);
            if (Number.isFinite(result.latitude) && Number.isFinite(result.longitude)) {
                return result;
            }
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError || new Error('Could not detect your location.');
};

const computeGpsConfidence = (accuracy, geocodeFieldsScore, isFromFallback) => {
    const numericAccuracy = Number(accuracy);
    let accuracyScore = 35;
    if (numericAccuracy > 0 && numericAccuracy <= 20) accuracyScore = 95;
    else if (numericAccuracy <= 50) accuracyScore = 85;
    else if (numericAccuracy <= 100) accuracyScore = 75;
    else if (numericAccuracy <= 250) accuracyScore = 60;
    else if (numericAccuracy <= 500) accuracyScore = 50;
    else if (numericAccuracy <= 1000) accuracyScore = 40;

    const confidence = Math.round((accuracyScore * 0.62) + (geocodeFieldsScore * 0.38) - (isFromFallback ? 6 : 0));
    return Math.max(1, Math.min(99, confidence));
};

const mapBigDataCloudResponse = (data) => {
    const city = asCleanText(data.city) || asCleanText(data.locality) || asCleanText(data.localityName);
    const state = asCleanText(data.principalSubdivision) || asCleanText(data.localityInfo?.administrative?.[0]?.name);
    const pincode = asCleanText(data.postcode);
    const country = asCleanText(data.countryName);

    return {
        city: city || state,
        state: state || city,
        pincode,
        country,
    };
};

const mapNominatimResponse = (data) => {
    const address = data?.address || {};
    const city = asCleanText(address.city) || asCleanText(address.town) || asCleanText(address.village) || asCleanText(address.municipality);
    const state = asCleanText(address.state) || asCleanText(address.state_district) || asCleanText(address.region);
    const pincode = asCleanText(address.postcode);
    const country = asCleanText(address.country);

    return {
        city: city || state,
        state: state || city,
        pincode,
        country,
    };
};

const timedFetchJson = async (url, timeoutMs, headers = {}) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            signal: controller.signal,
            headers,
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        return await response.json();
    } finally {
        clearTimeout(timeoutId);
    }
};

const reverseGeocodeWithFallback = async ({ latitude, longitude }) => {
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        throw new Error('Invalid coordinates provided for reverse geocoding.');
    }

    const cached = getCachedReverseResult(lat, lng);
    if (cached) {
        return {
            ...cached,
            isFromCache: true,
        };
    }

    const providers = [
        {
            name: 'bigdatacloud',
            resolve: async () => {
                const url = `${REVERSE_GEOCODE_PRIMARY_ENDPOINT}?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(
                    lng
                )}&localityLanguage=en`;
                const data = await timedFetchJson(url, REVERSE_GEOCODE_TIMEOUT_MS);
                return mapBigDataCloudResponse(data);
            },
        },
        {
            name: 'nominatim',
            resolve: async () => {
                const url = `${REVERSE_GEOCODE_SECONDARY_ENDPOINT}?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(
                    lng
                )}&accept-language=en`;
                const data = await timedFetchJson(url, REVERSE_GEOCODE_TIMEOUT_MS, {
                    Accept: 'application/json',
                });
                return mapNominatimResponse(data);
            },
        },
    ];

    let lastError = null;
    for (const provider of providers) {
        try {
            const mapped = await provider.resolve();
            if (mapped?.city || mapped?.state) {
                const resolved = {
                    ...mapped,
                    latitude: lat,
                    longitude: lng,
                    geocodeSource: provider.name,
                    isFromCache: false,
                };
                putCachedReverseResult(lat, lng, resolved);
                return resolved;
            }
        } catch (error) {
            lastError = error;
        }
    }

    if (lastError?.name === 'AbortError') {
        throw new Error('Location lookup timed out. Please retry.');
    }
    throw new Error('Could not map GPS coordinates to a city/state.');
};

export const reverseGeocodeCoordinates = async ({ latitude, longitude }) =>
    reverseGeocodeWithFallback({ latitude, longitude });

export const detectLocationFromGps = async (options = {}) => {
    const coordinates = await getLocationFromBrowser(options);
    const resolved = await reverseGeocodeWithFallback(coordinates);

    const geocodeFieldsScore = [
        resolved.city ? 35 : 0,
        resolved.state ? 35 : 0,
        resolved.pincode ? 15 : 0,
        resolved.country ? 15 : 0,
    ].reduce((sum, value) => sum + value, 0);

    const confidence = computeGpsConfidence(
        coordinates.accuracy,
        geocodeFieldsScore,
        coordinates.positionSource === 'network_fallback'
    );

    return {
        city: resolved.city || '',
        state: resolved.state || '',
        pincode: resolved.pincode || '',
        country: resolved.country || '',
        latitude: roundTo(coordinates.latitude, 6),
        longitude: roundTo(coordinates.longitude, 6),
        accuracy: Number(coordinates.accuracy || 0),
        confidence,
        positionSource: coordinates.positionSource || 'gps',
        geocodeSource: resolved.geocodeSource || 'unknown',
        isFromCache: Boolean(resolved.isFromCache),
        capturedAt: coordinates.capturedAt || new Date().toISOString(),
    };
};
