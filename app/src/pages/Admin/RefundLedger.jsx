import { useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw, Save, ShieldCheck, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import AdminPremiumShell, { AdminHeroStat } from '@/components/shared/AdminPremiumShell';
import PremiumSelect from '@/components/ui/premium-select';
import { useMarket } from '@/context/MarketContext';
import { adminApi } from '@/services/api/adminApi';
import { formatPrice } from '@/utils/format';

const STATUS_OPTIONS = ['', 'pending', 'approved', 'processed', 'rejected'];
const SETTLEMENT_OPTIONS = ['', 'provider', 'manual', 'queued', 'manual_review', 'none'];
const RECON_OPTIONS = ['', 'pending', 'provider_verified', 'provider_unverified', 'manual_recorded', 'manual_reference_missing', 'n/a'];

const STATUS_BADGE = {
    pending: 'bg-amber-100 text-amber-700 border-amber-200',
    approved: 'bg-cyan-100 text-cyan-700 border-cyan-200',
    processed: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    rejected: 'bg-rose-100 text-rose-700 border-rose-200',
};

const SETTLEMENT_BADGE = {
    provider: 'bg-indigo-100 text-indigo-700 border-indigo-200',
    manual: 'bg-violet-100 text-violet-700 border-violet-200',
    queued: 'bg-orange-100 text-orange-700 border-orange-200',
    manual_review: 'bg-sky-100 text-sky-700 border-sky-200',
    none: 'bg-slate-100 text-slate-600 border-slate-200',
};

const RECON_BADGE = {
    provider_verified: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    provider_unverified: 'bg-amber-100 text-amber-700 border-amber-200',
    manual_recorded: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    manual_reference_missing: 'bg-rose-100 text-rose-700 border-rose-200',
    pending: 'bg-cyan-100 text-cyan-700 border-cyan-200',
    'n/a': 'bg-slate-100 text-slate-600 border-slate-200',
};

const badgeClass = (map, value) => map[value] || 'bg-slate-100 text-slate-700 border-slate-200';

const toDateTime = (value) => {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString();
};

export default function AdminRefundLedger() {
    const { t, formatDateTime } = useMarket();
    const [loading, setLoading] = useState(true);
    const [busyLedgerId, setBusyLedgerId] = useState('');
    const [page, setPage] = useState(1);
    const [limit] = useState(25);
    const [total, setTotal] = useState(0);
    const [items, setItems] = useState([]);
    const [filters, setFilters] = useState({
        status: '',
        settlement: '',
        reconciliation: '',
        method: '',
        provider: '',
        query: '',
    });
    const [referenceDrafts, setReferenceDrafts] = useState({});
    const [noteDrafts, setNoteDrafts] = useState({});

    const pages = useMemo(() => Math.max(Math.ceil(total / limit), 1), [total, limit]);

    const loadLedger = async () => {
        try {
            setLoading(true);
            const response = await adminApi.getRefundLedger({
                page,
                limit,
                status: filters.status || undefined,
                settlement: filters.settlement || undefined,
                reconciliation: filters.reconciliation || undefined,
                method: filters.method || undefined,
                provider: filters.provider || undefined,
                query: filters.query.trim() || undefined,
            });
            const rows = Array.isArray(response?.items) ? response.items : [];
            setItems(rows);
            setTotal(Number(response?.total || 0));
            const refs = {};
            const notes = {};
            rows.forEach((row) => {
                refs[row.ledgerId] = row?.refund?.refundId || '';
                notes[row.ledgerId] = row?.refund?.adminNote || '';
            });
            setReferenceDrafts(refs);
            setNoteDrafts(notes);
        } catch (error) {
            toast.error(error.message || t('admin.refunds.error.load', {}, 'Failed to load refund ledger'));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadLedger();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [page, limit, filters.status, filters.settlement, filters.reconciliation, filters.method, filters.provider, filters.query]);

    const updateDraft = (ledgerId, field, value) => {
        if (field === 'refundId') {
            setReferenceDrafts((prev) => ({ ...prev, [ledgerId]: value }));
            return;
        }
        setNoteDrafts((prev) => ({ ...prev, [ledgerId]: value }));
    };

    const onRecordReference = async (row) => {
        const refundId = String(referenceDrafts[row.ledgerId] || '').trim();
        const note = String(noteDrafts[row.ledgerId] || '').trim();
        if (!refundId) {
            toast.error(t('admin.refunds.error.referenceRequired', {}, 'Refund reference is required'));
            return;
        }

        try {
            setBusyLedgerId(row.ledgerId);
            const response = await adminApi.updateRefundLedgerReference(row.orderId, row.requestId, {
                refundId,
                note: note || undefined,
            });
            toast.success(response?.message || t('admin.refunds.success.referenceUpdated', {}, 'Refund reference updated'));
            await loadLedger();
        } catch (error) {
            toast.error(error.message || t('admin.refunds.error.referenceUpdate', {}, 'Failed to update refund reference'));
        } finally {
            setBusyLedgerId('');
        }
    };

    return (
        <AdminPremiumShell
            eyebrow={t('admin.refunds.eyebrow', {}, 'Refund ops')}
            title={t('admin.refunds.title', {}, 'Refund ledger')}
            description={t('admin.refunds.description', {}, 'Track provider references, manual bank records, queue retries, and reconciliation decisions from one premium refund surface.')}
            actions={(
                <button type="button" onClick={loadLedger} className="admin-premium-button">
                    <RefreshCw className="h-4 w-4" />
                    {t('admin.shared.refresh', {}, 'Refresh')}
                </button>
            )}
            stats={[
                <AdminHeroStat key="records" label={t('admin.refunds.stats.ledgerRows', {}, 'Ledger rows')} value={total} detail={t('admin.shared.pageOf', { page, total: pages }, `Page ${page} of ${pages}`)} icon={<ShieldCheck className="h-5 w-5" />} />,
                <AdminHeroStat key="pending" label={t('admin.refunds.stats.pendingFilter', {}, 'Pending filter')} value={filters.status || t('admin.shared.all', {}, 'all')} detail={filters.query || t('admin.refunds.stats.noQuery', {}, 'No active search query')} icon={<ShieldAlert className="h-5 w-5" />} />,
            ]}
        >
            <div className="admin-premium-panel mb-4 grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-6">
                <PremiumSelect
                    value={filters.status}
                    onChange={(e) => { setPage(1); setFilters((prev) => ({ ...prev, status: e.target.value })); }}
                    className="admin-premium-control"
                >
                    {STATUS_OPTIONS.map((value) => (
                        <option key={value || 'all-status'} value={value}>
                            {value ? t('admin.refunds.filters.statusOption', { value }, `Status: ${value}`) : t('admin.refunds.filters.allStatuses', {}, 'All statuses')}
                        </option>
                    ))}
                </PremiumSelect>
                <PremiumSelect
                    value={filters.settlement}
                    onChange={(e) => { setPage(1); setFilters((prev) => ({ ...prev, settlement: e.target.value })); }}
                    className="admin-premium-control"
                >
                    {SETTLEMENT_OPTIONS.map((value) => (
                        <option key={value || 'all-settlement'} value={value}>
                            {value ? t('admin.refunds.filters.settlementOption', { value }, `Settlement: ${value}`) : t('admin.refunds.filters.allSettlements', {}, 'All settlements')}
                        </option>
                    ))}
                </PremiumSelect>
                <PremiumSelect
                    value={filters.reconciliation}
                    onChange={(e) => { setPage(1); setFilters((prev) => ({ ...prev, reconciliation: e.target.value })); }}
                    className="admin-premium-control"
                >
                    {RECON_OPTIONS.map((value) => (
                        <option key={value || 'all-recon'} value={value}>
                            {value ? t('admin.refunds.filters.reconOption', { value }, `Recon: ${value}`) : t('admin.refunds.filters.allReconciliation', {}, 'All reconciliation')}
                        </option>
                    ))}
                </PremiumSelect>
                <input
                    type="text"
                    value={filters.method}
                    onChange={(e) => { setPage(1); setFilters((prev) => ({ ...prev, method: e.target.value.toUpperCase() })); }}
                    className="admin-premium-control"
                    placeholder={t('admin.refunds.filters.methodPlaceholder', {}, 'Method (UPI/CARD/WALLET/NETBANKING/COD)')}
                />
                <input
                    type="text"
                    value={filters.provider}
                    onChange={(e) => { setPage(1); setFilters((prev) => ({ ...prev, provider: e.target.value })); }}
                    className="admin-premium-control"
                    placeholder={t('admin.refunds.filters.provider', {}, 'Provider')}
                />
                <input
                    type="text"
                    value={filters.query}
                    onChange={(e) => { setPage(1); setFilters((prev) => ({ ...prev, query: e.target.value })); }}
                    className="admin-premium-control"
                    placeholder={t('admin.refunds.filters.searchPlaceholder', {}, 'Search order/email/request/ref id')}
                />
            </div>

            <div className="admin-premium-table-shell">
                {loading ? (
                    <div className="flex items-center gap-2 p-6 text-sm text-gray-500">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {t('admin.refunds.loading', {}, 'Loading refund ledger...')}
                    </div>
                ) : items.length === 0 ? (
                    <div className="p-6 text-sm text-gray-500">{t('admin.refunds.empty', {}, 'No ledger entries match your filters.')}</div>
                ) : (
                    <div className="admin-premium-scroll overflow-x-auto">
                        <table className="admin-premium-table min-w-[1650px]">
                            <thead>
                                <tr>
                                    <th>{t('admin.refunds.table.order', {}, 'Order')}</th>
                                    <th>{t('admin.refunds.table.customer', {}, 'Customer')}</th>
                                    <th>{t('admin.refunds.table.payment', {}, 'Payment')}</th>
                                    <th>{t('admin.refunds.table.refund', {}, 'Refund')}</th>
                                    <th>{t('admin.refunds.table.state', {}, 'State')}</th>
                                    <th>{t('admin.refunds.table.references', {}, 'References')}</th>
                                    <th>{t('admin.refunds.table.timeline', {}, 'Timeline')}</th>
                                    <th>{t('admin.refunds.table.reconciliation', {}, 'Reconciliation')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {items.map((row) => {
                                    const canRecordReference = ['approved', 'processed'].includes(String(row?.refund?.status || '').toLowerCase());
                                    const isBusy = busyLedgerId === row.ledgerId;
                                    return (
                                        <tr key={row.ledgerId} className="align-top">
                                            <td className="px-3 py-3 text-xs text-gray-700">
                                                <div className="font-mono text-[11px] text-gray-900">{row.orderId}</div>
                                                <div className="mt-1 font-mono text-[11px] text-gray-500">Req: {row.requestId}</div>
                                                <div className="mt-1 text-[11px]">Order status: <span className="font-semibold">{row.order?.status || '-'}</span></div>
                                                <div className="text-[11px]">Order total: <span className="font-semibold">{formatPrice(row.order?.totalPrice || 0)}</span></div>
                                            </td>
                                            <td className="px-3 py-3 text-xs text-gray-700">
                                                <div className="font-semibold text-gray-900">{row.user?.name || t('admin.refunds.unknownUser', {}, 'Unknown')}</div>
                                                <div className="mt-1">{row.user?.email || '-'}</div>
                                                <div className="mt-1">{row.user?.phone || '-'}</div>
                                            </td>
                                            <td className="px-3 py-3 text-xs text-gray-700">
                                                <div>{row.payment?.method || '-'}</div>
                                                <div className="mt-1">{row.payment?.provider || '-'}</div>
                                                <div className="mt-1 font-mono text-[11px]">{row.payment?.intentId || '-'}</div>
                                                <div className="mt-1 text-[11px]">{t('admin.refunds.paymentState', {}, 'State')}: <span className="font-semibold">{row.payment?.state || '-'}</span></div>
                                            </td>
                                            <td className="px-3 py-3 text-xs text-gray-700">
                                                <div className="font-semibold text-gray-900">{formatPrice(row.refund?.amount || 0)}</div>
                                                <div className="mt-1">{row.refund?.reason || '-'}</div>
                                                <div className="mt-1 text-[11px] text-gray-500">{row.refund?.message || '-'}</div>
                                            </td>
                                            <td className="px-3 py-3 text-xs text-gray-700">
                                                <span className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${badgeClass(STATUS_BADGE, row.refund?.status)}`}>
                                                    {row.refund?.status || 'pending'}
                                                </span>
                                                <div className="mt-2">
                                                    <span className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${badgeClass(SETTLEMENT_BADGE, row.settlement)}`}>
                                                        {row.settlement}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="px-3 py-3 text-xs text-gray-700">
                                                <input
                                                    type="text"
                                                    className="admin-premium-control w-full px-2 py-1 text-[11px]"
                                                    value={referenceDrafts[row.ledgerId] || ''}
                                                    onChange={(e) => updateDraft(row.ledgerId, 'refundId', e.target.value)}
                                                    placeholder={t('admin.refunds.referencePlaceholder', {}, 'Provider/manual ref id')}
                                                    disabled={!canRecordReference || isBusy}
                                                />
                                                <input
                                                    type="text"
                                                    className="admin-premium-control mt-1 w-full px-2 py-1 text-[11px]"
                                                    value={noteDrafts[row.ledgerId] || ''}
                                                    onChange={(e) => updateDraft(row.ledgerId, 'note', e.target.value)}
                                                    placeholder={t('admin.refunds.notePlaceholder', {}, 'Reconciliation note')}
                                                    disabled={!canRecordReference || isBusy}
                                                />
                                                <button
                                                    type="button"
                                                    disabled={!canRecordReference || isBusy}
                                                    onClick={() => onRecordReference(row)}
                                                    className="admin-premium-button mt-1 inline-flex items-center gap-1 px-2 py-1 text-[10px] font-bold disabled:opacity-50"
                                                >
                                                    {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                                                    {t('admin.refunds.actions.record', {}, 'Record')}
                                                </button>
                                            </td>
                                            <td className="px-3 py-3 text-xs text-gray-700">
                                                <div>{t('admin.refunds.timeline.created', {}, 'Created')}: {formatDateTime(row.refund?.createdAt)}</div>
                                                <div className="mt-1">{t('admin.refunds.timeline.updated', {}, 'Updated')}: {formatDateTime(row.refund?.updatedAt)}</div>
                                                <div className="mt-1">{t('admin.refunds.timeline.processed', {}, 'Processed')}: {formatDateTime(row.refund?.processedAt)}</div>
                                                {row.queue ? (
                                                    <div className="mt-2 rounded border border-amber-200 bg-amber-50 p-1 text-[10px] text-amber-700">
                                                        {t('admin.refunds.timeline.retry', { count: row.queue.retryCount, time: formatDateTime(row.queue.nextRunAt) }, `Retry #${row.queue.retryCount} | Next: ${formatDateTime(row.queue.nextRunAt)}`)}
                                                    </div>
                                                ) : null}
                                            </td>
                                            <td className="px-3 py-3 text-xs text-gray-700">
                                                <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${badgeClass(RECON_BADGE, row.reconciliation)}`}>
                                                    {row.reconciliation.startsWith('provider_')
                                                        ? <ShieldCheck className="h-3 w-3" />
                                                        : row.reconciliation === 'manual_reference_missing'
                                                            ? <ShieldAlert className="h-3 w-3" />
                                                            : null}
                                                    {row.reconciliation}
                                                </span>
                                                <div className="mt-2 text-[11px]">
                                                    {t('admin.refunds.providerVerification', {}, 'Provider verification')}: <span className="font-semibold">{row.providerVerification}</span>
                                                </div>
                                                <div className="mt-1 font-mono text-[11px] break-all">
                                                    {t('admin.refunds.reference', {}, 'Ref')}: {row.refund?.refundId || '-'}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}

            <div className="flex items-center justify-between border-t border-white/10 bg-white/5 px-4 py-3 text-sm text-gray-600">
                    <span>{t('admin.refunds.footer.recordPage', { total, page, pages }, `${total} records | page ${page}/${pages}`)}</span>
                    <div className="flex items-center gap-2">
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
                            disabled={page >= pages}
                            onClick={() => setPage((prev) => prev + 1)}
                            className="admin-premium-button px-3 py-1.5 text-xs disabled:opacity-50"
                        >
                            {t('admin.shared.next', {}, 'Next')}
                        </button>
                    </div>
                </div>
            </div>
        </AdminPremiumShell>
    );
}
