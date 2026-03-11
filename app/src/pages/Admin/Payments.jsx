import { useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw, CreditCard, ShieldAlert, CircleCheck, CircleX } from 'lucide-react';
import { toast } from 'sonner';
import AdminPremiumShell, { AdminHeroStat } from '@/components/shared/AdminPremiumShell';
import { paymentApi } from '@/services/api';
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
const METHOD_OPTIONS = ['', 'UPI', 'CARD', 'WALLET'];
const PROVIDER_OPTIONS = ['', 'razorpay', 'simulated'];

const getStatusClass = (status) => STATUS_COLORS[status] || 'bg-slate-100 text-slate-700';

export default function AdminPayments() {
    const [listLoading, setListLoading] = useState(true);
    const [detailLoading, setDetailLoading] = useState(false);
    const [items, setItems] = useState([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [limit] = useState(20);
    const [filters, setFilters] = useState({ status: '', provider: '', method: '' });
    const [selectedIntentId, setSelectedIntentId] = useState('');
    const [selectedDetail, setSelectedDetail] = useState(null);
    const [refundForm, setRefundForm] = useState({ amount: '', reason: '' });
    const [actionBusy, setActionBusy] = useState(false);

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
            toast.error(error.message || 'Failed to load payments');
        } finally {
            setListLoading(false);
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
            toast.error(error.message || 'Failed to load payment detail');
        } finally {
            setDetailLoading(false);
        }
    };

    useEffect(() => {
        loadList();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [page, limit, filters.status, filters.provider, filters.method]);

    useEffect(() => {
        loadDetail(selectedIntentId);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedIntentId]);

    const onCaptureNow = async () => {
        if (!selectedDetail?.intentId) return;
        try {
            setActionBusy(true);
            await paymentApi.captureAdminPayment(selectedDetail.intentId);
            toast.success('Capture completed');
            await Promise.all([loadList(), loadDetail(selectedDetail.intentId)]);
        } catch (error) {
            toast.error(error.message || 'Capture failed');
        } finally {
            setActionBusy(false);
        }
    };

    const onRetryCapture = async () => {
        if (!selectedDetail?.intentId) return;
        try {
            setActionBusy(true);
            await paymentApi.retryAdminCapture(selectedDetail.intentId);
            toast.success('Capture retry queued');
            await Promise.all([loadList(), loadDetail(selectedDetail.intentId)]);
        } catch (error) {
            toast.error(error.message || 'Failed to queue capture retry');
        } finally {
            setActionBusy(false);
        }
    };

    const onRefund = async () => {
        if (!selectedDetail?.intentId) return;
        const amount = refundForm.amount ? Number(refundForm.amount) : undefined;
        if (amount !== undefined && (!Number.isFinite(amount) || amount <= 0)) {
            toast.error('Enter a valid refund amount');
            return;
        }

        try {
            setActionBusy(true);
            await paymentApi.createRefund(selectedDetail.intentId, {
                amount,
                reason: refundForm.reason || undefined,
            });
            setRefundForm({ amount: '', reason: '' });
            toast.success('Refund created');
            await Promise.all([loadList(), loadDetail(selectedDetail.intentId)]);
        } catch (error) {
            toast.error(error.message || 'Refund failed');
        } finally {
            setActionBusy(false);
        }
    };

    return (
        <AdminPremiumShell
            eyebrow="Payment ops"
            title="Payment operations"
            description="Review intents, capture operations, provider status, and refund execution from a more premium payment command console."
            actions={(
                <button type="button" onClick={loadList} className="admin-premium-button">
                    <RefreshCw className="h-4 w-4" />
                    Refresh
                </button>
            )}
            stats={[
                <AdminHeroStat key="records" label="Records" value={total} detail={`Page ${page} of ${totalPages}`} icon={<CreditCard className="h-5 w-5" />} />,
                <AdminHeroStat key="selected" label="Selected intent" value={selectedDetail?.status || 'none'} detail={selectedDetail?.intentId || 'Choose an intent from the queue'} icon={<ShieldAlert className="h-5 w-5" />} />,
            ]}
        >
            <div className="admin-premium-panel mb-4 grid grid-cols-1 gap-3 md:grid-cols-4">
                <select
                    value={filters.status}
                    onChange={(e) => { setPage(1); setFilters((prev) => ({ ...prev, status: e.target.value })); }}
                    className="admin-premium-control"
                >
                    {STATUS_OPTIONS.map((value) => (
                        <option key={value || 'all'} value={value}>{value ? `Status: ${value}` : 'All Statuses'}</option>
                    ))}
                </select>
                <select
                    value={filters.method}
                    onChange={(e) => { setPage(1); setFilters((prev) => ({ ...prev, method: e.target.value })); }}
                    className="admin-premium-control"
                >
                    {METHOD_OPTIONS.map((value) => (
                        <option key={value || 'all'} value={value}>{value ? `Method: ${value}` : 'All Methods'}</option>
                    ))}
                </select>
                <select
                    value={filters.provider}
                    onChange={(e) => { setPage(1); setFilters((prev) => ({ ...prev, provider: e.target.value })); }}
                    className="admin-premium-control"
                >
                    {PROVIDER_OPTIONS.map((value) => (
                        <option key={value || 'all'} value={value}>{value ? `Provider: ${value}` : 'All Providers'}</option>
                    ))}
                </select>
                <div className="flex items-center justify-between gap-3 text-sm md:justify-end">
                    <span className="text-gray-500">{total} records</span>
                    <span className="text-gray-500">Page {page}/{totalPages}</span>
                </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
                <div className="admin-premium-table-shell xl:col-span-2 overflow-hidden">
                    {listLoading ? (
                        <div className="p-6 text-gray-500 flex items-center gap-2">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Loading payment intents...
                        </div>
                    ) : items.length === 0 ? (
                        <div className="p-6 text-sm text-gray-500">No payment intents found for selected filters.</div>
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
                                        <span>{formatPrice(item.amount || 0)}</span>
                                    </div>
                                    <p className="text-xs text-gray-400 mt-1">{new Date(item.createdAt).toLocaleString()}</p>
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
                            Previous
                        </button>
                        <button
                            type="button"
                            disabled={page >= totalPages}
                            onClick={() => setPage((prev) => prev + 1)}
                            className="admin-premium-button px-3 py-1.5 text-xs disabled:opacity-50"
                        >
                            Next
                        </button>
                    </div>
                </div>

                <div className="admin-premium-panel xl:col-span-3">
                    {detailLoading ? (
                        <div className="text-gray-500 flex items-center gap-2">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Loading payment detail...
                        </div>
                    ) : !selectedDetail ? (
                        <p className="text-sm text-gray-500">Select a payment intent to view details.</p>
                    ) : (
                        <div className="space-y-5">
                            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                                <div>
                                    <h2 className="text-lg font-bold text-gray-900">{selectedDetail.intentId}</h2>
                                    <p className="text-xs text-gray-500 mt-1">
                                        {selectedDetail.provider} | {selectedDetail.method} | {formatPrice(selectedDetail.amount || 0)}
                                    </p>
                                </div>
                                <span className={`inline-flex px-3 py-1 rounded-full text-xs font-bold uppercase ${getStatusClass(selectedDetail.status)}`}>
                                    {selectedDetail.status}
                                </span>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                <InfoTile label="User" value={selectedDetail.user?.email || '-'} />
                                <InfoTile label="Order" value={selectedDetail.order?._id || '-'} />
                                <InfoTile label="Risk Decision" value={selectedDetail.riskSnapshot?.decision || '-'} />
                            </div>

                            <div className="admin-premium-subpanel">
                                <h3 className="font-semibold text-sm text-gray-900 mb-3">Admin Actions</h3>
                                <div className="flex flex-wrap gap-2 mb-4">
                                    <button
                                        type="button"
                                        disabled={actionBusy || selectedDetail.status !== 'authorized'}
                                        onClick={onCaptureNow}
                                        className="admin-premium-button admin-premium-button-accent px-4 py-2 text-xs font-bold uppercase tracking-wider disabled:opacity-50"
                                    >
                                        <CircleCheck className="w-3.5 h-3.5" />
                                        Capture Now
                                    </button>
                                    <button
                                        type="button"
                                        disabled={actionBusy}
                                        onClick={onRetryCapture}
                                        className="admin-premium-button px-4 py-2 text-xs font-bold uppercase tracking-wider disabled:opacity-50"
                                    >
                                        <ShieldAlert className="w-3.5 h-3.5" />
                                        Retry Capture
                                    </button>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                                    <input
                                        type="number"
                                        min="1"
                                        value={refundForm.amount}
                                        onChange={(e) => setRefundForm((prev) => ({ ...prev, amount: e.target.value }))}
                                        className="admin-premium-control"
                                        placeholder="Refund amount (optional)"
                                    />
                                    <input
                                        type="text"
                                        maxLength={140}
                                        value={refundForm.reason}
                                        onChange={(e) => setRefundForm((prev) => ({ ...prev, reason: e.target.value }))}
                                        className="admin-premium-control md:col-span-2"
                                        placeholder="Refund reason"
                                    />
                                </div>
                                <button
                                    type="button"
                                    disabled={actionBusy}
                                    onClick={onRefund}
                                    className="admin-premium-button admin-premium-button-danger mt-2 px-4 py-2 text-xs font-bold uppercase tracking-wider disabled:opacity-50"
                                >
                                    <CircleX className="w-3.5 h-3.5" />
                                    Create Refund
                                </button>
                            </div>

                            <div className="admin-premium-subpanel">
                                <h3 className="font-semibold text-sm text-gray-900 mb-3 flex items-center gap-2">
                                    <CreditCard className="w-4 h-4" />
                                    Event Timeline
                                </h3>
                                <div className="space-y-2 max-h-72 overflow-y-auto">
                                    {(selectedDetail.events || []).length === 0 ? (
                                        <p className="text-xs text-gray-500">No events logged yet.</p>
                                    ) : selectedDetail.events.map((event) => (
                                        <div key={event.eventId} className="admin-premium-subpanel rounded-lg text-xs">
                                            <div className="flex items-center justify-between gap-2">
                                                <span className="font-semibold text-gray-800">{event.type}</span>
                                                <span className="text-gray-400">{new Date(event.receivedAt).toLocaleString()}</span>
                                            </div>
                                            <p className="text-gray-500 mt-1">{event.source}</p>
                                        </div>
                                    ))}
                                </div>
                            </div>
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
