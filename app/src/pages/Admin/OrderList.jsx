import { useState, useEffect, useContext } from 'react';
import { orderApi } from '@/services/api';
import { AuthContext } from '@/context/AuthContext';
import { formatPrice } from '@/utils/format';
import { XCircle, CheckCircle, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

const STATUS_OPTIONS = ['processing', 'shipped', 'delivered'];

const OrderList = () => {
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [statusDrafts, setStatusDrafts] = useState({});
    const [cancelReasonDrafts, setCancelReasonDrafts] = useState({});
    const [statusSubmitting, setStatusSubmitting] = useState({});
    const [cancelSubmitting, setCancelSubmitting] = useState({});
    const [refundSubmitting, setRefundSubmitting] = useState({});
    const [replacementSubmitting, setReplacementSubmitting] = useState({});
    const [warrantySubmitting, setWarrantySubmitting] = useState({});
    const [supportSubmitting, setSupportSubmitting] = useState({});
    const [supportReplyDrafts, setSupportReplyDrafts] = useState({});
    const [trackingDrafts, setTrackingDrafts] = useState({});
    const { currentUser } = useContext(AuthContext);

    const loadOrders = async () => {
        setLoading(true);
        try {
            const data = await orderApi.getAllOrders();
            setOrders(data);
            const drafts = {};
            data.forEach((order) => {
                drafts[order._id] = order.orderStatus || (order.isDelivered ? 'delivered' : 'placed');
            });
            setStatusDrafts(drafts);
            const cancelDrafts = {};
            const supportDrafts = {};
            const trkDrafts = {};
            data.forEach((order) => {
                cancelDrafts[order._id] = '';
                supportDrafts[order._id] = '';
                trkDrafts[order._id] = '';
            });
            setCancelReasonDrafts(cancelDrafts);
            setSupportReplyDrafts(supportDrafts);
            setTrackingDrafts(trkDrafts);
        } catch (error) {
            toast.error(error.message || 'Failed to fetch orders');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (currentUser) loadOrders();
    }, [currentUser]);

    const setDraftStatus = (orderId, value) => {
        setStatusDrafts((prev) => ({ ...prev, [orderId]: value }));
    };

    const setDraftCancelReason = (orderId, value) => {
        setCancelReasonDrafts((prev) => ({ ...prev, [orderId]: value }));
    };

    const setSupportDraft = (orderId, value) => {
        setSupportReplyDrafts((prev) => ({ ...prev, [orderId]: value }));
    };

    const setTrackingDraft = (orderId, value) => {
        setTrackingDrafts((prev) => ({ ...prev, [orderId]: value }));
    };

    const updateStatus = async (orderId) => {
        const status = statusDrafts[orderId];
        if (!STATUS_OPTIONS.includes(status)) {
            toast.error('Select a valid status');
            return;
        }

        setStatusSubmitting((prev) => ({ ...prev, [orderId]: true }));
        try {
            const response = await orderApi.updateOrderStatusAdmin(orderId, {
                status,
                note: 'Updated from admin order console',
            });
            const updated = response?.order;
            if (updated) {
                setOrders((prev) => prev.map((item) => (item._id === orderId ? updated : item)));
                setStatusDrafts((prev) => ({
                    ...prev,
                    [orderId]: updated.orderStatus || (updated.isDelivered ? 'delivered' : 'placed'),
                }));
            }
            toast.success(response?.message || 'Order status updated');
        } catch (error) {
            toast.error(error.message || 'Failed to update status');
        } finally {
            setStatusSubmitting((prev) => ({ ...prev, [orderId]: false }));
        }
    };

    const cancelOrderAsAdmin = async (orderId) => {
        const reason = (cancelReasonDrafts[orderId] || '').trim() || 'Cancelled by admin';
        setCancelSubmitting((prev) => ({ ...prev, [orderId]: true }));
        try {
            const response = await orderApi.cancelOrderAdmin(orderId, { reason });
            const updated = response?.order;
            if (updated) {
                setOrders((prev) => prev.map((item) => (item._id === orderId ? updated : item)));
                setStatusDrafts((prev) => ({
                    ...prev,
                    [orderId]: updated.orderStatus || (updated.isDelivered ? 'delivered' : 'placed'),
                }));
            }
            setCancelReasonDrafts((prev) => ({ ...prev, [orderId]: '' }));
            toast.success(response?.message || 'Order cancelled');
        } catch (error) {
            toast.error(error.message || 'Failed to cancel order');
        } finally {
            setCancelSubmitting((prev) => ({ ...prev, [orderId]: false }));
        }
    };

    const processRefundRequest = async (orderId, requestId, status) => {
        setRefundSubmitting((prev) => ({ ...prev, [orderId]: true }));
        try {
            const response = await orderApi.processRefundRequestAdmin(orderId, requestId, {
                status,
                note: `Admin ${status} via order console`,
            });
            toast.success(response?.message || 'Refund request updated');
            await loadOrders();
        } catch (error) {
            toast.error(error.message || 'Failed to process refund request');
        } finally {
            setRefundSubmitting((prev) => ({ ...prev, [orderId]: false }));
        }
    };

    const processReplacementRequest = async (orderId, requestId, status) => {
        setReplacementSubmitting((prev) => ({ ...prev, [orderId]: true }));
        try {
            const response = await orderApi.processReplacementRequestAdmin(orderId, requestId, {
                status,
                trackingId: trackingDrafts[orderId] || undefined,
                note: `Admin ${status} via order console`,
            });
            toast.success(response?.message || 'Replacement request updated');
            await loadOrders();
        } catch (error) {
            toast.error(error.message || 'Failed to process replacement request');
        } finally {
            setReplacementSubmitting((prev) => ({ ...prev, [orderId]: false }));
        }
    };

    const processWarrantyClaim = async (orderId, claimId, status) => {
        setWarrantySubmitting((prev) => ({ ...prev, [orderId]: true }));
        try {
            const response = await orderApi.processWarrantyClaimAdmin(orderId, claimId, {
                status,
                note: `Admin ${status} via order console`,
            });
            toast.success(response?.message || 'Warranty claim updated');
            await loadOrders();
        } catch (error) {
            toast.error(error.message || 'Failed to process warranty claim');
        } finally {
            setWarrantySubmitting((prev) => ({ ...prev, [orderId]: false }));
        }
    };

    const sendSupportReply = async (orderId) => {
        const message = (supportReplyDrafts[orderId] || '').trim();
        if (!message) {
            toast.error('Write a support reply message first');
            return;
        }

        setSupportSubmitting((prev) => ({ ...prev, [orderId]: true }));
        try {
            const response = await orderApi.replySupportAdmin(orderId, { message });
            toast.success(response?.message || 'Support reply sent');
            setSupportReplyDrafts((prev) => ({ ...prev, [orderId]: '' }));
            await loadOrders();
        } catch (error) {
            toast.error(error.message || 'Failed to send support reply');
        } finally {
            setSupportSubmitting((prev) => ({ ...prev, [orderId]: false }));
        }
    };

    if (loading) {
        return (
            <div className="p-8 flex items-center gap-2 text-slate-500">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading orders...
            </div>
        );
    }

    return (
        <div className="container mx-auto px-4 py-8">
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-2xl font-bold">All Orders</h1>
                <button
                    type="button"
                    onClick={loadOrders}
                    className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                >
                    <RefreshCw className="w-4 h-4" />
                    Refresh
                </button>
            </div>

            <div className="bg-white rounded-lg shadow overflow-hidden">
                <div className="table-responsive">
                    <table className="min-w-[1100px] w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">ID</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Order</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Payment</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Refund Ops</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Replacement Ops</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Shipping / Support Ops</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {orders.map((order) => {
                                const refunds = order.commandCenter?.refunds || [];
                                const replacements = order.commandCenter?.replacements || [];
                                const warrantyClaims = order.commandCenter?.warrantyClaims || [];
                                const latestRefund = refunds.length ? refunds[refunds.length - 1] : null;
                                const latestReplacement = replacements.length ? replacements[replacements.length - 1] : null;
                                const latestWarranty = warrantyClaims.length ? warrantyClaims[warrantyClaims.length - 1] : null;
                                const currentStatus = order.orderStatus || (order.isDelivered ? 'delivered' : 'placed');
                                const isBusy = Boolean(statusSubmitting[order._id]);
                                const isCancelBusy = Boolean(cancelSubmitting[order._id]);
                                const isRefundBusy = Boolean(refundSubmitting[order._id]);
                                const isReplacementBusy = Boolean(replacementSubmitting[order._id]);
                                const isWarrantyBusy = Boolean(warrantySubmitting[order._id]);
                                const isSupportBusy = Boolean(supportSubmitting[order._id]);

                                return (
                                    <tr key={order._id} className="hover:bg-gray-50">
                                        <td className="px-4 py-4 whitespace-nowrap text-sm font-mono text-gray-500">
                                            {order._id.slice(-8)}
                                        </td>
                                        <td className="px-4 py-4 text-sm text-gray-900">
                                            {order.user ? order.user.name : 'Unknown User'}
                                            <div className="text-xs text-gray-400">{order.user?.email}</div>
                                        </td>
                                        <td className="px-4 py-4 text-sm text-gray-900">
                                            <div className="font-semibold">{formatPrice(order.totalPrice)}</div>
                                            <div className="text-xs text-gray-500">
                                                {new Date(order.createdAt).toLocaleString()}
                                            </div>
                                            <div className="text-xs text-gray-500">
                                                {order.orderItems?.length || 0} item(s)
                                            </div>
                                        </td>
                                        <td className="px-4 py-4 text-sm">
                                            {order.isPaid ? (
                                                <span className="text-green-600 inline-flex items-center gap-1 font-semibold">
                                                    <CheckCircle className="w-3 h-3" /> Paid
                                                </span>
                                            ) : (
                                                <span className="text-red-500 inline-flex items-center gap-1 font-semibold">
                                                    <XCircle className="w-3 h-3" /> Pending
                                                </span>
                                            )}
                                            <div className="text-xs text-gray-500 mt-1">State: {order.paymentState || 'pending'}</div>
                                        </td>
                                        <td className="px-4 py-4 text-xs text-gray-700 max-w-[220px]">
                                            {latestRefund ? (
                                                <div className="space-y-1">
                                                    <div className={cn(
                                                        'inline-flex px-2 py-0.5 rounded-full border font-bold uppercase tracking-wider text-[10px]',
                                                        latestRefund.status === 'processed'
                                                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                                            : latestRefund.status === 'rejected'
                                                                ? 'bg-rose-50 text-rose-700 border-rose-200'
                                                                : 'bg-amber-50 text-amber-700 border-amber-200'
                                                    )}>
                                                        {latestRefund.status}
                                                    </div>
                                                    <div>{latestRefund.message || latestRefund.reason || '-'}</div>
                                                    {latestRefund.refundId && <div className="font-mono text-[10px]">ID: {latestRefund.refundId}</div>}
                                                    {['pending', 'approved'].includes(String(latestRefund.status || '').toLowerCase()) ? (
                                                        <div className="flex gap-1 pt-1">
                                                            <button
                                                                type="button"
                                                                onClick={() => processRefundRequest(order._id, latestRefund.requestId, 'processed')}
                                                                disabled={isRefundBusy}
                                                                className="rounded bg-emerald-600 px-2 py-1 text-[10px] font-bold text-white disabled:opacity-60"
                                                            >
                                                                {isRefundBusy ? '...' : 'Process'}
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => processRefundRequest(order._id, latestRefund.requestId, 'rejected')}
                                                                disabled={isRefundBusy}
                                                                className="rounded bg-rose-600 px-2 py-1 text-[10px] font-bold text-white disabled:opacity-60"
                                                            >
                                                                Reject
                                                            </button>
                                                        </div>
                                                    ) : null}
                                                </div>
                                            ) : (
                                                <span className="text-gray-400">No refunds</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-4 text-xs text-gray-700 max-w-[220px]">
                                            {latestReplacement ? (
                                                <div className="space-y-1">
                                                    <div className={cn(
                                                        'inline-flex px-2 py-0.5 rounded-full border font-bold uppercase tracking-wider text-[10px]',
                                                        latestReplacement.status === 'shipped'
                                                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                                            : latestReplacement.status === 'rejected'
                                                                ? 'bg-rose-50 text-rose-700 border-rose-200'
                                                                : 'bg-amber-50 text-amber-700 border-amber-200'
                                                    )}>
                                                        {latestReplacement.status}
                                                    </div>
                                                    <div>{latestReplacement.itemTitle || 'Item'}</div>
                                                    {latestReplacement.trackingId && <div className="font-mono text-[10px]">TRK: {latestReplacement.trackingId}</div>}
                                                    {['pending', 'approved'].includes(String(latestReplacement.status || '').toLowerCase()) ? (
                                                        <>
                                                            <input
                                                                type="text"
                                                                placeholder="Tracking ID (optional)"
                                                                value={trackingDrafts[order._id] || ''}
                                                                onChange={(e) => setTrackingDraft(order._id, e.target.value)}
                                                                className="w-full rounded border border-gray-300 px-2 py-1 text-[10px]"
                                                                disabled={isReplacementBusy}
                                                            />
                                                            <div className="flex gap-1 pt-1">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => processReplacementRequest(order._id, latestReplacement.requestId, 'shipped')}
                                                                    disabled={isReplacementBusy}
                                                                    className="rounded bg-emerald-600 px-2 py-1 text-[10px] font-bold text-white disabled:opacity-60"
                                                                >
                                                                    {isReplacementBusy ? '...' : 'Ship'}
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => processReplacementRequest(order._id, latestReplacement.requestId, 'rejected')}
                                                                    disabled={isReplacementBusy}
                                                                    className="rounded bg-rose-600 px-2 py-1 text-[10px] font-bold text-white disabled:opacity-60"
                                                                >
                                                                    Reject
                                                                </button>
                                                            </div>
                                                        </>
                                                    ) : null}
                                                </div>
                                            ) : (
                                                <span className="text-gray-400">No replacements</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-4 text-xs">
                                            <div className="space-y-2">
                                                <div className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">
                                                    Current: {currentStatus}
                                                </div>
                                                <select
                                                    value={statusDrafts[order._id] || currentStatus}
                                                    onChange={(e) => setDraftStatus(order._id, e.target.value)}
                                                    className="w-full rounded border border-gray-300 px-2 py-1.5 text-xs"
                                                    disabled={isBusy || currentStatus === 'cancelled' || currentStatus === 'delivered'}
                                                >
                                                    <option value={currentStatus}>{currentStatus}</option>
                                                    {STATUS_OPTIONS.filter((entry) => entry !== currentStatus).map((entry) => (
                                                        <option key={entry} value={entry}>{entry}</option>
                                                    ))}
                                                </select>
                                                <button
                                                    type="button"
                                                    onClick={() => updateStatus(order._id)}
                                                    disabled={isBusy || currentStatus === 'cancelled' || currentStatus === 'delivered'}
                                                    className="w-full rounded bg-indigo-600 px-2 py-1.5 text-white text-xs font-bold disabled:opacity-50"
                                                >
                                                    {isBusy ? 'Updating...' : 'Apply'}
                                                </button>

                                                <input
                                                    type="text"
                                                    placeholder="Cancel reason (optional)"
                                                    value={cancelReasonDrafts[order._id] || ''}
                                                    onChange={(e) => setDraftCancelReason(order._id, e.target.value)}
                                                    className="w-full rounded border border-gray-300 px-2 py-1.5 text-xs"
                                                    disabled={isCancelBusy || currentStatus === 'cancelled' || currentStatus === 'delivered'}
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => cancelOrderAsAdmin(order._id)}
                                                    disabled={isCancelBusy || currentStatus === 'cancelled' || currentStatus === 'delivered'}
                                                    className="w-full rounded bg-rose-600 px-2 py-1.5 text-white text-xs font-bold disabled:opacity-50"
                                                >
                                                    {currentStatus === 'cancelled'
                                                        ? 'Cancelled'
                                                        : isCancelBusy
                                                            ? 'Cancelling...'
                                                            : 'Admin Cancel'}
                                                </button>

                                                <div className="rounded border border-gray-200 p-2">
                                                    <div className="mb-1 text-[10px] uppercase tracking-wider text-gray-500 font-bold">
                                                        Warranty
                                                    </div>
                                                    {latestWarranty ? (
                                                        <div className="space-y-1">
                                                            <div className={cn(
                                                                'inline-flex px-2 py-0.5 rounded-full border font-bold uppercase tracking-wider text-[10px]',
                                                                latestWarranty.status === 'approved'
                                                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                                                    : latestWarranty.status === 'rejected'
                                                                        ? 'bg-rose-50 text-rose-700 border-rose-200'
                                                                        : 'bg-amber-50 text-amber-700 border-amber-200'
                                                            )}>
                                                                {latestWarranty.status}
                                                            </div>
                                                            <div className="line-clamp-2 text-[10px] text-gray-600">
                                                                {latestWarranty.issue || '-'}
                                                            </div>
                                                            {!['approved', 'rejected'].includes(String(latestWarranty.status || '').toLowerCase()) ? (
                                                                <div className="flex gap-1">
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => processWarrantyClaim(order._id, latestWarranty.claimId, 'approved')}
                                                                        disabled={isWarrantyBusy}
                                                                        className="rounded bg-emerald-600 px-2 py-1 text-[10px] font-bold text-white disabled:opacity-60"
                                                                    >
                                                                        {isWarrantyBusy ? '...' : 'Approve'}
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => processWarrantyClaim(order._id, latestWarranty.claimId, 'rejected')}
                                                                        disabled={isWarrantyBusy}
                                                                        className="rounded bg-rose-600 px-2 py-1 text-[10px] font-bold text-white disabled:opacity-60"
                                                                    >
                                                                        Reject
                                                                    </button>
                                                                </div>
                                                            ) : null}
                                                        </div>
                                                    ) : (
                                                        <span className="text-[10px] text-gray-400">No warranty claims</span>
                                                    )}
                                                </div>

                                                <div className="rounded border border-gray-200 p-2">
                                                    <div className="mb-1 text-[10px] uppercase tracking-wider text-gray-500 font-bold">
                                                        Support Reply
                                                    </div>
                                                    <input
                                                        type="text"
                                                        placeholder="Reply to customer..."
                                                        value={supportReplyDrafts[order._id] || ''}
                                                        onChange={(e) => setSupportDraft(order._id, e.target.value)}
                                                        className="w-full rounded border border-gray-300 px-2 py-1.5 text-[10px]"
                                                        disabled={isSupportBusy}
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={() => sendSupportReply(order._id)}
                                                        disabled={isSupportBusy}
                                                        className="mt-1 w-full rounded bg-slate-900 px-2 py-1.5 text-[10px] font-bold text-white disabled:opacity-60"
                                                    >
                                                        {isSupportBusy ? 'Sending...' : 'Send Reply'}
                                                    </button>
                                                </div>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default OrderList;
