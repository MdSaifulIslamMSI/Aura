import { useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw, CreditCard, ShieldAlert, CircleCheck, CircleX, Activity, Clock3 } from 'lucide-react';
import { toast } from 'sonner';
import AdminPremiumShell, { AdminHeroStat } from '@/components/shared/AdminPremiumShell';
import PremiumSelect from '@/components/ui/premium-select';
import { useMarket } from '@/context/MarketContext';
import { paymentApi } from '@/services/api/paymentApi';
import { formatPrice } from '@/utils/format';

const STATUS_COLORS = {
    created: 'bg-slate-100 text-slate-700',
    challenge_pending: 'bg-amber-100 text-amber-700',
    authorized: 'bg-cyan-100 text-cyan-700',
    captured: 'bg-emerald-100 text-emerald-700',
    failed: 'bg-rose-100 text-rose-700',
    refunded: 'bg-violet-100 text-violet-700',
    partially_refunded: 'bg-purple-100 text-purple-700',
    expired: 'bg-gray-100 text-gray-600',
};

const STATUS_OPTIONS = ['', 'created', 'challenge_pending', 'authorized', 'captured', 'failed', 'partially_refunded', 'refunded', 'expired'];
const METHOD_OPTIONS = ['', 'UPI', 'CARD', 'WALLET', 'NETBANKING'];
const PROVIDER_OPTIONS = ['', 'razorpay'];
const REFUND_MODE_OPTIONS = [
    { value: 'settlement', label: 'Settlement Amount' },
    { value: 'charge', label: 'Charge Amount' },
];

const getStatusClass = (status) => STATUS_COLORS[status] || 'bg-slate-100 text-slate-700';
const getChargeCurrency = (intent = {}) => intent.currency || 'INR';
const getSettlementCurrency = (intent = {}) => intent.providerBaseCurrency || intent.settlementCurrency || intent.currency || 'INR';
const getSettlementAmount = (intent = {}) => (
    intent.providerBaseAmount ?? intent.settlementAmount ?? intent.amount ?? 0
);
const getMarketSummary = (intent = {}) => {
    const country = intent.marketCountryCode || intent.metadata?.paymentContext?.market?.countryCode || '';
    const currency = intent.marketCurrency || intent.metadata?.paymentContext?.market?.currency || '';
    return [country, currency].filter(Boolean).join(' / ');
};
const getRefundInputLabel = (t, detail, amountMode) => {
    if (amountMode === 'charge') {
        return t('admin.payments.refund.chargeAmount', { currency: getChargeCurrency(detail) }, `Refund charge amount (${getChargeCurrency(detail)})`);
    }
    return t('admin.payments.refund.settlementAmount', { currency: getSettlementCurrency(detail) }, `Refund settlement amount (${getSettlementCurrency(detail)})`);
};

