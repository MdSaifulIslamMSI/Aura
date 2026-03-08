import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
    AlertTriangle,
    Clock3,
    Loader2,
    RefreshCw,
    Search,
    ShieldAlert,
} from 'lucide-react';
import { adminApi } from '@/services/api';

const INITIAL_FILTERS = {
    limit: '25',
    severity: '',
    type: '',
    requestId: '',
    sessionId: '',
    route: '',
};

const SEVERITY_STYLES = {
    info: 'border-cyan-200 bg-cyan-50 text-cyan-700',
    warning: 'border-amber-200 bg-amber-50 text-amber-700',
    error: 'border-rose-200 bg-rose-50 text-rose-700',
    critical: 'border-rose-200 bg-rose-50 text-rose-700',
};

const formatDateTime = (value) => {
    if (!value) return '-';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? '-' : parsed.toLocaleString();
};

const normalizeFilters = (filters = INITIAL_FILTERS) => ({
    limit: String(Math.min(Math.max(Number(filters.limit) || 25, 1), 100)),
    severity: String(filters.severity || '').trim(),
    type: String(filters.type || '').trim(),
    requestId: String(filters.requestId || '').trim(),
    sessionId: String(filters.sessionId || '').trim(),
    route: String(filters.route || '').trim(),
});

const buildRequestParams = (filters = INITIAL_FILTERS) => {
    const normalized = normalizeFilters(filters);
    return Object.fromEntries(
        Object.entries(normalized).filter(([key, value]) => {
            if (key === 'limit') return true;
            return value !== '';
        })
    );
};

const summarizeDiagnostic = (entry = {}) => {
    const errorMessage = entry?.error?.message;
    if (errorMessage) return errorMessage;
    if (entry?.detail) return entry.detail;
    if (typeof entry?.context?.reason === 'string' && entry.context.reason.trim()) {
        return entry.context.reason;
    }
    if (typeof entry?.context?.message === 'string' && entry.context.message.trim()) {
        return entry.context.message;
    }
    if (entry?.status) return `HTTP ${entry.status}`;
    return 'No additional detail attached.';
};

const countActiveFilters = (filters = INITIAL_FILTERS) => (
    ['severity', 'type', 'requestId', 'sessionId', 'route']
        .filter((key) => String(filters[key] || '').trim() !== '').length
);

function MetaPill({ label, value }) {
    if (!value) return null;
    return (
        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-600">
            {label}: {value}
        </span>
    );
}

