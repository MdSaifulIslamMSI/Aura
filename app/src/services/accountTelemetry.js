import { pushClientDiagnostic } from './clientObservability';

export const ACCOUNT_TELEMETRY_EVENTS = Object.freeze({
    SECTION_VIEWED: 'account.section_viewed',
    PROFILE_UPDATED: 'account.profile_updated',
    ADDRESS_ADDED: 'account.address_added',
    PREFERENCE_CHANGED: 'account.preference_changed',
    ORDER_SEARCHED: 'account.order_searched',
    RETURN_STARTED: 'account.return_started',
    BUY_AGAIN_SELECTED: 'account.buy_again_selected',
    PASSKEY_ADDED: 'account.passkey_added',
    SESSION_REVOKED: 'account.session_revoked',
    EXPORT_REQUESTED: 'account.export_requested',
    DEACTIVATION_INITIATED: 'account.deactivation_initiated',
    DELETION_INITIATED: 'account.deletion_initiated',
    WEB_VITAL: 'account.web_vital',
});

const ACCOUNT_SECTIONS = new Set([
    'overview',
    'personal',
    'addresses',
    'orders',
    'rewards',
    'marketplace',
    'payments',
    'support',
    'notifications',
    'settings',
    'privacy',
]);
const PROFILE_FIELDS = new Set(['name', 'phone', 'dob', 'gender', 'bio']);
const ADDRESS_TYPES = new Set(['home', 'work', 'other']);
const PREFERENCE_TOPICS = new Set([
    'orderUpdates',
    'deliveryUpdates',
    'returnRefundUpdates',
    'marketplaceUpdates',
    'productAlerts',
    'marketing',
    'security',
]);
const PREFERENCE_CHANNELS = new Set(['email', 'sms', 'push']);
const ORDER_STATUSES = new Set(['', 'placed', 'processing', 'shipped', 'delivered', 'cancelled']);
const RETURN_RESOLUTIONS = new Set(['refund', 'replacement']);
const SESSION_SCOPES = new Set(['one', 'others', 'all', 'current']);
const WEB_VITAL_METRICS = new Set(['LCP', 'INP', 'CLS']);
const WEB_VITAL_RATINGS = new Set(['good', 'needs_improvement', 'poor']);
const NAVIGATION_TYPES = new Set(['navigate', 'reload', 'back_forward', 'prerender', 'unknown']);

const pick = (value, allowed, fallback = '') => {
    const normalized = String(value ?? '').trim();
    return allowed.has(normalized) ? normalized : fallback;
};

const getItemCountBucket = (value) => {
    const count = Math.max(0, Math.trunc(Number(value) || 0));
    if (count <= 1) return '1';
    if (count <= 5) return '2-5';
    return '6+';
};

const normalizeContext = {
    [ACCOUNT_TELEMETRY_EVENTS.SECTION_VIEWED]: (context) => {
        const section = pick(context.section, ACCOUNT_SECTIONS);
        return section ? { section } : null;
    },
    [ACCOUNT_TELEMETRY_EVENTS.PROFILE_UPDATED]: (context) => ({
        changedFields: [...new Set(
            (Array.isArray(context.changedFields) ? context.changedFields : [])
                .map((field) => pick(field, PROFILE_FIELDS))
                .filter(Boolean)
        )].slice(0, PROFILE_FIELDS.size),
    }),
    [ACCOUNT_TELEMETRY_EVENTS.ADDRESS_ADDED]: (context) => ({
        addressType: pick(context.addressType, ADDRESS_TYPES, 'other'),
    }),
    [ACCOUNT_TELEMETRY_EVENTS.PREFERENCE_CHANGED]: (context) => {
        const topic = pick(context.topic, PREFERENCE_TOPICS);
        const channel = pick(context.channel, PREFERENCE_CHANNELS);
        if (!topic || !channel || typeof context.enabled !== 'boolean') return null;
        return { topic, channel, enabled: context.enabled };
    },
    [ACCOUNT_TELEMETRY_EVENTS.ORDER_SEARCHED]: (context) => ({
        hasQuery: Boolean(context.hasQuery),
        status: pick(context.status, ORDER_STATUSES),
        hasDateRange: Boolean(context.hasDateRange),
    }),
    [ACCOUNT_TELEMETRY_EVENTS.RETURN_STARTED]: (context) => {
        const resolution = pick(context.resolution, RETURN_RESOLUTIONS);
        return resolution ? { resolution } : null;
    },
    [ACCOUNT_TELEMETRY_EVENTS.BUY_AGAIN_SELECTED]: (context) => ({
        itemCountBucket: getItemCountBucket(context.itemCount),
    }),
    [ACCOUNT_TELEMETRY_EVENTS.PASSKEY_ADDED]: () => ({}),
    [ACCOUNT_TELEMETRY_EVENTS.SESSION_REVOKED]: (context) => {
        const scope = pick(context.scope, SESSION_SCOPES);
        return scope ? { scope } : null;
    },
    [ACCOUNT_TELEMETRY_EVENTS.EXPORT_REQUESTED]: () => ({}),
    [ACCOUNT_TELEMETRY_EVENTS.DEACTIVATION_INITIATED]: () => ({}),
    [ACCOUNT_TELEMETRY_EVENTS.DELETION_INITIATED]: () => ({}),
    [ACCOUNT_TELEMETRY_EVENTS.WEB_VITAL]: (context) => {
        const metric = pick(String(context.metric || '').toUpperCase(), WEB_VITAL_METRICS);
        const rating = pick(context.rating, WEB_VITAL_RATINGS);
        const navigationType = pick(context.navigationType, NAVIGATION_TYPES, 'unknown');
        const value = Number(context.value);
        if (!metric || !rating || !Number.isFinite(value) || value < 0 || value > 600000) return null;
        return {
            metric,
            value: Math.round(value * 1000) / 1000,
            rating,
            navigationType,
        };
    },
};

