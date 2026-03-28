import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
    Activity,
    AlertTriangle,
    Bell,
    CheckCheck,
    Clock3,
    Database,
    Download,
    Loader2,
    Pause,
    Play,
    RefreshCw,
    Server,
    ShieldCheck,
    ShoppingBag,
    TrendingUp,
    Users,
} from 'lucide-react';
import PremiumSelect from '@/components/ui/premium-select';
import AdminPremiumShell, { AdminHeroStat } from '@/components/shared/AdminPremiumShell';
import { AuthContext } from '@/context/AuthContext';
import { useMarket } from '@/context/MarketContext';
import { useDynamicTranslations } from '@/hooks/useDynamicTranslations';
import { adminApi } from '@/services/api/adminApi';
import { translateEnumLabel } from '@/utils/enumLocalization';
import ClientDiagnosticsPanel from './ClientDiagnosticsPanel';

const SEVERITY_STYLES = {
    info: 'bg-cyan-100 text-cyan-700 border-cyan-200',
    warning: 'bg-amber-100 text-amber-700 border-amber-200',
    critical: 'bg-rose-100 text-rose-700 border-rose-200',
};

const SUMMARY_FALLBACK = {
    unreadCount: 0,
    criticalUnreadCount: 0,
    createdToday: 0,
    createdLast24h: 0,
    topActions: [],
    operational: {
        users: { total: 0, verified: 0, sellers: 0 },
        orders: { total: 0 },
        listings: { total: 0, active: 0, escrowHeld: 0 },
        payments: { failed: 0, pending: 0 },
    },
};

const ANALYTICS_FALLBACK = {
    overview: {
        orders: { totalOrders: 0, grossRevenue: 0, avgOrderValue: 0, deliveredOrders: 0 },
        refunds: { totalRefundRequests: 0 },
        payments: { failedPayments: 0, totalIntents: 0 },
        users: { newUsers: 0, newVerifiedUsers: 0 },
    },
    deltas: { ordersPct: 0, revenuePct: 0, paymentFailuresPct: 0, newUsersPct: 0 },
    points: [],
    anomalies: [],
};

const BI_CONFIG_FALLBACK = { mode: 'hybrid', powerBi: { enabled: false, dashboardUrl: '', workspaceLabel: '' } };
const HEALTH_FALLBACK = {
    status: 'degraded',
    db: 'unknown',
    redis: { connected: false },
    queues: { paymentOutbox: { status: 'unknown' }, orderEmail: { status: 'unknown' } },
    catalog: { staleData: true, activeVersion: 'unknown' },
    timestamp: null,
};
const OPS_READINESS_FALLBACK = {
    readinessScore: 0,
    saturation: 'degraded',
    blockingIssues: [],
    warnings: [],
    checks: {
        dbConnected: false,
        paymentQueueStatus: 'unknown',
        emailQueueStatus: 'unknown',
        catalogStale: true,
    },
};
const SEVERITY_RANK = { critical: 3, warning: 2, info: 1 };
const INCIDENT_TIER_STYLES = {
    stable: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    warning: 'border-amber-200 bg-amber-50 text-amber-700',
    critical: 'border-rose-200 bg-rose-50 text-rose-700',
};

const formatDateTime = (value) => {
    if (!value) return '-';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString();
};
const formatNumber = (value) => new Intl.NumberFormat('en-IN').format(Number(value || 0));
const formatCurrency = (value) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(value || 0));
const formatDelta = (value) => `${Number(value || 0) > 0 ? '+' : ''}${Number(value || 0).toFixed(2)}%`;
const getDeltaClass = (value, invert = false) => {
    const num = Number(value || 0);
    if (num === 0) return 'text-slate-500';
    const positiveIsGood = !invert;
    return num > 0 ? (positiveIsGood ? 'text-emerald-600' : 'text-rose-600') : (positiveIsGood ? 'text-rose-600' : 'text-emerald-600');
};
const POSITIVE_HEALTH_STATES = new Set(['ok', 'healthy', 'connected']);
const isPositiveHealthStatus = (value) => POSITIVE_HEALTH_STATES.has(String(value || '').trim().toLowerCase());

const formatDashboardSeverity = (t, value) => {
    const normalized = String(value || '').trim().toLowerCase();
    switch (normalized) {
        case 'info':
            return t('admin.dashboard.severity.info', {}, 'Info');
        case 'warning':
            return t('admin.dashboard.severity.warning', {}, 'Warning');
        case 'critical':
            return t('admin.dashboard.severity.critical', {}, 'Critical');
        default:
            return value || t('admin.shared.unknown', {}, 'unknown');
    }
};

const formatDashboardState = (t, value) => {
    const normalized = String(value || '').trim().toLowerCase();
    switch (normalized) {
        case 'ok':
            return t('admin.dashboard.state.ok', {}, 'OK');
        case 'healthy':
            return t('admin.dashboard.state.healthy', {}, 'Healthy');
        case 'connected':
            return t('admin.dashboard.state.connected', {}, 'Connected');
        case 'disconnected':
            return t('admin.dashboard.state.disconnected', {}, 'Disconnected');
        case 'degraded':
            return t('admin.dashboard.state.degraded', {}, 'Degraded');
        case 'unknown':
            return t('admin.dashboard.state.unknown', {}, 'Unknown');
        default:
            return value || t('admin.shared.unknown', {}, 'unknown');
    }
};

const formatDashboardTier = (t, value) => {
    const normalized = String(value || '').trim().toLowerCase();
    switch (normalized) {
        case 'stable':
            return t('admin.dashboard.tier.stable', {}, 'Stable');
        case 'warning':
            return t('admin.dashboard.tier.warning', {}, 'Warning');
        case 'critical':
            return t('admin.dashboard.tier.critical', {}, 'Critical');
        case 'degraded':
            return t('admin.dashboard.tier.degraded', {}, 'Degraded');
        default:
            return value || t('admin.shared.unknown', {}, 'unknown');
    }
};