export default function ClientDiagnosticsPanel() {
    const [draftFilters, setDraftFilters] = useState(INITIAL_FILTERS);
    const [appliedFilters, setAppliedFilters] = useState(INITIAL_FILTERS);
    const [diagnostics, setDiagnostics] = useState([]);
    const [source, setSource] = useState('unknown');
    const [count, setCount] = useState(0);
    const [loading, setLoading] = useState(true);
    const [lastLoadedAt, setLastLoadedAt] = useState('');

    const activeFilterCount = useMemo(() => countActiveFilters(appliedFilters), [appliedFilters]);
    const freshestTimestamp = diagnostics[0]?.ingestedAt || diagnostics[0]?.timestamp || '';

    const loadDiagnostics = useCallback(async (filters) => {
        try {
            setLoading(true);
            const response = await adminApi.getClientDiagnostics(buildRequestParams(filters));
            setDiagnostics(Array.isArray(response?.diagnostics) ? response.diagnostics : []);
            setSource(String(response?.source || 'unknown'));
            setCount(Number(response?.count || 0));
            setLastLoadedAt(new Date().toISOString());
        } catch (error) {
            setDiagnostics([]);
            setSource('unavailable');
            setCount(0);
            toast.error(error?.message || 'Failed to load client diagnostics');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadDiagnostics(appliedFilters);
    }, [appliedFilters, loadDiagnostics]);

    const applyFilters = () => {
        setAppliedFilters(normalizeFilters(draftFilters));
    };

    const clearFilters = () => {
        setDraftFilters(INITIAL_FILTERS);
        setAppliedFilters(INITIAL_FILTERS);
    };

    return (
        <section className="rounded-xl border bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                    <div className="flex items-center gap-2">
                        <ShieldAlert className="h-5 w-5 text-rose-600" />
                        <h2 className="text-lg font-semibold text-slate-900">Client Diagnostics</h2>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">
                        Persisted browser-side failures, proxy outages, and runtime traces.
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-cyan-700">
                        Source {source}
                    </span>
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                        {count} records
                    </span>
                    <button
                        type="button"
                        onClick={() => loadDiagnostics(appliedFilters)}
                        disabled={loading}
                        className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                    >
                        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                        Refresh
                    </button>
                </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Freshest Event</p>
                    <p className="mt-2 text-sm font-semibold text-slate-900">{formatDateTime(freshestTimestamp)}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Dashboard Sync</p>
                    <p className="mt-2 text-sm font-semibold text-slate-900">{formatDateTime(lastLoadedAt)}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Active Filters</p>
                    <p className="mt-2 text-sm font-semibold text-slate-900">{activeFilterCount}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Limit</p>
                    <p className="mt-2 text-sm font-semibold text-slate-900">{appliedFilters.limit}</p>
                </div>
            </div>

            <div className="mt-4 rounded-xl border border-slate-200 p-3">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
                    <label className="text-sm text-slate-600">
                        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Severity</span>
                        <select
                            value={draftFilters.severity}
                            onChange={(event) => setDraftFilters((prev) => ({ ...prev, severity: event.target.value }))}
                            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                        >
                            <option value="">All severities</option>
                            <option value="info">Info</option>
                            <option value="warning">Warning</option>
                            <option value="error">Error</option>
                            <option value="critical">Critical</option>
                        </select>
                    </label>

                    <label className="text-sm text-slate-600">
                        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Type</span>
                        <input
                            type="text"
                            value={draftFilters.type}
                            onChange={(event) => setDraftFilters((prev) => ({ ...prev, type: event.target.value }))}
                            placeholder="api.network_error"
                            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        />
                    </label>

                    <label className="text-sm text-slate-600">
                        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Request ID</span>
                        <input
                            type="text"
                            value={draftFilters.requestId}
                            onChange={(event) => setDraftFilters((prev) => ({ ...prev, requestId: event.target.value }))}
                            placeholder="req-..."
                            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        />
                    </label>

                    <label className="text-sm text-slate-600">
                        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Session</span>
                        <input
                            type="text"
                            value={draftFilters.sessionId}
                            onChange={(event) => setDraftFilters((prev) => ({ ...prev, sessionId: event.target.value }))}
                            placeholder="session-..."
                            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        />
                    </label>

                    <label className="text-sm text-slate-600">
                        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Route Contains</span>
                        <input
                            type="text"
                            value={draftFilters.route}
                            onChange={(event) => setDraftFilters((prev) => ({ ...prev, route: event.target.value }))}
                            placeholder="/products"
                            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        />
                    </label>

                    <label className="text-sm text-slate-600">
                        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Limit</span>
                        <select
                            value={draftFilters.limit}
                            onChange={(event) => setDraftFilters((prev) => ({ ...prev, limit: event.target.value }))}
                            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                        >
                            <option value="10">10</option>
                            <option value="25">25</option>
                            <option value="50">50</option>
                            <option value="100">100</option>
                        </select>
                    </label>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                        type="button"
                        onClick={applyFilters}
                        className="inline-flex items-center gap-2 rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm font-semibold text-cyan-700 hover:bg-cyan-100"
                    >
                        <Search className="h-4 w-4" />
                        Apply Filters
                    </button>
                    <button
                        type="button"
                        onClick={clearFilters}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                        Clear
                    </button>
                    <p className="text-xs text-slate-500">
                        Request ID matches client, server, or ingestion request ids. Route filters use contains matching.
                    </p>
                </div>
            </div>

            <div className="mt-4 space-y-3">
                {loading ? (
                    <div className="flex items-center gap-2 rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading persisted client diagnostics...
                    </div>
                ) : diagnostics.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                        No client diagnostics matched the current filters.
                    </div>
                ) : (
                    diagnostics.map((entry, index) => {
                        const key = entry?._id || entry?.eventId || entry?.requestId || entry?.serverRequestId || `${entry?.type || 'diagnostic'}-${index}`;
                        const severity = String(entry?.severity || 'info').toLowerCase();
                        const summary = summarizeDiagnostic(entry);

                        return (
                            <article key={key} className="rounded-xl border border-slate-200 p-4">
                                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                                    <div>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <h3 className="text-sm font-bold text-slate-900">{entry?.type || 'unknown'}</h3>
                                            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${SEVERITY_STYLES[severity] || SEVERITY_STYLES.info}`}>
                                                {severity}
                                            </span>
                                            {entry?.status ? (
                                                <span className="rounded-full border border-slate-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                                                    HTTP {entry.status}
                                                </span>
                                            ) : null}
                                            {entry?.durationMs ? (
                                                <span className="rounded-full border border-slate-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                                                    {entry.durationMs} ms
                                                </span>
                                            ) : null}
                                        </div>
                                        <p className="mt-2 text-sm text-slate-700">{summary}</p>
                                    </div>
                                    <div className="flex items-center gap-2 text-xs text-slate-500">
                                        <Clock3 className="h-3.5 w-3.5" />
                                        {formatDateTime(entry?.timestamp || entry?.ingestedAt)}
                                    </div>
                                </div>

                                <div className="mt-3 flex flex-wrap gap-2">
                                    <MetaPill label="Request" value={entry?.requestId} />
                                    <MetaPill label="Server" value={entry?.serverRequestId} />
                                    <MetaPill label="Ingest" value={entry?.ingestionRequestId} />
                                    <MetaPill label="Session" value={entry?.sessionId} />
                                    <MetaPill label="Method" value={entry?.method} />
                                    <MetaPill label="Route" value={entry?.route} />
                                </div>

                                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">URL</p>
                                        <p className="mt-1 break-all text-sm text-slate-700">{entry?.url || '-'}</p>
                                    </div>
                                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Ingested At</p>
                                        <p className="mt-1 text-sm text-slate-700">{formatDateTime(entry?.ingestedAt || entry?.timestamp)}</p>
                                    </div>
                                </div>

                                {entry?.error ? (
                                    <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3">
                                        <div className="flex items-center gap-2 text-rose-700">
                                            <AlertTriangle className="h-4 w-4" />
                                            <p className="text-xs font-semibold uppercase tracking-wide">Error Snapshot</p>
                                        </div>
                                        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words text-xs text-rose-900">
                                            {JSON.stringify(entry.error, null, 2)}
                                        </pre>
                                    </div>
                                ) : null}
                            </article>
                        );
                    })
                )}
            </div>
        </section>
    );
}