export const trackAccountEvent = (eventName, context = {}) => {
    const normalize = normalizeContext[eventName];
    if (!normalize) return null;
    const normalizedContext = normalize(context || {});
    if (!normalizedContext) return null;
    try {
        return pushClientDiagnostic(eventName, { context: normalizedContext }, 'info');
    } catch {
        return null;
    }
};

const rateWebVital = (metric, value) => {
    const thresholds = {
        LCP: [2500, 4000],
        INP: [200, 500],
        CLS: [0.1, 0.25],
    }[metric];
    if (!thresholds) return 'poor';
    if (value <= thresholds[0]) return 'good';
    if (value <= thresholds[1]) return 'needs_improvement';
    return 'poor';
};

const getNavigationType = () => {
    try {
        const value = performance.getEntriesByType?.('navigation')?.[0]?.type;
        return pick(value, NAVIGATION_TYPES, 'unknown');
    } catch {
        return 'unknown';
    }
};

export const initAccountWebVitals = () => {
    if (
        typeof window === 'undefined'
        || typeof document === 'undefined'
        || typeof PerformanceObserver === 'undefined'
    ) {
        return () => {};
    }

    const values = { LCP: 0, INP: 0, CLS: 0 };
    const reported = new Set();
    const observers = [];
    const navigationType = getNavigationType();

    const observe = (type, callback, options = {}) => {
        try {
            const observer = new PerformanceObserver((list) => {
                list.getEntries().forEach(callback);
            });
            observer.observe({ type, buffered: true, ...options });
            observers.push(observer);
        } catch {
            // Unsupported browser telemetry must never affect Account Center behavior.
        }
    };

    observe('largest-contentful-paint', (entry) => {
        values.LCP = Math.max(values.LCP, Number(entry.startTime || 0));
    });
    observe('layout-shift', (entry) => {
        if (!entry.hadRecentInput) {
            values.CLS += Number(entry.value || 0);
        }
    });
    observe('event', (entry) => {
        if (Number(entry.interactionId || 0) > 0) {
            values.INP = Math.max(values.INP, Number(entry.duration || 0));
        }
    }, { durationThreshold: 40 });

    const report = () => {
        Object.entries(values).forEach(([metric, value]) => {
            if (reported.has(metric) || value <= 0) return;
            reported.add(metric);
            trackAccountEvent(ACCOUNT_TELEMETRY_EVENTS.WEB_VITAL, {
                metric,
                value,
                rating: rateWebVital(metric, value),
                navigationType,
            });
        });
    };

    const handleVisibility = () => {
        if (document.visibilityState === 'hidden') report();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pagehide', report);

    return () => {
        report();
        document.removeEventListener('visibilitychange', handleVisibility);
        window.removeEventListener('pagehide', report);
        observers.forEach((observer) => observer.disconnect());
    };
};

export const __private = {
    getItemCountBucket,
    normalizeContext,
    rateWebVital,
};