const formatDashboardActionKey = (t, value) => translateEnumLabel(t, 'admin.dashboard.actionKey', value);
const formatDashboardMethod = (t, value) => translateEnumLabel(t, 'admin.dashboard.method', value, String(value || '').toUpperCase());

const downloadBlob = (blob, filename) => {
    if (typeof window === 'undefined') return;
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(url);
};

export default function AdminDashboard() {
    const { currentUser } = useContext(AuthContext);
    const { t } = useMarket();
    const navigate = useNavigate();

    const [summary, setSummary] = useState(SUMMARY_FALLBACK);
    const [summaryLoading, setSummaryLoading] = useState(true);
    const [analyticsLoading, setAnalyticsLoading] = useState(true);
    const [listLoading, setListLoading] = useState(true);
    const [busyNotificationId, setBusyNotificationId] = useState('');
    const [markAllBusy, setMarkAllBusy] = useState(false);
    const [exportBusy, setExportBusy] = useState('');
    const [page, setPage] = useState(1);
    const [total, setTotal] = useState(0);
    const [notifications, setNotifications] = useState([]);
    const [filters, setFilters] = useState({ severity: '', unreadOnly: false, search: '' });
    const [analyticsRange, setAnalyticsRange] = useState('30d');
    const [anomalyWindow, setAnomalyWindow] = useState(60);
    const [analytics, setAnalytics] = useState(ANALYTICS_FALLBACK);
    const [biConfig, setBiConfig] = useState(BI_CONFIG_FALLBACK);
    const [health, setHealth] = useState(HEALTH_FALLBACK);
    const [healthLoading, setHealthLoading] = useState(true);
    const [opsReadiness, setOpsReadiness] = useState(OPS_READINESS_FALLBACK);
    const [opsLoading, setOpsLoading] = useState(true);
    const [opsSmokeBusy, setOpsSmokeBusy] = useState(false);
    const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(true);
    const [autoRefreshSec, setAutoRefreshSec] = useState(30);
    const limit = 20;
    const totalPages = useMemo(() => Math.max(Math.ceil(total / limit), 1), [total, limit]);

    const loadSummary = useCallback(async () => {
        try {
            setSummaryLoading(true);
            const response = await adminApi.getNotificationSummary();
            setSummary(response?.summary || SUMMARY_FALLBACK);
        } catch (error) {
            toast.error(error.message || t('admin.dashboard.error.loadSummary', {}, 'Failed to load admin summary'));
        } finally {
            setSummaryLoading(false);
        }
    }, []);

    const loadAnalytics = useCallback(async () => {
        try {
            setAnalyticsLoading(true);
            const [overviewResponse, timeSeriesResponse, anomalyResponse, biResponse] = await Promise.all([
                adminApi.getAnalyticsOverview({ range: analyticsRange }),
                adminApi.getAnalyticsTimeSeries({ range: analyticsRange }),
                adminApi.getAnalyticsAnomalies({ windowMinutes: anomalyWindow }),
                adminApi.getBiConfig(),
            ]);
            setAnalytics({
                overview: overviewResponse?.overview || ANALYTICS_FALLBACK.overview,
                deltas: overviewResponse?.deltas || ANALYTICS_FALLBACK.deltas,
                points: Array.isArray(timeSeriesResponse?.points) ? timeSeriesResponse.points : [],
                anomalies: Array.isArray(anomalyResponse?.anomalies) ? anomalyResponse.anomalies : [],
            });
            setBiConfig(biResponse?.config || BI_CONFIG_FALLBACK);
        } catch (error) {
            toast.error(error.message || t('admin.dashboard.error.loadAnalytics', {}, 'Failed to load analytics intelligence'));
        } finally {
            setAnalyticsLoading(false);
        }
    }, [analyticsRange, anomalyWindow]);

    const loadHealth = useCallback(async () => {
        try {
            setHealthLoading(true);
            const response = await adminApi.getSystemHealth();
            setHealth(response || HEALTH_FALLBACK);
        } catch (error) {
            toast.error(error.message || t('admin.dashboard.error.loadHealth', {}, 'Failed to load system health'));
            setHealth(HEALTH_FALLBACK);
        } finally {
            setHealthLoading(false);
        }
    }, []);

    const loadOpsReadiness = useCallback(async () => {
        try {
            setOpsLoading(true);
            const response = await adminApi.getOpsReadiness();
            setOpsReadiness(response?.readiness || OPS_READINESS_FALLBACK);
        } catch (error) {
            toast.error(error.message || t('admin.dashboard.error.loadReadiness', {}, 'Failed to load admin readiness'));
            setOpsReadiness(OPS_READINESS_FALLBACK);
        } finally {
            setOpsLoading(false);
        }
    }, []);

    const loadNotifications = useCallback(async () => {
        try {
            setListLoading(true);
            const response = await adminApi.listNotifications({
                page,
                limit,
                severity: filters.severity || undefined,
                unreadOnly: filters.unreadOnly ? 'true' : undefined,
                search: filters.search.trim() || undefined,
            });
            setNotifications(response?.notifications || []);
            setTotal(Number(response?.total || 0));
        } catch (error) {
            toast.error(error.message || t('admin.dashboard.error.loadNotifications', {}, 'Failed to load admin notifications'));
        } finally {
            setListLoading(false);
        }
    }, [filters.search, filters.severity, filters.unreadOnly, limit, page]);

    const refreshAll = useCallback(async () => {
        await Promise.all([loadSummary(), loadAnalytics(), loadHealth(), loadOpsReadiness(), loadNotifications()]);
    }, [loadSummary, loadAnalytics, loadHealth, loadOpsReadiness, loadNotifications]);

    useEffect(() => {
        refreshAll();
    }, [refreshAll]);

    useEffect(() => {
        if (!autoRefreshEnabled) return undefined;
        const safeSeconds = Math.min(Math.max(Number(autoRefreshSec || 30), 10), 300);
        const timer = window.setInterval(refreshAll, safeSeconds * 1000);
        return () => window.clearInterval(timer);
    }, [refreshAll, autoRefreshEnabled, autoRefreshSec]);

    const runCsvExport = async (dataset) => {
        try {
            setExportBusy(dataset);
            const { blob, filename, rowCount } = await adminApi.exportAnalyticsCsv({ dataset, range: analyticsRange, limit: 3000 });
            downloadBlob(blob, filename);
            toast.success(t('admin.dashboard.success.exportReady', { count: rowCount }, `Export ready: ${rowCount} rows`));
        } catch (error) {
            toast.error(error.message || t('admin.dashboard.error.export', {}, 'Failed to export analytics CSV'));
        } finally {
            setExportBusy('');
        }
    };

    const toggleRead = async (entry) => {
        if (!entry?.notificationId) return;
        const nextReadState = !entry.isRead;
        try {
            setBusyNotificationId(entry.notificationId);
            await adminApi.markNotificationRead(entry.notificationId, nextReadState);
            setNotifications((prev) => prev.map((item) => (item.notificationId === entry.notificationId ? { ...item, isRead: nextReadState } : item)));
            await loadSummary();
        } catch (error) {
            toast.error(error.message || t('admin.dashboard.error.updateNotification', {}, 'Failed to update notification'));
        } finally {
            setBusyNotificationId('');
        }
    };

    const markAllRead = async () => {
        try {
            setMarkAllBusy(true);
            await adminApi.markAllNotificationsRead({ severity: filters.severity || undefined, search: filters.search.trim() || undefined, unreadOnly: true });
            await refreshAll();
            toast.success(t('admin.dashboard.success.markAllRead', {}, 'All matching unread notifications marked read'));
        } catch (error) {
            toast.error(error.message || t('admin.dashboard.error.markAllRead', {}, 'Failed to mark all as read'));
        } finally {
            setMarkAllBusy(false);
        }
    };

    const runOpsSmoke = async () => {
        try {
            setOpsSmokeBusy(true);
            const response = await adminApi.runOpsSmoke();
            const smoke = response?.smoke || {};
            if (smoke.passed) {
                toast.success(t('admin.dashboard.success.smokePassed', { score: Number(smoke.readinessScore || 0) }, `Admin smoke checks passed (${Number(smoke.readinessScore || 0)} / 100)`));
            } else {
                toast.error(t('admin.dashboard.error.smokeBlocking', { score: Number(smoke.readinessScore || 0) }, `Admin smoke checks found blocking issues (${Number(smoke.readinessScore || 0)} / 100)`));
            }
            await loadOpsReadiness();
        } catch (error) {
            toast.error(error.message || t('admin.dashboard.error.smokeFailed', {}, 'Admin smoke checks failed'));
        } finally {
            setOpsSmokeBusy(false);
        }
    };

    const kpis = [
        { key: 'orders', title: t('admin.dashboard.kpi.orders', {}, 'Orders'), value: formatNumber(analytics.overview.orders.totalOrders), delta: analytics.deltas.ordersPct, hint: t('admin.dashboard.kpi.delivered', { count: formatNumber(analytics.overview.orders.deliveredOrders) }, `${formatNumber(analytics.overview.orders.deliveredOrders)} delivered`), icon: <ShoppingBag className="h-4 w-4 text-emerald-600" />, invert: false },
        { key: 'revenue', title: t('admin.dashboard.kpi.grossRevenue', {}, 'Gross Revenue'), value: formatCurrency(analytics.overview.orders.grossRevenue), delta: analytics.deltas.revenuePct, hint: t('admin.dashboard.kpi.aov', { value: formatCurrency(analytics.overview.orders.avgOrderValue) }, `AOV ${formatCurrency(analytics.overview.orders.avgOrderValue)}`), icon: <TrendingUp className="h-4 w-4 text-sky-600" />, invert: false },
        { key: 'paymentFailures', title: t('admin.dashboard.kpi.paymentFailures', {}, 'Payment Failures'), value: formatNumber(analytics.overview.payments.failedPayments), delta: analytics.deltas.paymentFailuresPct, hint: t('admin.dashboard.kpi.intents', { count: formatNumber(analytics.overview.payments.totalIntents) }, `${formatNumber(analytics.overview.payments.totalIntents)} intents`), icon: <AlertTriangle className="h-4 w-4 text-rose-600" />, invert: true },
        { key: 'users', title: t('admin.dashboard.kpi.newUsers', {}, 'New Users'), value: formatNumber(analytics.overview.users.newUsers), delta: analytics.deltas.newUsersPct, hint: t('admin.dashboard.kpi.verified', { count: formatNumber(analytics.overview.users.newVerifiedUsers) }, `${formatNumber(analytics.overview.users.newVerifiedUsers)} verified`), icon: <Users className="h-4 w-4 text-violet-600" />, invert: false },
    ];

    const incidentScore = useMemo(() => {
        const criticalUnread = Number(summary.criticalUnreadCount || 0);
        const anomalyCount = Array.isArray(analytics.anomalies) ? analytics.anomalies.length : 0;
        const failureRate = (Number(analytics.overview.payments.failedPayments || 0) / Math.max(Number(analytics.overview.payments.totalIntents || 0), 1)) * 100;
        const healthPenalty = health?.status === 'ok' && health?.db === 'connected' ? 0 : 20;
        const raw = (criticalUnread * 4) + (anomalyCount * 15) + (failureRate * 1.5) + healthPenalty;
        return Math.min(Math.round(raw), 100);
    }, [summary.criticalUnreadCount, analytics.anomalies, analytics.overview.payments.failedPayments, analytics.overview.payments.totalIntents, health]);

    const incidentTier = incidentScore >= 70 ? 'critical' : incidentScore >= 40 ? 'warning' : 'stable';

    const priorityQueue = useMemo(() => {
        return [...(notifications || [])]
            .sort((a, b) => {
                const severityDiff = (SEVERITY_RANK[b?.severity] || 0) - (SEVERITY_RANK[a?.severity] || 0);
                if (severityDiff !== 0) return severityDiff;
                return new Date(b?.createdAt || 0).getTime() - new Date(a?.createdAt || 0).getTime();
            })
            .slice(0, 5);
    }, [notifications]);
    const dashboardDynamicTexts = useMemo(() => ([
        ...(notifications || []).flatMap((entry) => [entry?.title, entry?.summary]),
        ...(analytics.anomalies || []).flatMap((item) => [item?.title, item?.recommendation]),
    ]), [analytics.anomalies, notifications]);
    const { translateText: translateDashboardText } = useDynamicTranslations(dashboardDynamicTexts);

    return (
        <AdminPremiumShell
            eyebrow={t('admin.dashboard.eyebrow', {}, 'Mission control')}
            title={t('admin.dashboard.title', {}, 'Admin operations portal')}
            description={t('admin.dashboard.description', {}, 'Real-time intelligence, anomaly alerts, readiness signals, and persistent operational controls in one premium command surface.')}
            actions={(
                <>
                    <PremiumSelect value={analyticsRange} onChange={(e) => setAnalyticsRange(e.target.value)} className="admin-premium-control min-w-[9rem]">
                        <option value="24h">{t('admin.dashboard.range.24h', {}, 'Last 24h')}</option>
                        <option value="7d">{t('admin.dashboard.range.7d', {}, 'Last 7 days')}</option>
                        <option value="30d">{t('admin.dashboard.range.30d', {}, 'Last 30 days')}</option>
                        <option value="90d">{t('admin.dashboard.range.90d', {}, 'Last 90 days')}</option>
                    </PremiumSelect>
                    <PremiumSelect value={anomalyWindow} onChange={(e) => setAnomalyWindow(Number(e.target.value))} className="admin-premium-control min-w-[9rem]">
                        <option value={30}>{t('admin.dashboard.anomaly.30m', {}, 'Anomaly 30m')}</option>
                        <option value={60}>{t('admin.dashboard.anomaly.60m', {}, 'Anomaly 60m')}</option>
                        <option value={120}>{t('admin.dashboard.anomaly.120m', {}, 'Anomaly 120m')}</option>
                    </PremiumSelect>
                    <button type="button" onClick={refreshAll} className="admin-premium-button">
                        <RefreshCw className="h-4 w-4" />
                        {t('admin.shared.refresh', {}, 'Refresh')}
                    </button>
                    <button type="button" onClick={runOpsSmoke} disabled={opsSmokeBusy} className="admin-premium-button admin-premium-button-accent">
                        {opsSmokeBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                        {t('admin.dashboard.actions.runOpsSmoke', {}, 'Run Ops Smoke')}
                    </button>
                    <button type="button" onClick={markAllRead} disabled={markAllBusy} className="admin-premium-button admin-premium-button-success">
                        {markAllBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCheck className="h-4 w-4" />}
                        {t('admin.dashboard.actions.markMatchingRead', {}, 'Mark Matching Read')}
                    </button>
                    <button type="button" onClick={() => navigate('/admin/users')} className="admin-premium-button admin-premium-button-primary">
                        <Users className="h-4 w-4" />
                        {t('admin.dashboard.actions.userGovernance', {}, 'User Governance')}
                    </button>
                </>
            )}
            stats={[
                <AdminHeroStat key="readiness" label={t('admin.dashboard.stats.opsReadiness', {}, 'Ops readiness')} value={opsLoading ? t('admin.shared.busy', {}, '...') : Number(opsReadiness.readinessScore || 0)} detail={opsLoading ? t('admin.dashboard.loadingReadiness', {}, 'Loading readiness') : formatDashboardTier(t, opsReadiness.saturation || 'degraded')} icon={<ShieldCheck className="h-5 w-5" />} />,
                <AdminHeroStat key="signals" label={t('admin.dashboard.stats.unreadSignals', {}, 'Unread signals')} value={summaryLoading ? t('admin.shared.busy', {}, '...') : Number(summary.unreadCount || 0)} detail={t('admin.dashboard.stats.criticalUnread', { count: Number(summary.criticalUnreadCount || 0) }, `${Number(summary.criticalUnreadCount || 0)} critical unread`)} icon={<Bell className="h-5 w-5" />} />,
                <AdminHeroStat key="revenue" label={t('admin.dashboard.kpi.grossRevenue', {}, 'Gross revenue')} value={analyticsLoading ? t('admin.shared.busy', {}, '...') : formatCurrency(analytics.overview.orders.grossRevenue)} detail={t('admin.dashboard.kpi.aov', { value: formatCurrency(analytics.overview.orders.avgOrderValue) }, `AOV ${formatCurrency(analytics.overview.orders.avgOrderValue)}`)} icon={<TrendingUp className="h-5 w-5" />} />,
                <AdminHeroStat key="incident" label={t('admin.dashboard.incidentScore', {}, 'Incident score')} value={healthLoading || analyticsLoading || summaryLoading ? t('admin.shared.busy', {}, '...') : incidentScore} detail={formatDashboardTier(t, incidentTier)} icon={<AlertTriangle className="h-5 w-5" />} />,
            ]}
        >

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                <StatCard title={t('admin.dashboard.cards.unreadSignals', {}, 'Unread Signals')} value={summary.unreadCount} icon={<Bell className="h-5 w-5 text-cyan-600" />} loading={summaryLoading} />
                <StatCard title={t('admin.dashboard.cards.criticalUnread', {}, 'Critical Unread')} value={summary.criticalUnreadCount} icon={<AlertTriangle className="h-5 w-5 text-rose-600" />} loading={summaryLoading} />
                <StatCard title={t('admin.dashboard.cards.eventsToday', {}, 'Events Today')} value={summary.createdToday} icon={<ShieldCheck className="h-5 w-5 text-indigo-600" />} loading={summaryLoading} />
                <StatCard title={t('admin.dashboard.cards.events24h', {}, 'Events Last 24h')} value={summary.createdLast24h} icon={<RefreshCw className="h-5 w-5 text-violet-600" />} loading={summaryLoading} />
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                <StatCard
                    title={t('admin.dashboard.stats.opsReadiness', {}, 'Ops Readiness')}
                    value={opsLoading ? 0 : Number(opsReadiness.readinessScore || 0)}
                    icon={<ShieldCheck className="h-5 w-5 text-emerald-600" />}
                    loading={opsLoading}
                />
                <StatCard
                    title={t('admin.dashboard.cards.saturationTier', {}, 'Saturation Tier')}
                    value={opsLoading ? '-' : formatDashboardTier(t, opsReadiness.saturation || 'degraded')}
                    icon={<Activity className="h-5 w-5 text-cyan-600" />}
                    loading={opsLoading}
                />
                <StatCard
                    title={t('admin.dashboard.cards.blockingIssues', {}, 'Blocking Issues')}
                    value={opsLoading ? 0 : Number(opsReadiness.blockingIssues?.length || 0)}
                    icon={<AlertTriangle className="h-5 w-5 text-rose-600" />}
                    loading={opsLoading}
                />
                <StatCard
                    title={t('admin.dashboard.cards.opsWarnings', {}, 'Ops Warnings')}
                    value={opsLoading ? 0 : Number(opsReadiness.warnings?.length || 0)}
                    icon={<Bell className="h-5 w-5 text-amber-600" />}
                    loading={opsLoading}
                />
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
                <div className="admin-premium-panel xl:col-span-3">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('admin.dashboard.incidentScore', {}, 'Incident Score')}</p>
                            <p className="mt-2 text-4xl font-black text-slate-900">
                                {healthLoading || analyticsLoading || summaryLoading ? (
                                    <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
                                ) : (
                                    incidentScore
                                )}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">{t('admin.dashboard.incidentBody', {}, 'Aggregates anomalies, failed payments, critical alerts, and health degradation.')}</p>
                        </div>
                        <span className={`rounded-full border px-2 py-1 text-xs font-bold uppercase tracking-wider ${INCIDENT_TIER_STYLES[incidentTier] || INCIDENT_TIER_STYLES.warning}`}>
                            {formatDashboardTier(t, incidentTier)}
                        </span>
                    </div>
                    <div className="mt-4 space-y-1 text-xs text-slate-600">
                        <p>{t('admin.dashboard.criticalUnreadLabel', {}, 'Critical unread')}: <span className="font-semibold text-slate-900">{summary.criticalUnreadCount}</span></p>
                        <p>{t('admin.dashboard.anomaliesLabel', {}, 'Anomalies')}: <span className="font-semibold text-slate-900">{analytics.anomalies.length}</span></p>
                        <p>{t('admin.dashboard.paymentFailureRate', {}, 'Payment failure rate')}: <span className="font-semibold text-slate-900">{((Number(analytics.overview.payments.failedPayments || 0) / Math.max(Number(analytics.overview.payments.totalIntents || 0), 1)) * 100).toFixed(2)}%</span></p>
                    </div>
                </div>

                <div className="admin-premium-panel xl:col-span-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <h2 className="text-lg font-semibold text-slate-900">{t('admin.dashboard.systemHealthFabric', {}, 'System Health Fabric')}</h2>
                            <p className="text-xs text-slate-500">{t('admin.dashboard.systemHealthBody', {}, 'Live backend readiness snapshot for admin decisions.')}</p>
                        </div>
                        <span className={`rounded-full border px-2 py-1 text-xs font-semibold uppercase tracking-wide ${
                            health?.status === 'ok'
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                : 'border-rose-200 bg-rose-50 text-rose-700'
                        }`}>
                            {formatDashboardState(t, health?.status)}
                        </span>
                    </div>

                    <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                        <HealthCell
                            icon={<Database className="h-4 w-4 text-indigo-600" />}
                            label={t('admin.dashboard.database', {}, 'Database')}
                            value={formatDashboardState(t, health?.db)}
                            ok={isPositiveHealthStatus(health?.db)}
                            loading={healthLoading}
                        />
                        <HealthCell
                            icon={<Server className="h-4 w-4 text-cyan-600" />}
                            label={t('admin.dashboard.redis', {}, 'Redis')}
                            value={health?.redis?.connected ? t('admin.dashboard.state.connected', {}, 'Connected') : t('admin.dashboard.state.disconnected', {}, 'Disconnected')}
                            ok={Boolean(health?.redis?.connected)}
                            loading={healthLoading}
                        />
                        <HealthCell
                            icon={<Activity className="h-4 w-4 text-emerald-600" />}
                            label={t('admin.dashboard.paymentQueue', {}, 'Payment Queue')}
                            value={formatDashboardState(t, health?.queues?.paymentOutbox?.status)}
                            ok={isPositiveHealthStatus(health?.queues?.paymentOutbox?.status)}
                            loading={healthLoading}
                        />
                        <HealthCell
                            icon={<Bell className="h-4 w-4 text-violet-600" />}
                            label={t('admin.dashboard.orderEmailQueue', {}, 'Order Email Queue')}
                            value={formatDashboardState(t, health?.queues?.orderEmail?.status)}
                            ok={isPositiveHealthStatus(health?.queues?.orderEmail?.status)}
                            loading={healthLoading}
                        />
                    </div>

                    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600">
                        {t('admin.dashboard.catalog', {}, 'Catalog')}: <span className="font-semibold text-slate-900">{health?.catalog?.activeVersion || t('admin.shared.unknown', {}, 'unknown')}</span> | {t('admin.dashboard.staleData', {}, 'stale data')}:
                        <span className={`ml-1 font-semibold ${health?.catalog?.staleData ? 'text-rose-600' : 'text-emerald-600'}`}>
                            {health?.catalog?.staleData ? t('admin.shared.yes', {}, 'yes') : t('admin.shared.no', {}, 'no')}
                        </span>
                    </div>
                </div>

                <div className="admin-premium-panel xl:col-span-3">
                    <h2 className="text-lg font-semibold text-slate-900">{t('admin.dashboard.autoRefreshControl', {}, 'Auto-Refresh Control')}</h2>
                    <p className="text-xs text-slate-500">{t('admin.dashboard.autoRefreshBody', {}, 'Tune dashboard polling during incidents.')}</p>
                    <div className="mt-3 flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => setAutoRefreshEnabled((prev) => !prev)}
                            className={`admin-premium-button inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold ${
                                autoRefreshEnabled ? 'admin-premium-button-success' : ''
                            }`}
                        >
                            {autoRefreshEnabled ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                            {autoRefreshEnabled ? t('admin.dashboard.pausePolling', {}, 'Pause Polling') : t('admin.dashboard.resumePolling', {}, 'Resume Polling')}
                        </button>
                        <PremiumSelect
                            value={autoRefreshSec}
                            onChange={(e) => setAutoRefreshSec(Number(e.target.value))}
                            className="admin-premium-control px-2 py-2 text-xs"
                        >
                            <option value={10}>10s</option>
                            <option value={15}>15s</option>
                            <option value={30}>30s</option>
                            <option value={60}>60s</option>
                            <option value={120}>120s</option>
                        </PremiumSelect>
                    </div>

                    <div className="mt-3 rounded-lg border border-slate-200 p-2 text-xs text-slate-600">
                        <div className="flex items-center gap-2">
                            <Clock3 className="h-3.5 w-3.5 text-slate-500" />
                            {t('admin.dashboard.lastHealthSync', {}, 'Last health sync')}: <span className="font-semibold text-slate-900">{formatDateTime(health?.timestamp)}</span>
                        </div>
                    </div>

                    <div className="mt-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('admin.dashboard.priorityQueue', {}, 'Priority Queue')}</p>
                        <div className="mt-2 space-y-2">
                            {priorityQueue.length === 0 ? (
                                <p className="rounded-lg border border-dashed px-2 py-2 text-xs text-slate-500">{t('admin.dashboard.noAlertsInQueue', {}, 'No alerts in queue.')}</p>
                            ) : (
                                priorityQueue.map((entry) => (
                                    <div key={entry.notificationId} className="rounded-lg border border-slate-200 p-2">
                                        <div className="flex items-center justify-between gap-2">
                                            <p className="line-clamp-1 text-xs font-semibold text-slate-800">{translateDashboardText(entry.title)}</p>
                                            <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${SEVERITY_STYLES[entry.severity] || SEVERITY_STYLES.info}`}>
                                                {formatDashboardSeverity(t, entry.severity)}
                                            </span>
                                        </div>
                                        <p className="mt-1 line-clamp-2 text-[11px] text-slate-500">{translateDashboardText(entry.summary)}</p>
                                        {!entry.isRead ? (
                                            <button type="button" className="admin-premium-button admin-premium-button-success mt-2 px-2 py-1 text-[10px] font-semibold" onClick={() => toggleRead(entry)} disabled={busyNotificationId === entry.notificationId}>
                                                {busyNotificationId === entry.notificationId ? t('admin.dashboard.updating', {}, 'Updating...') : t('admin.dashboard.markRead', {}, 'Mark Read')}
                                            </button>
                                        ) : null}
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            </div>

            <ClientDiagnosticsPanel />

            <div className="admin-premium-panel">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                        <h2 className="text-lg font-semibold text-gray-900">{t('admin.dashboard.businessIntelligence', {}, 'Business Intelligence Layer')}</h2>
                        <p className="text-sm text-gray-500">{t('admin.dashboard.businessIntelligenceBody', {}, 'Native analytics, export pipeline, and anomaly monitor.')}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <ExportButton label={t('admin.dashboard.export.overview', {}, 'Export Overview')} busy={exportBusy === 'overview'} onClick={() => runCsvExport('overview')} />
                        <ExportButton label={t('admin.dashboard.export.orders', {}, 'Export Orders')} busy={exportBusy === 'orders'} onClick={() => runCsvExport('orders')} />
                        <ExportButton label={t('admin.dashboard.export.payments', {}, 'Export Payments')} busy={exportBusy === 'payments'} onClick={() => runCsvExport('payments')} />
                        <ExportButton label={t('admin.dashboard.export.listings', {}, 'Export Listings')} busy={exportBusy === 'listings'} onClick={() => runCsvExport('listings')} />
                    </div>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                    {kpis.map((kpi) => (
                        <div key={kpi.key} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                            <div className="flex items-center justify-between">
                                <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">{kpi.title}</p>
                                {kpi.icon}
                            </div>
                            <p className="mt-2 text-2xl font-bold text-slate-900">{analyticsLoading ? <Loader2 className="h-6 w-6 animate-spin text-gray-400" /> : kpi.value}</p>
                            <p className={`mt-1 text-xs font-semibold ${getDeltaClass(kpi.delta, kpi.invert)}`}>{t('admin.dashboard.vsPreviousPeriod', { delta: formatDelta(kpi.delta) }, `${formatDelta(kpi.delta)} vs previous period`)}</p>
                            <p className="mt-1 text-xs text-slate-500">{kpi.hint}</p>
                        </div>
                    ))}
                </div>

                <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
                    <SeriesCard title={t('admin.dashboard.series.orders', {}, 'Orders Timeline')} icon={<Activity className="h-4 w-4 text-indigo-600" />} points={analytics.points} dataKey="orders" formatter={formatNumber} loading={analyticsLoading} />
                    <SeriesCard title={t('admin.dashboard.series.revenue', {}, 'Revenue Timeline')} icon={<TrendingUp className="h-4 w-4 text-emerald-600" />} points={analytics.points} dataKey="revenue" formatter={formatCurrency} loading={analyticsLoading} />
                    <SeriesCard title={t('admin.dashboard.series.failedPayments', {}, 'Failed Payments Timeline')} icon={<AlertTriangle className="h-4 w-4 text-rose-600" />} points={analytics.points} dataKey="failedPayments" formatter={formatNumber} loading={analyticsLoading} />
                </div>

                <div className="admin-premium-subpanel mt-4">
                    <h3 className="text-sm font-semibold text-slate-900">{t('admin.dashboard.detectedAnomalies', {}, 'Detected Anomalies')}</h3>
                    {analyticsLoading ? (
                        <div className="mt-2 flex items-center gap-2 text-sm text-slate-500">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            {t('admin.dashboard.scanningAnomalies', {}, 'Scanning anomaly windows...')}
                        </div>
                    ) : analytics.anomalies.length === 0 ? (
                        <p className="mt-2 text-sm text-emerald-700">{t('admin.dashboard.noActiveAnomaly', {}, 'No active anomaly trigger in the selected window.')}</p>
                    ) : (
                        <div className="mt-2 space-y-2">
                            {analytics.anomalies.map((item) => (
                                <div key={item.key} className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-sm font-bold text-amber-900">{translateDashboardText(item.title)}</span>
                                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${SEVERITY_STYLES[item.severity] || SEVERITY_STYLES.warning}`}>{formatDashboardSeverity(t, item.severity)}</span>
                                    </div>
                                    <p className="mt-1 text-xs text-amber-900">{t('admin.dashboard.anomalyMetrics', { current: item.currentCount, expected: item.baselineExpected, ratio: item.ratio }, `Current ${item.currentCount} | Expected ${item.baselineExpected} | Ratio ${item.ratio}x`)}</p>
                                    <p className="mt-1 text-xs text-amber-800">{translateDashboardText(item.recommendation)}</p>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {biConfig?.powerBi?.enabled && biConfig?.powerBi?.dashboardUrl ? (
                <div className="admin-premium-panel">
                    <div className="flex items-center justify-between">
                        <h2 className="text-lg font-semibold text-gray-900">{t('admin.dashboard.powerBiTitle', { workspace: biConfig.powerBi.workspaceLabel || t('admin.dashboard.executiveWorkspace', {}, 'Executive Workspace') }, `Power BI: ${biConfig.powerBi.workspaceLabel || 'Executive Workspace'}`)}</h2>
                        <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-700">{t('admin.dashboard.mode', { mode: biConfig.mode }, `Mode: ${biConfig.mode}`)}</span>
                    </div>
                    <div className="admin-premium-table-shell mt-3 overflow-hidden">
                        <iframe src={biConfig.powerBi.dashboardUrl} title={t('admin.dashboard.powerBiFrame', {}, 'Power BI Dashboard')} className="h-[520px] w-full" loading="lazy" />
                    </div>
                </div>
            ) : null}

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
                <div className="space-y-4 xl:col-span-2">
                    <div className="admin-premium-panel">
                        <h2 className="text-lg font-semibold text-gray-900">{t('admin.dashboard.topActions', {}, 'Top Actions (24h)')}</h2>
                        <div className="mt-3 space-y-2">
                            {(summary.topActions || []).length === 0 ? (
                                <p className="text-sm text-gray-500">{t('admin.dashboard.noRecentActionBursts', {}, 'No recent action bursts.')}</p>
                            ) : (
                                summary.topActions.map((entry) => (
                                    <div key={entry.actionKey} className="flex items-center justify-between rounded-lg border px-3 py-2">
                                        <p className="break-all pr-2 text-sm font-medium text-gray-700">{formatDashboardActionKey(t, entry.actionKey)}</p>
                                        <span className="text-sm font-bold text-gray-900">{entry.count}</span>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    <div className="admin-premium-panel">
                        <h2 className="text-lg font-semibold text-gray-900">{t('admin.dashboard.quickActions', {}, 'Quick Actions')}</h2>
                        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                            <button type="button" onClick={() => navigate('/admin/orders')} className="admin-premium-button px-3 py-2 text-sm font-semibold">{t('admin.dashboard.quick.openOrders', {}, 'Open Orders Console')}</button>
                            <button type="button" onClick={() => navigate('/admin/payments')} className="admin-premium-button px-3 py-2 text-sm font-semibold">{t('admin.dashboard.quick.openPayments', {}, 'Open Payment Ops')}</button>
                            <button type="button" onClick={() => navigate('/admin/products')} className="admin-premium-button px-3 py-2 text-sm font-semibold">{t('admin.dashboard.quick.productControl', {}, 'Product Control')}</button>
                            <button type="button" onClick={() => navigate('/admin/dashboard')} className="admin-premium-button admin-premium-button-accent px-3 py-2 text-sm font-semibold">{currentUser?.email || t('admin.dashboard.portalSession', {}, 'Portal Session')}</button>
                        </div>
                    </div>
                </div>

                <div className="admin-premium-panel xl:col-span-3">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <h2 className="text-lg font-semibold text-gray-900">{t('admin.dashboard.liveNotificationFeed', {}, 'Live Notification Feed')}</h2>
                        <div className="flex flex-wrap items-center gap-2">
                            <input type="text" value={filters.search} onChange={(e) => { setPage(1); setFilters((prev) => ({ ...prev, search: e.target.value })); }} placeholder={t('admin.dashboard.searchNotifications', {}, 'Search action, actor, path...')} className="admin-premium-control" />
                            <PremiumSelect value={filters.severity} onChange={(e) => { setPage(1); setFilters((prev) => ({ ...prev, severity: e.target.value })); }} className="admin-premium-control">
                                <option value="">{t('admin.diagnostics.filters.allSeverities', {}, 'All Severities')}</option>
                                <option value="info">{t('admin.diagnostics.severity.info', {}, 'Info')}</option>
                                <option value="warning">{t('admin.diagnostics.severity.warning', {}, 'Warning')}</option>
                                <option value="critical">{t('admin.diagnostics.severity.critical', {}, 'Critical')}</option>
                            </PremiumSelect>
                            <label className="admin-premium-button inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm">
                                <input type="checkbox" checked={filters.unreadOnly} onChange={(e) => { setPage(1); setFilters((prev) => ({ ...prev, unreadOnly: e.target.checked })); }} />
                                {t('admin.dashboard.unreadOnly', {}, 'Unread Only')}
                            </label>
                        </div>
                    </div>

                    <div className="mt-4 space-y-3">
                        {listLoading ? (
                            <div className="flex items-center gap-2 rounded-lg border border-dashed p-4 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" />{t('admin.dashboard.loadingNotifications', {}, 'Loading notifications...')}</div>
                        ) : notifications.length === 0 ? (
                            <div className="rounded-lg border border-dashed p-4 text-sm text-gray-500">{t('admin.dashboard.noNotificationsMatch', {}, 'No notifications match current filters.')}</div>
                        ) : (
                            notifications.map((entry) => (
                                <div key={entry.notificationId} className="admin-premium-subpanel">
                                    <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                                        <div>
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="text-sm font-bold text-gray-900">{translateDashboardText(entry.title)}</span>
                                                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${SEVERITY_STYLES[entry.severity] || SEVERITY_STYLES.info}`}>{formatDashboardSeverity(t, entry.severity)}</span>
                                                <span className="rounded-full border border-gray-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gray-600">{formatDashboardActionKey(t, entry.actionKey)}</span>
                                            </div>
                                            <p className="mt-1 text-sm text-gray-600">{translateDashboardText(entry.summary)}</p>
                                            <p className="mt-1 text-xs text-gray-500">{entry.actor?.email || t('admin.dashboard.unknownActor', {}, 'Unknown actor')} | {formatDashboardMethod(t, entry.method)} {entry.path}</p>
                                            <p className="mt-1 text-xs text-gray-400">{t('admin.dashboard.notificationMeta', { time: formatDateTime(entry.createdAt), duration: entry.durationMs, status: entry.statusCode }, `${formatDateTime(entry.createdAt)} | ${entry.durationMs} ms | status ${entry.statusCode}`)}</p>
                                        </div>
                                        <button type="button" disabled={busyNotificationId === entry.notificationId} onClick={() => toggleRead(entry)} className={`admin-premium-button inline-flex items-center justify-center px-3 py-2 text-xs font-semibold ${entry.isRead ? '' : 'admin-premium-button-success'} disabled:opacity-60`}>
                                            {busyNotificationId === entry.notificationId ? t('admin.dashboard.updating', {}, 'Updating...') : entry.isRead ? t('admin.dashboard.markUnread', {}, 'Mark Unread') : t('admin.dashboard.markRead', {}, 'Mark Read')}
                                        </button>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>

                    <div className="mt-4 flex items-center justify-between border-t pt-3">
                        <p className="text-sm text-gray-500">{t('admin.dashboard.totalRecordsPage', { total, page, pages: totalPages }, `${total} total records | page ${page} / ${totalPages}`)}</p>
                        <div className="flex items-center gap-2">
                            <button type="button" disabled={page <= 1} onClick={() => setPage((prev) => Math.max(prev - 1, 1))} className="admin-premium-button px-3 py-1.5 text-sm disabled:opacity-50">{t('admin.shared.previous', {}, 'Previous')}</button>
                            <button type="button" disabled={page >= totalPages} onClick={() => setPage((prev) => prev + 1)} className="admin-premium-button px-3 py-1.5 text-sm disabled:opacity-50">{t('admin.shared.next', {}, 'Next')}</button>
                        </div>
                    </div>
                </div>
            </div>
        </AdminPremiumShell>
    );
}

function ExportButton({ label, busy, onClick }) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={busy}
            className="admin-premium-button px-3 py-2 text-xs disabled:opacity-60"
        >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            {label}
        </button>
    );
}

function SeriesCard({ title, icon, points, dataKey, formatter, loading }) {
    const { t } = useMarket();
    const values = points.map((item) => Number(item?.[dataKey] || 0));
    const max = Math.max(...values, 1);
    const visible = points.slice(-24);
    const latest = Number(visible[visible.length - 1]?.[dataKey] || 0);

    return (
        <div className="admin-premium-subpanel p-3">
            <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-900">{title}</p>
                {icon}
            </div>
            {loading ? (
                <div className="mt-4 flex items-center gap-2 text-xs text-slate-500">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {t('admin.dashboard.loadingTimeline', {}, 'Loading timeline...')}
                </div>
            ) : visible.length === 0 ? (
                <p className="mt-4 text-xs text-slate-500">{t('admin.dashboard.noTimelineData', {}, 'No timeline data in current range.')}</p>
            ) : (
                <>
                    <div className="mt-3 flex h-24 items-end gap-1">
                        {visible.map((point) => {
                            const value = Number(point?.[dataKey] || 0);
                            const height = Math.max((value / max) * 100, 4);
                            return (
                                <div
                                    key={`${dataKey}-${point.bucket}`}
                                    className="w-full rounded-t bg-gradient-to-t from-cyan-500 to-indigo-500"
                                    style={{ height: `${height}%` }}
                                    title={`${point.bucket}: ${formatter(value)}`}
                                />
                            );
                        })}
                    </div>
                    <p className="mt-2 text-xs font-semibold text-slate-700">{t('admin.dashboard.latest', { value: formatter(latest) }, `Latest: ${formatter(latest)}`)}</p>
                </>
            )}
        </div>
    );
}

function HealthCell({ icon, label, value, ok, loading }) {
    const { t } = useMarket();
    return (
        <div className="admin-premium-subpanel rounded-lg p-2">
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                    {icon}
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">{label}</p>
                </div>
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                    ok ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-rose-200 bg-rose-50 text-rose-700'
                }`}>
                    {ok ? t('admin.dashboard.ok', {}, 'ok') : t('admin.dashboard.risk', {}, 'risk')}
                </span>
            </div>
            <p className="mt-1 text-sm font-semibold text-slate-900">
                {loading ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" /> : value}
            </p>
        </div>
    );
}

function StatCard({ title, value, icon, loading }) {
    return (
        <div className="admin-premium-stat-card">
            <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-gray-600">{title}</p>
                {icon}
            </div>
            <p className="mt-3 text-3xl font-bold text-gray-900">
                {loading ? <Loader2 className="h-6 w-6 animate-spin text-gray-400" /> : value}
            </p>
        </div>
    );
}
