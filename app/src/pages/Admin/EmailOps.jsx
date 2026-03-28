import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    AlertTriangle,
    CheckCircle2,
    Clock3,
    Mail,
    MailWarning,
    RefreshCw,
    RotateCcw,
    Send,
    ShieldCheck,
    XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import AdminPremiumShell, { AdminHeroStat } from '@/components/shared/AdminPremiumShell';
import PremiumSelect from '@/components/ui/premium-select';
import { useMarket } from '@/context/MarketContext';
import { adminApi } from '@/services/api/adminApi';
import { normalizeEnumToken, translateEnumLabel } from '@/utils/enumLocalization';

const SUMMARY_FALLBACK = {
    provider: {
        active: 'unknown',
        orderEmailsEnabled: false,
        activityEmailsEnabled: false,
        fromName: '',
        fromAddress: '',
        replyTo: '',
        alertTo: '',
        resendWebhookConfigured: false,
        available: { gmail: false, resend: false },
    },
    queue: {
        status: 'unknown',
        pending: 0,
        processing: 0,
        retry: 0,
        failed: 0,
        workerRunning: false,
    },
    last24h: {
        total: 0,
        statuses: { sent: 0, failed: 0, skipped: 0 },
        eventTypes: [],
    },
    latestDeliveries: [],
    recentFailures: [],
};

const DELIVERIES_FALLBACK = { items: [], total: 0, page: 1, limit: 12 };
const QUEUE_FALLBACK = { items: [], total: 0, page: 1, limit: 10 };

const statusPillClass = (status) => {
    switch (String(status || '').toLowerCase()) {
        case 'sent':
            return 'border-emerald-200 bg-emerald-50 text-emerald-700';
        case 'failed':
            return 'border-rose-200 bg-rose-50 text-rose-700';
        case 'retry':
        case 'processing':
            return 'border-amber-200 bg-amber-50 text-amber-700';
        case 'pending':
        case 'skipped':
            return 'border-slate-200 bg-slate-50 text-slate-700';
        default:
            return 'border-slate-200 bg-slate-50 text-slate-700';
    }
};

const providerPillClass = (enabled) => enabled
    ? 'border-cyan-200 bg-cyan-50 text-cyan-700'
    : 'border-slate-200 bg-slate-50 text-slate-500';

const formatEmailStatus = (t, value) => {
    const normalized = String(value || '').trim().toLowerCase();
    switch (normalized) {
        case 'sent':
            return t('admin.email.status.sent', {}, 'Sent');
        case 'failed':
            return t('admin.email.status.failed', {}, 'Failed');
        case 'retry':
            return t('admin.email.status.retry', {}, 'Retry');
        case 'processing':
            return t('admin.email.status.processing', {}, 'Processing');
        case 'pending':
            return t('admin.email.status.pending', {}, 'Pending');
        case 'skipped':
            return t('admin.email.status.skipped', {}, 'Skipped');
        case 'unknown':
            return t('admin.email.status.unknown', {}, 'Unknown');
        default:
            return value || t('admin.shared.unknown', {}, 'unknown');
    }
};

const formatEmailProvider = (t, value) => {
    const normalized = normalizeEnumToken(value);
    switch (normalized) {
        case 'gmail':
            return 'Gmail';
        case 'resend':
            return 'Resend';
        case 'disabled':
            return t('admin.email.disabled', {}, 'Disabled');
        case 'unknown':
            return t('admin.shared.unknown', {}, 'Unknown');
        default:
            return translateEnumLabel(t, 'admin.email.provider', value);
    }
};

const formatEmailEventType = (t, value) => translateEnumLabel(t, 'admin.email.eventType', value);

