import { getBackendHealthSnapshot } from '../backendHealth';

export const trustApi = {
    getClientSignals: async () => {
        const timezone = typeof Intl !== 'undefined'
            ? Intl.DateTimeFormat().resolvedOptions().timeZone
            : 'unknown';

        const language = typeof navigator !== 'undefined'
            ? (navigator.language || 'unknown')
            : 'unknown';

        const online = typeof navigator !== 'undefined'
            ? navigator.onLine
            : true;

        const secureContext = typeof window !== 'undefined'
            ? Boolean(window.isSecureContext)
            : false;

        const permissionsSupported = typeof navigator !== 'undefined' && Boolean(navigator.permissions);

        return {
            online,
            secureContext,
            permissionsSupported,
            language,
            timezone,
        };
    },
    getHealthStatus: async () => {
        let backend = {
            status: 'degraded',
            db: 'unknown',
            uptime: 0,
            timestamp: null,
        };

        try {
            const data = await getBackendHealthSnapshot();
            backend = {
                status: data?.status || 'degraded',
                db: data?.status === 'ok' ? 'connected' : 'unknown',
                uptime: Number(data?.uptime || 0),
                timestamp: data?.timestamp || null,
            };
        } catch {
            // graceful fallback to degraded
        }

        const client = await trustApi.getClientSignals();
        const isHealthy = backend.status === 'ok' && backend.db === 'connected' && client.online;
        const derivedStatus = isHealthy ? 'healthy' : 'degraded';

        return { backend, client, derivedStatus };
    },
};