export default function AdminPayments() {
    const { t, formatDateTime } = useMarket();
    const [listLoading, setListLoading] = useState(true);
    const [detailLoading, setDetailLoading] = useState(false);
    const [items, setItems] = useState([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [limit] = useState(20);
    const [filters, setFilters] = useState({ status: '', provider: '', method: '' });
    const [selectedIntentId, setSelectedIntentId] = useState('');
    const [selectedDetail, setSelectedDetail] = useState(null);
    const [refundForm, setRefundForm] = useState({ amount: '', reason: '', amountMode: 'settlement' });
    const [actionBusy, setActionBusy] = useState(false);
    const [overviewLoading, setOverviewLoading] = useState(true);
    const [overview, setOverview] = useState(null);

    const totalPages = useMemo(() => Math.max(Math.ceil(total / limit), 1), [total, limit]);

    const loadList = async () => {
        try {
            setListLoading(true);
            const data = await paymentApi.getAdminPayments({
                page,
                limit,
                status: filters.status,
                provider: filters.provider,
                method: filters.method,
            });
            setItems(data.items || []);
            setTotal(Number(data.total) || 0);
            if (!selectedIntentId && data.items?.length) {
                setSelectedIntentId(data.items[0].intentId);
            }
            if (selectedIntentId && !data.items?.some((item) => item.intentId === selectedIntentId)) {
                setSelectedIntentId(data.items?.[0]?.intentId || '');
            }
        } catch (error) {
            toast.error(error.message || t('admin.payments.error.loadList', {}, 'Failed to load payments'));
        } finally {
            setListLoading(false);
        }
    };

    const loadOverview = async () => {
        try {
            setOverviewLoading(true);
            const data = await paymentApi.getAdminPaymentOpsOverview();
            setOverview(data);
        } catch (error) {
            toast.error(error.message || t('admin.payments.error.loadOverview', {}, 'Failed to load payment operations overview'));
        } finally {
            setOverviewLoading(false);
        }
    };

    const loadDetail = async (intentId) => {
        if (!intentId) {
            setSelectedDetail(null);
            return;
        }
        try {
            setDetailLoading(true);
            const detail = await paymentApi.getAdminPaymentById(intentId);
            setSelectedDetail(detail);
        } catch (error) {
            toast.error(error.message || t('admin.payments.error.loadDetail', {}, 'Failed to load payment detail'));
        } finally {
            setDetailLoading(false);
        }
    };

    useEffect(() => {
        loadList();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [page, limit, filters.status, filters.provider, filters.method]);

    useEffect(() => {
        loadOverview();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        loadDetail(selectedIntentId);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedIntentId]);

    useEffect(() => {
        const isInternational = getChargeCurrency(selectedDetail) !== getSettlementCurrency(selectedDetail);
        setRefundForm({
            amount: '',
            reason: '',
            amountMode: isInternational ? 'charge' : 'settlement',
        });
    }, [selectedDetail?.intentId, selectedDetail?.currency, selectedDetail?.settlementCurrency, selectedDetail?.providerBaseCurrency]);

    const onCaptureNow = async () => {
        if (!selectedDetail?.intentId) return;
        try {
            setActionBusy(true);
            await paymentApi.captureAdminPayment(selectedDetail.intentId);
            toast.success(t('admin.payments.success.capture', {}, 'Capture completed'));
            await Promise.all([loadList(), loadOverview(), loadDetail(selectedDetail.intentId)]);
        } catch (error) {
            toast.error(error.message || t('admin.payments.error.capture', {}, 'Capture failed'));
        } finally {
            setActionBusy(false);
        }
    };

    const onRetryCapture = async () => {
        if (!selectedDetail?.intentId) return;
        try {
            setActionBusy(true);
            await paymentApi.retryAdminCapture(selectedDetail.intentId);
            toast.success(t('admin.payments.success.retryQueued', {}, 'Capture retry queued'));
            await Promise.all([loadList(), loadOverview(), loadDetail(selectedDetail.intentId)]);
        } catch (error) {
            toast.error(error.message || t('admin.payments.error.retryCapture', {}, 'Failed to queue capture retry'));
        } finally {
            setActionBusy(false);
        }
    };

    const onRefund = async () => {
        if (!selectedDetail?.intentId) return;
        const amount = refundForm.amount ? Number(refundForm.amount) : undefined;
        if (amount !== undefined && (!Number.isFinite(amount) || amount <= 0)) {
            toast.error(t('admin.payments.error.refundAmount', {}, 'Enter a valid refund amount'));
            return;
        }

        try {
            setActionBusy(true);
            await paymentApi.createRefund(selectedDetail.intentId, {
                amount,
                amountMode: refundForm.amountMode,
                reason: refundForm.reason || undefined,
            });
            setRefundForm((prev) => ({ ...prev, amount: '', reason: '' }));
            toast.success(t('admin.payments.success.refundCreated', {}, 'Refund created'));
            await Promise.all([loadList(), loadOverview(), loadDetail(selectedDetail.intentId)]);
        } catch (error) {
            toast.error(error.message || t('admin.payments.error.refundFailed', {}, 'Refund failed'));
        } finally {
            setActionBusy(false);
        }
    };

    const onExpireStaleIntents = async () => {
        try {
            setActionBusy(true);
            const result = await paymentApi.expireAdminStaleIntents({ limit: 100, dryRun: false });
            if (Number(result.expiredCount || 0) > 0) {
                toast.success(t('admin.payments.success.expiredStale', { count: Number(result.expiredCount || 0) }, `Expired ${Number(result.expiredCount || 0)} stale payment intents`));
            } else {
                toast.info(t('admin.payments.info.noStaleIntents', {}, 'No stale payment intents needed cleanup'));
            }
            await Promise.all([
                loadList(),
                loadOverview(),
                selectedIntentId ? loadDetail(selectedIntentId) : Promise.resolve(),
            ]);
        } catch (error) {
            toast.error(error.message || t('admin.payments.error.expireStale', {}, 'Failed to expire stale payment intents'));
        } finally {
            setActionBusy(false);
        }
    };

    return (
        <AdminPremiumShell
            eyebrow={t('admin.payments.eyebrow', {}, 'Payment ops')}
            title={t('admin.payments.title', {}, 'Payment operations')}
            description={t('admin.payments.description', {}, 'Review intents, capture operations, provider status, and refund execution from a more premium payment command console.')}
            actions={(
                <button type="button" onClick={() => Promise.all([loadList(), loadOverview(), selectedIntentId ? loadDetail(selectedIntentId) : Promise.resolve()])} className="admin-premium-button">
                    <RefreshCw className="h-4 w-4" />
                    {t('admin.shared.refresh', {}, 'Refresh')}
                </button>
            )}
            stats={[
                <AdminHeroStat key="records" label={t('admin.payments.stats.records', {}, 'Records')} value={total} detail={t('admin.shared.pageOf', { page, total: totalPages }, `Page ${page} of ${totalPages}`)} icon={<CreditCard className="h-5 w-5" />} />,
                <AdminHeroStat key="selected" label={t('admin.payments.stats.selectedIntent', {}, 'Selected intent')} value={selectedDetail?.status || t('admin.shared.none', {}, 'none')} detail={selectedDetail?.intentId || t('admin.payments.stats.chooseIntent', {}, 'Choose an intent from the queue')} icon={<ShieldAlert className="h-5 w-5" />} />,
                <AdminHeroStat key="ops" label={t('admin.payments.stats.opsAttention', {}, 'Ops attention')} value={overview?.attentionLevel || (overviewLoading ? t('admin.shared.loadingWord', {}, 'loading') : t('admin.payments.stats.nominal', {}, 'nominal'))} detail={overview?.alerts?.[0]?.message || t('admin.payments.stats.noCriticalAlerts', {}, 'No critical payment alerts')} icon={<Activity className="h-5 w-5" />} />,
            ]}
        >
            <div className="admin-premium-panel mb-4">
                {overviewLoading ? (
                    <div className="flex items-center gap-2 text-sm text-gray-500">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {t('admin.payments.loadingOverview', {}, 'Loading payment operations overview...')}
                    </div>
                ) : overview ? (
                    <div className="space-y-4">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                            <div>
                                <p className="text-xs font-bold uppercase tracking-[0.24em] text-gray-500">{t('admin.payments.overview.kicker', {}, 'Finance control tower')}</p>
                                <h2 className="mt-2 text-lg font-bold text-gray-900">
                                    {t('admin.payments.overview.providerStatus', { provider: overview.provider?.name || t('admin.shared.unknown', {}, 'unknown'), status: overview.provider?.status || t('admin.shared.unknown', {}, 'unknown') }, `Provider ${overview.provider?.name || 'unknown'} is ${overview.provider?.status || 'unknown'}`)}
                                </h2>
                                <p className="mt-1 text-sm text-gray-500">
                                    {t('admin.payments.overview.attentionLevel', {}, 'Attention level')}: <span className="font-semibold text-gray-800">{overview.attentionLevel}</span>
                                    {' '}| {t('admin.payments.overview.captureMode', {}, 'Capture mode')}: {overview.provider?.captureMode || t('admin.shared.notAvailable', {}, 'n/a')}
                                </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <button
                                    type="button"
                                    disabled={actionBusy || Number(overview?.intents?.staleExpiredCandidates || 0) === 0}
                                    onClick={onExpireStaleIntents}
                                    className="admin-premium-button admin-premium-button-accent px-4 py-2 text-xs font-bold uppercase tracking-wider disabled:opacity-50"
                                >
                                    <Clock3 className="h-3.5 w-3.5" />
                                    {t('admin.payments.actions.expireStaleIntents', {}, 'Expire Stale Intents')}
                                </button>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                            <OpsTile label={t('admin.payments.tiles.staleIntents', {}, 'Stale intents')} value={overview.intents?.staleExpiredCandidates || 0} detail={t('admin.payments.tiles.expiringSoon', { count: overview.intents?.expiringSoon || 0 }, `${overview.intents?.expiringSoon || 0} expiring soon`)} />
                            <OpsTile label={t('admin.payments.tiles.authorizedAging', {}, 'Authorized aging')} value={overview.intents?.authorizedNeedingAttention || 0} detail={overview.intents?.oldestAuthorized ? t('admin.payments.tiles.oldestAuth', { minutes: overview.intents.oldestAuthorized.ageMinutes }, `${overview.intents.oldestAuthorized.ageMinutes} min oldest auth`) : t('admin.payments.tiles.noAgingAuthorizations', {}, 'No aging authorizations')} />
                            <OpsTile label={t('admin.payments.tiles.outboxBacklog', {}, 'Outbox backlog')} value={overview.outbox?.pending || 0} detail={t('admin.payments.tiles.outboxDetail', { failed: overview.outbox?.failed || 0, processing: overview.outbox?.processing || 0 }, `${overview.outbox?.failed || 0} failed | ${overview.outbox?.processing || 0} processing`)} />
                            <OpsTile label={t('admin.payments.tiles.webhookFlow', {}, 'Webhook flow')} value={overview.webhooks?.events24h || 0} detail={t('admin.payments.tiles.webhookFailures', { count: overview.webhooks?.confirmFailures24h || 0 }, `${overview.webhooks?.confirmFailures24h || 0} confirm failures in 24h`)} />
                        </div>

                        <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
                            <OpsTile
                                label={t('admin.payments.tiles.internationalIntents', {}, 'International intents')}
                                value={overview.markets?.internationalIntents || 0}
                                detail={overview.markets?.settlementCurrency ? t('admin.payments.tiles.settlementCurrency', { currency: overview.markets.settlementCurrency }, `Settlement currency ${overview.markets.settlementCurrency}`) : t('admin.payments.tiles.settlementCurrencyUnavailable', {}, 'Settlement currency unavailable')}
                            />
                            <OpsTile
                                label={t('admin.payments.tiles.topCountries', {}, 'Top countries')}
                                value={(overview.markets?.topCountries || []).slice(0, 2).map((entry) => entry.countryCode).join(', ') || t('admin.shared.notAvailable', {}, 'n/a')}
                                detail={(overview.markets?.topCountries || []).slice(0, 2).map((entry) => `${entry.countryCode}: ${entry.count}`).join(' | ') || t('admin.payments.tiles.noMarketSpread', {}, 'No market spread yet')}
                            />
                            <OpsTile
                                label={t('admin.payments.tiles.topCurrencies', {}, 'Top currencies')}
                                value={(overview.markets?.topCurrencies || []).slice(0, 2).map((entry) => entry.currency).join(', ') || t('admin.shared.notAvailable', {}, 'n/a')}
                                detail={(overview.markets?.topCurrencies || []).slice(0, 2).map((entry) => `${entry.currency}: ${entry.count}`).join(' | ') || t('admin.payments.tiles.noCurrencySpread', {}, 'No currency spread yet')}
                            />
                        </div>

                        {(overview.alerts || []).length > 0 ? (
                            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                                {overview.alerts.map((alert) => (
                                    <div key={alert.key} className="admin-premium-subpanel rounded-lg p-3">
                                        <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-gray-500">{alert.severity}</p>
                                        <p className="mt-2 text-sm text-gray-900">{alert.message}</p>
                                    </div>
                                ))}
                            </div>
                        ) : null}
                    </div>
                ) : null}
            </div>

            <div className="admin-premium-panel mb-4 grid grid-cols-1 gap-3 md:grid-cols-4">
                <PremiumSelect
                    value={filters.status}
                    onChange={(e) => { setPage(1); setFilters((prev) => ({ ...prev, status: e.target.value })); }}
                    className="admin-premium-control"
                >
                    {STATUS_OPTIONS.map((value) => (
                        <option key={value || 'all'} value={value}>{value ? t('admin.payments.filters.statusOption', { value }, `Status: ${value}`) : t('admin.payments.filters.allStatuses', {}, 'All Statuses')}</option>
                    ))}
                </PremiumSelect>
                <PremiumSelect
                    value={filters.method}
                    onChange={(e) => { setPage(1); setFilters((prev) => ({ ...prev, method: e.target.value })); }}
                    className="admin-premium-control"
                >
                    {METHOD_OPTIONS.map((value) => (
                        <option key={value || 'all'} value={value}>{value ? t('admin.payments.filters.methodOption', { value }, `Method: ${value}`) : t('admin.payments.filters.allMethods', {}, 'All Methods')}</option>
                    ))}
                </PremiumSelect>
                <PremiumSelect
                    value={filters.provider}
                    onChange={(e) => { setPage(1); setFilters((prev) => ({ ...prev, provider: e.target.value })); }}
                    className="admin-premium-control"
                >
                    {PROVIDER_OPTIONS.map((value) => (
                        <option key={value || 'all'} value={value}>{value ? t('admin.payments.filters.providerOption', { value }, `Provider: ${value}`) : t('admin.payments.filters.allProviders', {}, 'All Providers')}</option>
                    ))}
                </PremiumSelect>
                <div className="flex items-center justify-between gap-3 text-sm md:justify-end">
                    <span className="text-gray-500">{t('admin.payments.filters.recordCount', { count: total }, `${total} records`)}</span>
                    <span className="text-gray-500">{t('admin.shared.pageFraction', { page, pages: totalPages }, `Page ${page}/${totalPages}`)}</span>
                </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
                <div className="admin-premium-table-shell xl:col-span-2 overflow-hidden">
                    {listLoading ? (
                        <div className="p-6 text-gray-500 flex items-center gap-2">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            {t('admin.payments.loadingList', {}, 'Loading payment intents...')}
                        </div>
                    ) : items.length === 0 ? (
                        <div className="p-6 text-sm text-gray-500">{t('admin.payments.empty', {}, 'No payment intents found for selected filters.')}</div>
                    ) : (
                        <div className="max-h-[70vh] overflow-y-auto">
                            {items.map((item) => (
                                <button
                                    key={item.intentId}
                                    type="button"
                                    onClick={() => setSelectedIntentId(item.intentId)}
                                    className={`w-full border-b border-white/10 p-4 text-left transition-colors ${selectedIntentId === item.intentId ? 'bg-white/10' : 'hover:bg-white/5'}`}
                                >
                                    <div className="flex items-center justify-between gap-2">
                                        <p className="font-semibold text-sm text-gray-900">{item.intentId}</p>
                                        <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase ${getStatusClass(item.status)}`}>
                                            {item.status}
                                        </span>
                                    </div>
                                    <div className="mt-1 text-xs text-gray-500 flex flex-wrap gap-2">
                                        <span>{item.method}</span>
                                        <span>{item.provider}</span>
                                        <span>{formatPrice(item.amount || 0, getChargeCurrency(item))}</span>
                                        {getChargeCurrency(item) !== getSettlementCurrency(item) ? (
                                            <span className="text-emerald-600">
                                                {t('admin.payments.list.settles', { amount: formatPrice(getSettlementAmount(item), getSettlementCurrency(item)) }, `Settles ${formatPrice(getSettlementAmount(item), getSettlementCurrency(item))}`)}
                                            </span>
                                        ) : null}
                                    </div>
                                    <p className="text-xs text-gray-400 mt-1">{formatDateTime(item.createdAt)}</p>
                                </button>
                            ))}
                        </div>
                    )}

                    <div className="flex items-center justify-between border-t border-white/10 bg-white/5 p-3">
                        <button
                            type="button"
                            disabled={page <= 1}
                            onClick={() => setPage((prev) => Math.max(prev - 1, 1))}
                            className="admin-premium-button px-3 py-1.5 text-xs disabled:opacity-50"
                        >
                            {t('admin.shared.previous', {}, 'Previous')}
                        </button>
                        <button
                            type="button"
                            disabled={page >= totalPages}
                            onClick={() => setPage((prev) => prev + 1)}
                            className="admin-premium-button px-3 py-1.5 text-xs disabled:opacity-50"
                        >
                            {t('admin.shared.next', {}, 'Next')}
                        </button>
                    </div>
                </div>

                <div className="admin-premium-panel xl:col-span-3">
                    {detailLoading ? (
                        <div className="text-gray-500 flex items-center gap-2">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            {t('admin.payments.loadingDetail', {}, 'Loading payment detail...')}
                        </div>
                    ) : !selectedDetail ? (
                        <p className="text-sm text-gray-500">{t('admin.payments.selectIntentPrompt', {}, 'Select a payment intent to view details.')}</p>
                    ) : (
                        <div className="space-y-5">
                            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                                <div>
                                    <h2 className="text-lg font-bold text-gray-900">{selectedDetail.intentId}</h2>
                                    <p className="text-xs text-gray-500 mt-1">
                                        {selectedDetail.provider} | {selectedDetail.method} | {formatPrice(selectedDetail.amount || 0, getChargeCurrency(selectedDetail))}
                                    </p>
                                </div>
                                <span className={`inline-flex px-3 py-1 rounded-full text-xs font-bold uppercase ${getStatusClass(selectedDetail.status)}`}>
                                    {selectedDetail.status}
                                </span>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                                <InfoTile label={t('admin.payments.detail.user', {}, 'User')} value={selectedDetail.user?.email || '-'} />
                                <InfoTile label={t('admin.payments.detail.order', {}, 'Order')} value={selectedDetail.order?._id || '-'} />
                                <InfoTile label={t('admin.payments.detail.charge', {}, 'Charge')} value={formatPrice(selectedDetail.amount || 0, getChargeCurrency(selectedDetail))} />
                                <InfoTile label={t('admin.payments.detail.settlement', {}, 'Settlement')} value={formatPrice(getSettlementAmount(selectedDetail), getSettlementCurrency(selectedDetail))} />
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                <InfoTile label={t('admin.payments.detail.riskDecision', {}, 'Risk Decision')} value={selectedDetail.riskSnapshot?.decision || '-'} />
                                <InfoTile label={t('admin.payments.detail.market', {}, 'Market')} value={getMarketSummary(selectedDetail) || '-'} />
                                <InfoTile label={t('admin.payments.detail.fxMode', {}, 'FX Mode')} value={getChargeCurrency(selectedDetail) !== getSettlementCurrency(selectedDetail) ? t('admin.payments.detail.crossBorderPresentment', {}, 'Cross-border presentment') : t('admin.payments.detail.domesticSettlement', {}, 'Domestic settlement')} />
                            </div>

                            {getChargeCurrency(selectedDetail) !== getSettlementCurrency(selectedDetail) ? (
                                <div className="admin-premium-subpanel">
                                    <h3 className="font-semibold text-sm text-gray-900 mb-3">{t('admin.payments.detail.chargeArchitecture', {}, 'Charge Architecture')}</h3>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                                        <div>
                                            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-gray-500">{t('admin.payments.detail.customerCharge', {}, 'Customer charge')}</p>
                                            <p className="mt-2 text-base font-semibold text-gray-900">
                                                {formatPrice(selectedDetail.amount || 0, getChargeCurrency(selectedDetail))}
                                            </p>
                                        </div>
                                        <div>
                                            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-gray-500">{t('admin.payments.detail.providerSettlement', {}, 'Provider settlement')}</p>
                                            <p className="mt-2 text-base font-semibold text-gray-900">
                                                {formatPrice(getSettlementAmount(selectedDetail), getSettlementCurrency(selectedDetail))}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            ) : null}

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                <InfoTile label={t('admin.payments.detail.providerPaymentId', {}, 'Provider Payment ID')} value={selectedDetail.providerPaymentId || '-'} />
                                <InfoTile label={t('admin.payments.detail.providerOrderId', {}, 'Provider Order ID')} value={selectedDetail.providerOrderId || '-'} />
                                <InfoTile label={t('admin.payments.detail.bankRailContext', {}, 'Bank / Rail Context')} value={selectedDetail.metadata?.paymentContext?.netbanking?.bankCode || selectedDetail.metadata?.providerMethodSnapshot?.bankCode || '-'} />
                            </div>

                            <div className="admin-premium-subpanel">
                                <h3 className="font-semibold text-sm text-gray-900 mb-3">{t('admin.payments.actions.title', {}, 'Admin Actions')}</h3>
                                <div className="flex flex-wrap gap-2 mb-4">
                                    <button
                                        type="button"
                                        disabled={actionBusy || selectedDetail.status !== 'authorized'}
                                        onClick={onCaptureNow}
                                        className="admin-premium-button admin-premium-button-accent px-4 py-2 text-xs font-bold uppercase tracking-wider disabled:opacity-50"
                                    >
                                        <CircleCheck className="w-3.5 h-3.5" />
                                        {t('admin.payments.actions.captureNow', {}, 'Capture Now')}
                                    </button>
                                    <button
                                        type="button"
                                        disabled={actionBusy}
                                        onClick={onRetryCapture}
                                        className="admin-premium-button px-4 py-2 text-xs font-bold uppercase tracking-wider disabled:opacity-50"
                                    >
                                        <ShieldAlert className="w-3.5 h-3.5" />
                                        {t('admin.payments.actions.retryCapture', {}, 'Retry Capture')}
                                    </button>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                                    <input
                                        type="number"
                                        min="1"
                                        value={refundForm.amount}
                                        onChange={(e) => setRefundForm((prev) => ({ ...prev, amount: e.target.value }))}
                                        className="admin-premium-control"
                                        placeholder={`${getRefundInputLabel(t, selectedDetail, refundForm.amountMode)} (${t('admin.shared.optional', {}, 'optional')})`}
                                    />
                                    <PremiumSelect
                                        value={refundForm.amountMode}
                                        onChange={(e) => setRefundForm((prev) => ({ ...prev, amountMode: e.target.value }))}
                                        className="admin-premium-control"
                                    >
                                        {REFUND_MODE_OPTIONS.map((option) => (
                                            <option
                                                key={option.value}
                                                value={option.value}
                                                disabled={option.value === 'charge' && getChargeCurrency(selectedDetail) === getSettlementCurrency(selectedDetail)}
                                            >
                                                {option.value === 'charge'
                                                    ? t('admin.payments.refund.mode.charge', {}, option.label)
                                                    : t('admin.payments.refund.mode.settlement', {}, option.label)}
                                            </option>
                                        ))}
                                    </PremiumSelect>
                                    <input
                                        type="text"
                                        maxLength={140}
                                        value={refundForm.reason}
                                        onChange={(e) => setRefundForm((prev) => ({ ...prev, reason: e.target.value }))}
                                        className="admin-premium-control"
                                        placeholder={t('admin.payments.refund.reason', {}, 'Refund reason')}
                                    />
                                </div>
                                <p className="mt-2 text-xs text-gray-500">
                                    {refundForm.amountMode === 'charge'
                                        ? t('admin.payments.refund.chargeHint', { currency: getChargeCurrency(selectedDetail) }, `This amount is interpreted in ${getChargeCurrency(selectedDetail)} and converted back into settlement totals for refund integrity.`)
                                        : t('admin.payments.refund.settlementHint', { currency: getSettlementCurrency(selectedDetail) }, `This amount is interpreted in ${getSettlementCurrency(selectedDetail)} settlement currency.`)}
                                </p>
                                <button
                                    type="button"
                                    disabled={actionBusy}
                                    onClick={onRefund}
                                    className="admin-premium-button admin-premium-button-danger mt-2 px-4 py-2 text-xs font-bold uppercase tracking-wider disabled:opacity-50"
                                >
                                    <CircleX className="w-3.5 h-3.5" />
                                    {t('admin.payments.actions.createRefund', {}, 'Create Refund')}
                                </button>
                            </div>

                            <div className="admin-premium-subpanel">
                                <h3 className="font-semibold text-sm text-gray-900 mb-3 flex items-center gap-2">
                                    <CreditCard className="w-4 h-4" />
                                    {t('admin.payments.timeline.events', {}, 'Event Timeline')}
                                </h3>
                                <div className="space-y-2 max-h-72 overflow-y-auto">
                                    {(selectedDetail.events || []).length === 0 ? (
                                        <p className="text-xs text-gray-500">{t('admin.payments.timeline.eventsEmpty', {}, 'No events logged yet.')}</p>
                                    ) : selectedDetail.events.map((event) => (
                                        <div key={event.eventId} className="admin-premium-subpanel rounded-lg text-xs">
                                            <div className="flex items-center justify-between gap-2">
                                                <span className="font-semibold text-gray-800">{event.type}</span>
                                                <span className="text-gray-400">{formatDateTime(event.receivedAt)}</span>
                                            </div>
                                            <p className="text-gray-500 mt-1">{event.source}</p>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {Array.isArray(selectedDetail.refundSummary?.refunds) && selectedDetail.refundSummary.refunds.length > 0 ? (
                                <div className="admin-premium-subpanel">
                                    <h3 className="font-semibold text-sm text-gray-900 mb-3">{t('admin.payments.timeline.refunds', {}, 'Refund Timeline')}</h3>
                                    <div className="space-y-2 max-h-72 overflow-y-auto">
                                        {selectedDetail.refundSummary.refunds.map((refund) => (
                                            <div key={refund.refundId || refund.createdAt} className="admin-premium-subpanel rounded-lg text-xs">
                                                <div className="flex items-center justify-between gap-2">
                                                    <span className="font-semibold text-gray-800">{refund.refundId || t('admin.payments.timeline.refundFallback', {}, 'refund')}</span>
                                                    <span className="text-gray-400">{refund.status || t('admin.payments.timeline.processed', {}, 'processed')}</span>
                                                </div>
                                                <p className="mt-1 text-gray-700">
                                                    {formatPrice(refund.amount || refund.presentmentAmount || 0, refund.currency || refund.presentmentCurrency || 'INR')}
                                                </p>
                                                {(refund.presentmentCurrency || refund.settlementCurrency) && (refund.presentmentCurrency !== refund.settlementCurrency) ? (
                                                    <p className="mt-1 text-gray-500">
                                                        {t('admin.payments.detail.settlementValue', { amount: formatPrice(refund.settlementAmount || 0, refund.settlementCurrency || 'INR') }, `Settlement ${formatPrice(refund.settlementAmount || 0, refund.settlementCurrency || 'INR')}`)}
                                                    </p>
                                                ) : null}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ) : null}
                        </div>
                    )}
                </div>
            </div>
        </AdminPremiumShell>
    );
}

function InfoTile({ label, value }) {
    return (
        <div className="admin-premium-subpanel rounded-lg p-3">
            <p className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold">{label}</p>
            <p className="text-sm text-gray-900 mt-1 break-all">{value}</p>
        </div>
    );
}

function OpsTile({ label, value, detail }) {
    return (
        <div className="admin-premium-subpanel rounded-lg p-3">
            <p className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold">{label}</p>
            <p className="mt-2 text-2xl font-bold text-gray-900">{value}</p>
            <p className="mt-1 text-xs text-gray-500">{detail}</p>
        </div>
    );
}