export default function AdminEmailOps() {
    const { t, formatDateTime } = useMarket();
    const [summary, setSummary] = useState(SUMMARY_FALLBACK);
    const [summaryLoading, setSummaryLoading] = useState(true);
    const [deliveries, setDeliveries] = useState(DELIVERIES_FALLBACK);
    const [deliveriesLoading, setDeliveriesLoading] = useState(true);
    const [queue, setQueue] = useState(QUEUE_FALLBACK);
    const [queueLoading, setQueueLoading] = useState(true);
    const [retryingId, setRetryingId] = useState('');
    const [testRecipient, setTestRecipient] = useState('');
    const [testSending, setTestSending] = useState(false);
    const [deliveryFilters, setDeliveryFilters] = useState({
        page: 1,
        limit: 12,
        status: '',
        provider: '',
        eventType: '',
        search: '',
    });
    const [queueFilters, setQueueFilters] = useState({
        page: 1,
        limit: 10,
        status: '',
        recipient: '',
    });

    const loadSummary = useCallback(async () => {
        try {
            setSummaryLoading(true);
            const response = await adminApi.getEmailOpsSummary();
            setSummary(response?.summary || SUMMARY_FALLBACK);
        } catch (error) {
            toast.error(error.message || t('admin.email.error.loadSummary', {}, 'Failed to load email operations summary'));
            setSummary(SUMMARY_FALLBACK);
        } finally {
            setSummaryLoading(false);
        }
    }, []);

    const loadDeliveries = useCallback(async () => {
        try {
            setDeliveriesLoading(true);
            const response = await adminApi.listEmailDeliveries(deliveryFilters);
            setDeliveries({
                items: response?.items || [],
                total: Number(response?.total || 0),
                page: Number(response?.page || deliveryFilters.page || 1),
                limit: Number(response?.limit || deliveryFilters.limit || 12),
            });
        } catch (error) {
            toast.error(error.message || t('admin.email.error.loadDeliveries', {}, 'Failed to load delivery logs'));
            setDeliveries(DELIVERIES_FALLBACK);
        } finally {
            setDeliveriesLoading(false);
        }
    }, [deliveryFilters]);

    const loadQueue = useCallback(async () => {
        try {
            setQueueLoading(true);
            const response = await adminApi.listEmailQueue(queueFilters);
            setQueue({
                items: response?.items || [],
                total: Number(response?.total || 0),
                page: Number(response?.page || queueFilters.page || 1),
                limit: Number(response?.limit || queueFilters.limit || 10),
            });
        } catch (error) {
            toast.error(error.message || t('admin.email.error.loadQueue', {}, 'Failed to load order email queue'));
            setQueue(QUEUE_FALLBACK);
        } finally {
            setQueueLoading(false);
        }
    }, [queueFilters]);

    const refreshAll = useCallback(async () => {
        await Promise.all([loadSummary(), loadDeliveries(), loadQueue()]);
    }, [loadSummary, loadDeliveries, loadQueue]);

    useEffect(() => {
        refreshAll();
    }, [refreshAll]);

    const queueBacklog = useMemo(
        () => Number(summary.queue.pending || 0) + Number(summary.queue.retry || 0) + Number(summary.queue.processing || 0),
        [summary.queue.pending, summary.queue.retry, summary.queue.processing]
    );

    const retryQueueItem = async (notificationId) => {
        try {
            setRetryingId(notificationId);
            await adminApi.retryEmailQueueItem(notificationId);
            toast.success(t('admin.email.success.retryQueued', {}, 'Order email retry queued'));
            await Promise.all([loadSummary(), loadQueue()]);
        } catch (error) {
            toast.error(error.message || t('admin.email.error.retry', {}, 'Failed to retry order email'));
        } finally {
            setRetryingId('');
        }
    };

    const sendTestEmail = async () => {
        try {
            setTestSending(true);
            const response = await adminApi.sendEmailOpsTest({
                recipientEmail: testRecipient.trim() || undefined,
            });
            toast.success(t('admin.email.success.testSent', { recipient: response?.delivery?.recipientEmail || t('admin.email.designatedInbox', {}, 'designated inbox') }, `Test email queued to ${response?.delivery?.recipientEmail || 'designated inbox'}`));
            await Promise.all([loadSummary(), loadDeliveries()]);
        } catch (error) {
            toast.error(error.message || t('admin.email.error.sendTest', {}, 'Failed to send test email'));
        } finally {
            setTestSending(false);
        }
    };

    return (
        <AdminPremiumShell
            eyebrow={t('admin.email.eyebrow', {}, 'Unified Messaging Control')}
            title={t('admin.email.title', {}, 'Email operations portal')}
            description={t('admin.email.description', {}, 'One operational command deck for provider posture, persistent delivery logs, live failure visibility, and order-email recovery workflows.')}
            actions={(
                <>
                    <input
                        type="email"
                        value={testRecipient}
                        onChange={(event) => setTestRecipient(event.target.value)}
                        placeholder={t('admin.email.testRecipientPlaceholder', {}, 'Optional designate email')}
                        className="admin-premium-control min-w-[240px]"
                    />
                    <button type="button" className="admin-premium-button admin-premium-button-success" onClick={sendTestEmail} disabled={testSending}>
                        <Send className="h-4 w-4" />
                        {testSending ? t('admin.email.sendingTest', {}, 'Sending test...') : t('admin.email.actions.sendTest', {}, 'Send test')}
                    </button>
                    <button type="button" className="admin-premium-button admin-premium-button-accent" onClick={refreshAll}>
                        <RefreshCw className="h-4 w-4" />
                        {t('admin.email.actions.refreshAll', {}, 'Refresh all')}
                    </button>
                </>
            )}
            stats={[
                <AdminHeroStat
                    key="provider"
                    label={t('admin.email.stats.activeProvider', {}, 'Active provider')}
                    value={summaryLoading ? t('admin.shared.busy', {}, '...') : formatEmailProvider(t, summary.provider.active || t('admin.shared.unknown', {}, 'unknown'))}
                    detail={summaryLoading ? t('admin.email.loadingProviderPosture', {}, 'Loading provider posture') : (summary.provider.orderEmailsEnabled ? t('admin.email.transactionalArmed', {}, 'Transactional email armed') : t('admin.email.transactionalDisabled', {}, 'Transactional email disabled'))}
                    icon={<Mail className="h-5 w-5" />}
                />,
                <AdminHeroStat
                    key="sent"
                    label={t('admin.email.stats.sent24h', {}, 'Sent in 24h')}
                    value={summaryLoading ? t('admin.shared.busy', {}, '...') : Number(summary.last24h.statuses.sent || 0)}
                    detail={summaryLoading ? t('admin.email.loadingDeliveryLog', {}, 'Loading delivery log') : t('admin.email.totalAttempts', { count: Number(summary.last24h.total || 0) }, `${Number(summary.last24h.total || 0)} total attempts`)}
                    icon={<Send className="h-5 w-5" />}
                />,
                <AdminHeroStat
                    key="failed"
                    label={t('admin.email.stats.failed24h', {}, 'Failed in 24h')}
                    value={summaryLoading ? t('admin.shared.busy', {}, '...') : Number(summary.last24h.statuses.failed || 0)}
                    detail={summaryLoading ? t('admin.email.loadingFailures', {}, 'Loading failures') : t('admin.email.recentFailureRecords', { count: Number(summary.recentFailures.length || 0) }, `${Number(summary.recentFailures.length || 0)} recent failure records`)}
                    icon={<MailWarning className="h-5 w-5" />}
                />,
                <AdminHeroStat
                    key="queue"
                    label={t('admin.email.stats.queueBacklog', {}, 'Queue backlog')}
                    value={summaryLoading ? t('admin.shared.busy', {}, '...') : queueBacklog}
                    detail={summaryLoading ? t('admin.email.loadingQueueHealth', {}, 'Loading queue health') : (summary.queue.workerRunning ? t('admin.email.workerOnline', {}, 'Worker online') : t('admin.email.workerAttentionRequired', {}, 'Worker attention required'))}
                    icon={<ShieldCheck className="h-5 w-5" />}
                />,
            ]}
        >
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                <section className="admin-premium-panel">
                    <div className="flex items-center justify-between">
                        <div>
                            <h2 className="text-lg font-semibold text-slate-900">{t('admin.email.providerPosture', {}, 'Provider posture')}</h2>
                            <p className="text-sm text-slate-500">{t('admin.email.providerPostureBody', {}, 'Real sender wiring and designate addresses.')}</p>
                        </div>
                        <span className={`rounded-full border px-2.5 py-1 text-xs font-bold uppercase tracking-wide ${providerPillClass(summary.provider.orderEmailsEnabled)}`}>
                            {summary.provider.orderEmailsEnabled ? t('admin.email.armed', {}, 'armed') : t('admin.email.disabled', {}, 'disabled')}
                        </span>
                    </div>

                    <div className="mt-4 grid grid-cols-1 gap-3">
                        <ProviderLine label={t('admin.email.stats.activeProvider', {}, 'Active provider')} value={formatEmailProvider(t, summary.provider.active || t('admin.shared.unknown', {}, 'unknown'))} />
                        <ProviderLine label={t('admin.email.from', {}, 'From')} value={summary.provider.fromAddress || '-'} />
                        <ProviderLine label={t('admin.email.replyTo', {}, 'Reply-to')} value={summary.provider.replyTo || '-'} />
                        <ProviderLine label={t('admin.email.failureAlert', {}, 'Failure alert')} value={summary.provider.alertTo || '-'} />
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                        <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${providerPillClass(summary.provider.available.gmail)}`}>
                            Gmail {summary.provider.available.gmail ? t('admin.email.configured', {}, 'configured') : t('admin.email.missing', {}, 'missing')}
                        </span>
                        <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${providerPillClass(summary.provider.available.resend)}`}>
                            Resend {summary.provider.available.resend ? t('admin.email.configured', {}, 'configured') : t('admin.email.missing', {}, 'missing')}
                        </span>
                        <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${providerPillClass(summary.provider.resendWebhookConfigured)}`}>
                            {t('admin.email.resendWebhook', {}, 'Resend webhook')} {summary.provider.resendWebhookConfigured ? t('admin.email.configured', {}, 'configured') : t('admin.email.missing', {}, 'missing')}
                        </span>
                        <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${providerPillClass(summary.provider.activityEmailsEnabled)}`}>
                            {t('admin.email.activityEmail', {}, 'Activity email')} {summary.provider.activityEmailsEnabled ? t('admin.email.enabled', {}, 'enabled') : t('admin.email.disabled', {}, 'disabled')}
                        </span>
                    </div>
                </section>

                <section className="admin-premium-panel">
                    <div className="flex items-center justify-between">
                        <div>
                            <h2 className="text-lg font-semibold text-slate-900">{t('admin.email.queueHealth', {}, 'Queue health')}</h2>
                            <p className="text-sm text-slate-500">{t('admin.email.queueHealthBody', {}, 'Persistent order-email worker state.')}</p>
                        </div>
                        <span className={`rounded-full border px-2.5 py-1 text-xs font-bold uppercase tracking-wide ${statusPillClass(summary.queue.status)}`}>
                            {formatEmailStatus(t, summary.queue.status)}
                        </span>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-3">
                        <MetricCard label={t('admin.email.pending', {}, 'Pending')} value={summary.queue.pending} icon={<Clock3 className="h-4 w-4 text-amber-600" />} />
                        <MetricCard label={t('admin.email.processing', {}, 'Processing')} value={summary.queue.processing} icon={<RefreshCw className="h-4 w-4 text-cyan-600" />} />
                        <MetricCard label={t('admin.email.retry', {}, 'Retry')} value={summary.queue.retry} icon={<RotateCcw className="h-4 w-4 text-indigo-600" />} />
                        <MetricCard label={t('admin.email.failed', {}, 'Failed')} value={summary.queue.failed} icon={<XCircle className="h-4 w-4 text-rose-600" />} />
                    </div>
                </section>

                <section className="admin-premium-panel">
                    <h2 className="text-lg font-semibold text-slate-900">{t('admin.email.eventMix', {}, 'Event mix (24h)')}</h2>
                    <p className="text-sm text-slate-500">{t('admin.email.eventMixBody', {}, 'Top email-producing flows across the app.')}</p>
                    <div className="mt-4 space-y-2">
                        {(summary.last24h.eventTypes || []).length === 0 ? (
                            <p className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-500">{t('admin.email.emptyEvents', {}, 'No persistent events logged yet.')}</p>
                        ) : (
                            summary.last24h.eventTypes.map((entry) => (
                                <div key={entry.eventType} className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2">
                                    <span className="text-sm font-medium text-slate-700">{formatEmailEventType(t, entry.eventType)}</span>
                                    <span className="text-sm font-bold text-slate-900">{entry.count}</span>
                                </div>
                            ))
                        )}
                    </div>
                </section>
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <section className="admin-premium-panel">
                    <div className="flex items-center justify-between">
                        <div>
                            <h2 className="text-lg font-semibold text-slate-900">{t('admin.email.recentFailures', {}, 'Recent failures')}</h2>
                            <p className="text-sm text-slate-500">{t('admin.email.recentFailuresBody', {}, 'Fastest signal for live provider trouble.')}</p>
                        </div>
                        <AlertTriangle className="h-5 w-5 text-rose-600" />
                    </div>
                    <div className="mt-4 space-y-3">
                        {(summary.recentFailures || []).length === 0 ? (
                            <p className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-emerald-700">{t('admin.email.emptyFailures', {}, 'No recent persistent failures.')}</p>
                        ) : (
                            summary.recentFailures.map((entry) => (
                                <div key={entry.deliveryId} className="rounded-xl border border-rose-200 bg-rose-50 p-3">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-sm font-semibold text-rose-900">{formatEmailEventType(t, entry.eventType)}</span>
                                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${statusPillClass(entry.status)}`}>
                                            {formatEmailStatus(t, entry.status)}
                                        </span>
                                        <span className="text-xs text-rose-700">{formatEmailProvider(t, entry.provider)}</span>
                                    </div>
                                    <p className="mt-1 text-xs text-rose-800">{entry.recipientEmail || entry.recipientMask || '-'}</p>
                                    <p className="mt-1 text-xs text-rose-800">{entry.errorCode || t('admin.email.unknownCode', {}, 'UNKNOWN')}: {entry.errorMessage || t('admin.email.noErrorMessage', {}, 'No error message captured')}</p>
                                    <p className="mt-1 text-[11px] text-rose-700">{formatDateTime(entry.createdAt)}</p>
                                </div>
                            ))
                        )}
                    </div>
                </section>

                <section className="admin-premium-panel">
                    <div className="flex items-center justify-between">
                        <div>
                            <h2 className="text-lg font-semibold text-slate-900">{t('admin.email.latestDeliveries', {}, 'Latest deliveries')}</h2>
                            <p className="text-sm text-slate-500">{t('admin.email.latestDeliveriesBody', {}, 'Persistent gateway records across all email services.')}</p>
                        </div>
                        <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                    </div>
                    <div className="mt-4 space-y-3">
                        {(summary.latestDeliveries || []).length === 0 ? (
                            <p className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-500">{t('admin.email.emptyDeliveries', {}, 'No delivery records yet.')}</p>
                        ) : (
                            summary.latestDeliveries.map((entry) => (
                                <div key={entry.deliveryId} className="rounded-xl border border-slate-200 p-3">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-sm font-semibold text-slate-900">{formatEmailEventType(t, entry.eventType)}</span>
                                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${statusPillClass(entry.status)}`}>
                                            {formatEmailStatus(t, entry.status)}
                                        </span>
                                        <span className="text-xs text-slate-500">{formatEmailProvider(t, entry.provider)}</span>
                                    </div>
                                    <p className="mt-1 text-xs text-slate-600">{entry.recipientEmail || entry.recipientMask || '-'}</p>
                                    <p className="mt-1 text-[11px] text-slate-500">{formatDateTime(entry.createdAt)}</p>
                                </div>
                            ))
                        )}
                    </div>
                </section>
            </div>

            <section className="admin-premium-panel">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                    <div>
                        <h2 className="text-lg font-semibold text-slate-900">{t('admin.email.deliveryExplorer', {}, 'Delivery explorer')}</h2>
                        <p className="text-sm text-slate-500">{t('admin.email.deliveryExplorerBody', {}, 'Search OTP, activity, admin-action, and order email delivery history in one place.')}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <input
                            type="text"
                            value={deliveryFilters.search}
                            onChange={(event) => setDeliveryFilters((prev) => ({ ...prev, page: 1, search: event.target.value }))}
                            placeholder={t('admin.email.searchDeliveriesPlaceholder', {}, 'Search recipient, event, request, subject...')}
                            className="admin-premium-control min-w-[260px]"
                        />
                        <PremiumSelect value={deliveryFilters.status} onChange={(event) => setDeliveryFilters((prev) => ({ ...prev, page: 1, status: event.target.value }))} className="admin-premium-control min-w-[140px]">
                            <option value="">{t('admin.email.allStatuses', {}, 'All statuses')}</option>
                            <option value="sent">{t('admin.email.sent', {}, 'Sent')}</option>
                            <option value="failed">{t('admin.email.failed', {}, 'Failed')}</option>
                            <option value="skipped">{t('admin.email.skipped', {}, 'Skipped')}</option>
                        </PremiumSelect>
                        <PremiumSelect value={deliveryFilters.provider} onChange={(event) => setDeliveryFilters((prev) => ({ ...prev, page: 1, provider: event.target.value }))} className="admin-premium-control min-w-[140px]">
                            <option value="">{t('admin.email.allProviders', {}, 'All providers')}</option>
                            <option value="gmail">{formatEmailProvider(t, 'gmail')}</option>
                            <option value="resend">{formatEmailProvider(t, 'resend')}</option>
                            <option value="disabled">{t('admin.email.disabled', {}, 'Disabled')}</option>
                            <option value="unknown">{t('admin.shared.unknown', {}, 'Unknown')}</option>
                        </PremiumSelect>
                    </div>
                </div>

                <div className="mt-4 overflow-x-auto">
                    <table className="min-w-full divide-y divide-slate-200">
                        <thead>
                            <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                                <th className="px-3 py-2">{t('admin.email.table.event', {}, 'Event')}</th>
                                <th className="px-3 py-2">{t('admin.email.table.recipient', {}, 'Recipient')}</th>
                                <th className="px-3 py-2">{t('admin.email.table.provider', {}, 'Provider')}</th>
                                <th className="px-3 py-2">{t('admin.email.table.status', {}, 'Status')}</th>
                                <th className="px-3 py-2">{t('admin.email.table.time', {}, 'Time')}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {deliveriesLoading ? (
                                <tr><td className="px-3 py-6 text-sm text-slate-500" colSpan={5}>{t('admin.email.loadingDeliveries', {}, 'Loading delivery logs...')}</td></tr>
                            ) : deliveries.items.length === 0 ? (
                                <tr><td className="px-3 py-6 text-sm text-slate-500" colSpan={5}>{t('admin.email.emptyDeliveryLogs', {}, 'No delivery logs match current filters.')}</td></tr>
                            ) : (
                                deliveries.items.map((entry) => (
                                    <tr key={entry.deliveryId} className="text-sm text-slate-700">
                                        <td className="px-3 py-3">
                                            <div className="font-semibold text-slate-900">{formatEmailEventType(t, entry.eventType)}</div>
                                            <div className="text-xs text-slate-500">{entry.subject || '-'}</div>
                                        </td>
                                        <td className="px-3 py-3">
                                            <div>{entry.recipientEmail || entry.recipientMask || '-'}</div>
                                            <div className="text-xs text-slate-500">{entry.requestId || '-'}</div>
                                        </td>
                                        <td className="px-3 py-3">{formatEmailProvider(t, entry.provider)}</td>
                                        <td className="px-3 py-3">
                                            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${statusPillClass(entry.status)}`}>
                                                {formatEmailStatus(t, entry.status)}
                                            </span>
                                            {entry.errorCode ? <div className="mt-1 text-xs text-rose-600">{entry.errorCode}</div> : null}
                                        </td>
                                        <td className="px-3 py-3 text-xs text-slate-500">{formatDateTime(entry.createdAt)}</td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </section>

            <section className="admin-premium-panel">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                    <div>
                        <h2 className="text-lg font-semibold text-slate-900">{t('admin.email.orderQueue', {}, 'Order email queue')}</h2>
                        <p className="text-sm text-slate-500">{t('admin.email.orderQueueBody', {}, 'Persistent retry console for customer order confirmations.')}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <input
                            type="text"
                            value={queueFilters.recipient}
                            onChange={(event) => setQueueFilters((prev) => ({ ...prev, page: 1, recipient: event.target.value }))}
                            placeholder={t('admin.email.filterRecipientPlaceholder', {}, 'Filter by recipient')}
                            className="admin-premium-control min-w-[220px]"
                        />
                        <PremiumSelect value={queueFilters.status} onChange={(event) => setQueueFilters((prev) => ({ ...prev, page: 1, status: event.target.value }))} className="admin-premium-control min-w-[150px]">
                            <option value="">{t('admin.email.allQueueStates', {}, 'All queue states')}</option>
                            <option value="pending">{t('admin.email.pending', {}, 'Pending')}</option>
                            <option value="processing">{t('admin.email.processing', {}, 'Processing')}</option>
                            <option value="retry">{t('admin.email.retry', {}, 'Retry')}</option>
                            <option value="sent">{t('admin.email.sent', {}, 'Sent')}</option>
                            <option value="failed">{t('admin.email.failed', {}, 'Failed')}</option>
                        </PremiumSelect>
                    </div>
                </div>

                <div className="mt-4 overflow-x-auto">
                    <table className="min-w-full divide-y divide-slate-200">
                        <thead>
                            <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                                <th className="px-3 py-2">{t('admin.email.table.notification', {}, 'Notification')}</th>
                                <th className="px-3 py-2">{t('admin.email.table.recipient', {}, 'Recipient')}</th>
                                <th className="px-3 py-2">{t('admin.email.table.attempts', {}, 'Attempts')}</th>
                                <th className="px-3 py-2">{t('admin.email.table.state', {}, 'State')}</th>
                                <th className="px-3 py-2">{t('admin.email.table.nextAttempt', {}, 'Next attempt')}</th>
                                <th className="px-3 py-2">{t('admin.email.table.action', {}, 'Action')}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {queueLoading ? (
                                <tr><td className="px-3 py-6 text-sm text-slate-500" colSpan={6}>{t('admin.email.loadingQueue', {}, 'Loading queue...')}</td></tr>
                            ) : queue.items.length === 0 ? (
                                <tr><td className="px-3 py-6 text-sm text-slate-500" colSpan={6}>{t('admin.email.emptyQueue', {}, 'No queued notifications match current filters.')}</td></tr>
                            ) : (
                                queue.items.map((entry) => (
                                    <tr key={entry.notificationId} className="text-sm text-slate-700">
                                        <td className="px-3 py-3">
                                            <div className="font-semibold text-slate-900">{entry.notificationId}</div>
                                            <div className="text-xs text-slate-500">{entry.order?._id || '-'}</div>
                                        </td>
                                        <td className="px-3 py-3">
                                            <div>{entry.recipientEmail}</div>
                                            <div className="text-xs text-slate-500">{entry.user?.email || entry.user?.name || '-'}</div>
                                        </td>
                                        <td className="px-3 py-3">{entry.attemptCount} / {entry.maxAttempts}</td>
                                        <td className="px-3 py-3">
                                            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${statusPillClass(entry.status)}`}>
                                                {formatEmailStatus(t, entry.status)}
                                            </span>
                                            {entry.lastErrorCode ? <div className="mt-1 text-xs text-rose-600">{entry.lastErrorCode}</div> : null}
                                        </td>
                                        <td className="px-3 py-3 text-xs text-slate-500">{formatDateTime(entry.nextAttemptAt)}</td>
                                        <td className="px-3 py-3">
                                            <button
                                                type="button"
                                                className="admin-premium-button admin-premium-button-accent px-3 py-1.5 text-xs disabled:opacity-60"
                                                onClick={() => retryQueueItem(entry.notificationId)}
                                                disabled={retryingId === entry.notificationId || entry.status === 'processing' || entry.status === 'sent'}
                                            >
                                                {retryingId === entry.notificationId ? t('admin.email.retrying', {}, 'Retrying...') : t('admin.email.retry', {}, 'Retry')}
                                            </button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </section>
        </AdminPremiumShell>
    );
}

function ProviderLine({ label, value }) {
    return (
        <div className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
            <span className="max-w-[70%] break-all text-right text-sm font-medium text-slate-900">{value}</span>
        </div>
    );
}

function MetricCard({ label, value, icon }) {
    return (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
                {icon}
            </div>
            <p className="mt-2 text-2xl font-bold text-slate-900">{Number(value || 0)}</p>
        </div>
    );
}
