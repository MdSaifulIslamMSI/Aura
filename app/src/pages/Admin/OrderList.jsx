import { useState, useEffect, useContext } from 'react';
import { orderApi } from '@/services/api/orderApi';
import { AuthContext } from '@/context/AuthContext';
import { formatPrice } from '@/utils/format';
import { XCircle, CheckCircle, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import AdminPremiumShell, { AdminHeroStat } from '@/components/shared/AdminPremiumShell';
import PremiumSelect from '@/components/ui/premium-select';
import { useMarket } from '@/context/MarketContext';
import { useStableIcuMessages } from '@/i18n/useStableIcuMessages';
import { FormattedMessage } from 'react-intl';

const STATUS_OPTIONS = ['processing', 'shipped', 'delivered'];

const OrderList = () => {
    const { t: legacyT, formatDateTime } = useMarket();
    const t = useStableIcuMessages(legacyT);
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [statusDrafts, setStatusDrafts] = useState({});
    const [cancelReasonDrafts, setCancelReasonDrafts] = useState({});
    const [statusSubmitting, setStatusSubmitting] = useState({});
    const [cancelSubmitting, setCancelSubmitting] = useState({});
    const [refundSubmitting, setRefundSubmitting] = useState({});
    const [restockDrafts, setRestockDrafts] = useState({});
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
            const nextOrders = Array.isArray(data)
                ? data
                : Array.isArray(data?.orders)
                    ? data.orders
                    : [];
            setOrders(nextOrders);
            const drafts = {};
            nextOrders.forEach((order) => {
                drafts[order._id] = order.orderStatus || (order.isDelivered ? 'delivered' : 'placed');
            });
            setStatusDrafts(drafts);
            const cancelDrafts = {};
            const supportDrafts = {};
            const trkDrafts = {};
            nextOrders.forEach((order) => {
                cancelDrafts[order._id] = '';
                supportDrafts[order._id] = '';
                trkDrafts[order._id] = '';
            });
            setCancelReasonDrafts(cancelDrafts);
            setSupportReplyDrafts(supportDrafts);
            setTrackingDrafts(trkDrafts);
        } catch (error) {
            toast.error(error.message || t('admin.orders.error.load', {}, 'Failed to fetch orders'));
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
            toast.error(t('admin.orders.error.invalidStatus', {}, 'Select a valid status'));
            return;
        }

        setStatusSubmitting((prev) => ({ ...prev, [orderId]: true }));
        try {
            const response = await orderApi.updateOrderStatusAdmin(orderId, {
                status,
                note: t('admin.orders.notes.statusUpdate', {}, 'Updated from admin order console'),
            });
            const updated = response?.order;
            if (updated) {
                setOrders((prev) => prev.map((item) => (item._id === orderId ? updated : item)));
                setStatusDrafts((prev) => ({
                    ...prev,
                    [orderId]: updated.orderStatus || (updated.isDelivered ? 'delivered' : 'placed'),
                }));
            }
            toast.success(response?.message || t('admin.orders.success.statusUpdated', {}, 'Order status updated'));
        } catch (error) {
            toast.error(error.message || t('admin.orders.error.updateStatus', {}, 'Failed to update status'));
        } finally {
            setStatusSubmitting((prev) => ({ ...prev, [orderId]: false }));
        }
    };

    const cancelOrderAsAdmin = async (orderId) => {
        const reason = (cancelReasonDrafts[orderId] || '').trim() || t('admin.orders.notes.cancelledByAdmin', {}, 'Cancelled by admin');
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
            toast.success(response?.message || t('admin.orders.success.cancelled', {}, 'Order cancelled'));
        } catch (error) {
            toast.error(error.message || t('admin.orders.error.cancel', {}, 'Failed to cancel order'));
        } finally {
            setCancelSubmitting((prev) => ({ ...prev, [orderId]: false }));
        }
    };

    const resolveRestockProductId = (item) => {
        const productRef = item?.product ?? item?.productId;
        if (!productRef) return '';
        return typeof productRef === 'object' ? String(productRef._id || productRef.id || '') : String(productRef);
    };

    const buildRestockItems = (order, draft) => {
        const items = [];
        for (const item of Array.isArray(order?.orderItems) ? order.orderItems : []) {
            const productId = resolveRestockProductId(item);
            if (!productId) continue;
            const orderedQuantity = Number(item?.quantity || 0);
            const raw = draft?.quantities?.[productId];
            const quantity = raw === undefined || raw === '' ? orderedQuantity : Number(raw);
            if (Number.isSafeInteger(quantity) && quantity > 0) {
                items.push({ productId, quantity: Math.min(quantity, orderedQuantity) });
            }
        }
        return items;
    };

    const updateRestockDraft = (orderId, updater) => {
        setRestockDrafts((prev) => ({ ...prev, [orderId]: updater(prev[orderId]) }));
    };

    const processRefundRequest = async (order, requestId, status) => {
        const orderId = order._id;
        setRefundSubmitting((prev) => ({ ...prev, [orderId]: true }));
        try {
            const payload = {
                status,
                note: t('admin.orders.notes.refundAction', { status }, `Admin ${status} via order console`),
            };
            if (status === 'processed' && restockDrafts[orderId]?.enabled) {
                const restockItems = buildRestockItems(order, restockDrafts[orderId]);
                if (restockItems.length === 0) {
                    toast.error(t('admin.orders.restock.error.empty', {}, 'Enter a restock quantity for at least one item.'));
                    return;
                }
                payload.restock = true;
                payload.restockItems = restockItems;
            }
            const response = await orderApi.processRefundRequestAdmin(orderId, requestId, payload);
            toast.success(response?.message || t('admin.orders.success.refundUpdated', {}, 'Refund request updated'));
            setRestockDrafts((prev) => ({ ...prev, [orderId]: { enabled: false, quantities: {} } }));
            await loadOrders();
        } catch (error) {
            toast.error(error.message || t('admin.orders.error.refund', {}, 'Failed to process refund request'));
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
                note: t('admin.orders.notes.replacementAction', { status }, `Admin ${status} via order console`),
            });
            toast.success(response?.message || t('admin.orders.success.replacementUpdated', {}, 'Replacement request updated'));
            await loadOrders();
        } catch (error) {
            toast.error(error.message || t('admin.orders.error.replacement', {}, 'Failed to process replacement request'));
        } finally {
            setReplacementSubmitting((prev) => ({ ...prev, [orderId]: false }));
        }
    };

    const processWarrantyClaim = async (orderId, claimId, status) => {
        setWarrantySubmitting((prev) => ({ ...prev, [orderId]: true }));
        try {
            const response = await orderApi.processWarrantyClaimAdmin(orderId, claimId, {
                status,
                note: t('admin.orders.notes.warrantyAction', { status }, `Admin ${status} via order console`),
            });
            toast.success(response?.message || t('admin.orders.success.warrantyUpdated', {}, 'Warranty claim updated'));
            await loadOrders();
        } catch (error) {
            toast.error(error.message || t('admin.orders.error.warranty', {}, 'Failed to process warranty claim'));
        } finally {
            setWarrantySubmitting((prev) => ({ ...prev, [orderId]: false }));
        }
    };

    const sendSupportReply = async (orderId) => {
        const message = (supportReplyDrafts[orderId] || '').trim();
        if (!message) {
            toast.error(t('admin.orders.error.supportMessageRequired', {}, 'Write a support reply message first'));
            return;
        }

        setSupportSubmitting((prev) => ({ ...prev, [orderId]: true }));
        try {
            const response = await orderApi.replySupportAdmin(orderId, { message });
            toast.success(response?.message || t('admin.orders.success.supportSent', {}, 'Support reply sent'));
            setSupportReplyDrafts((prev) => ({ ...prev, [orderId]: '' }));
            await loadOrders();
        } catch (error) {
            toast.error(error.message || t('admin.orders.error.supportReply', {}, 'Failed to send support reply'));
        } finally {
            setSupportSubmitting((prev) => ({ ...prev, [orderId]: false }));
        }
    };

    if (loading) {
        return (
            <AdminPremiumShell
                eyebrow={t('admin.orders.eyebrow', {}, 'Order command')}
                title={t('admin.orders.title', {}, 'Order operations console')}
                description={t('admin.orders.description', {}, 'Track shipping, cancellations, refunds, replacements, warranty claims, and support replies from one premium ops surface.')}
            >
                <div className="admin-premium-panel flex items-center gap-2 p-8 text-slate-400">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t('admin.orders.loading', {}, 'Loading orders...')}
                </div>
            </AdminPremiumShell>
        );
    }

    return (
        <AdminPremiumShell
            eyebrow={t('admin.orders.eyebrow', {}, 'Order command')}
            title={t('admin.orders.title', {}, 'Order operations console')}
            description={t('admin.orders.description', {}, 'Track shipping, cancellations, refunds, replacements, warranty claims, and support replies from one premium operational surface.')}
            actions={(
                <button type="button" onClick={loadOrders} className="admin-premium-button">
                    <RefreshCw className="h-4 w-4" />
                    {t('admin.shared.refresh', {}, 'Refresh')}
                </button>
            )}
            stats={[
                <AdminHeroStat key="orders" label={t('admin.orders.stats.orders', {}, 'Orders')} value={orders.length} detail={t('admin.orders.stats.loadedSet', {}, 'Current loaded console set')} icon={<RefreshCw className="h-5 w-5" />} />,
                <AdminHeroStat key="paid" label={t('admin.orders.stats.paid', {}, 'Paid')} value={orders.filter((order) => order.isPaid).length} detail={t('admin.orders.stats.funded', {}, 'Successfully funded orders')} icon={<CheckCircle className="h-5 w-5" />} />,
                <AdminHeroStat key="pending" label={t('admin.orders.stats.pendingPay', {}, 'Pending pay')} value={orders.filter((order) => !order.isPaid).length} detail={t('admin.orders.stats.awaitingCapture', {}, 'Awaiting successful capture')} icon={<XCircle className="h-5 w-5" />} />,
            ]}
        >

            <div className="admin-premium-table-shell">
                <div className="table-responsive admin-premium-scroll">
                    <table className="admin-premium-table min-w-[1100px]">
                        <thead>
                            <tr>
                                <th>{t('admin.orders.table.id', {}, 'ID')}</th>
                                <th>{t('admin.orders.table.user', {}, 'User')}</th>
                                <th>{t('admin.orders.table.order', {}, 'Order')}</th>
                                <th>{t('admin.orders.table.payment', {}, 'Payment')}</th>
                                <th>{t('admin.orders.table.refundOps', {}, 'Refund Ops')}</th>
                                <th>{t('admin.orders.table.replacementOps', {}, 'Replacement Ops')}</th>
                                <th>{t('admin.orders.table.shippingSupportOps', {}, 'Shipping / Support Ops')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {orders.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-500">
                                        {t('admin.orders.empty.noOrders', {}, 'No orders found')}
                                    </td>
                                </tr>
                            ) : null}
                            {orders.map((order, index) => {
                                const refunds = order.commandCenter?.refunds || [];
                                const replacements = order.commandCenter?.replacements || [];
                                const warrantyClaims = order.commandCenter?.warrantyClaims || [];
                                const latestRefund = refunds.length ? refunds[refunds.length - 1] : null;
                                const latestReplacement = replacements.length ? replacements[replacements.length - 1] : null;
                                const pendingRefundCount = refunds.filter((entry) => ['pending', 'approved'].includes(String(entry?.status || '').toLowerCase())).length;
                                const pendingReplacementCount = replacements.filter((entry) => ['pending', 'approved'].includes(String(entry?.status || '').toLowerCase())).length;
                                const latestWarranty = warrantyClaims.length ? warrantyClaims[warrantyClaims.length - 1] : null;
                                const currentStatus = order.orderStatus || (order.isDelivered ? 'delivered' : 'placed');
                                const isBusy = Boolean(statusSubmitting[order._id]);
                                const isCancelBusy = Boolean(cancelSubmitting[order._id]);
                                const isRefundBusy = Boolean(refundSubmitting[order._id]);
                                const isReplacementBusy = Boolean(replacementSubmitting[order._id]);
                                const isWarrantyBusy = Boolean(warrantySubmitting[order._id]);
                                const isSupportBusy = Boolean(supportSubmitting[order._id]);

                                return (
                                    <tr key={order._id || order.id || `order-${index}`}>
                                        <td className="px-4 py-4 whitespace-nowrap text-sm font-mono text-gray-500">
                                            {String(order._id || order.id || '').slice(-8) || '-'}
                                        </td>
                                        <td className="px-4 py-4 text-sm text-gray-900">
                                            {order.user ? order.user.name : t('admin.orders.userFallback', {}, 'Unknown User')}
                                            <div className="text-xs text-gray-400">{order.user?.email}</div>
                                        </td>
                                        <td className="px-4 py-4 text-sm text-gray-900">
                                            <div className="font-semibold">{formatPrice(order.totalPrice)}</div>
                                            <div className="text-xs text-gray-500">
                                                {formatDateTime(order.createdAt)}
                                            </div>
                                            <div className="text-xs text-gray-500">
                                                {t('admin.orders.items', { count: order.orderItems?.length || 0 }, `${order.orderItems?.length || 0} item(s)`)}
                                            </div>
                                        </td>
                                        <td className="px-4 py-4 text-sm">
                                            {order.isPaid ? (
                                                <span className="text-green-600 inline-flex items-center gap-1 font-semibold">
                                                    <CheckCircle className="w-3 h-3" /> {t('admin.orders.payment.paid', {}, 'Paid')}
                                                </span>
                                            ) : (
                                                <span className="text-red-500 inline-flex items-center gap-1 font-semibold">
                                                    <XCircle className="w-3 h-3" /> {t('admin.orders.payment.pending', {}, 'Pending')}
                                                </span>
                                            )}
                                            <div className="text-xs text-gray-500 mt-1">{t('admin.orders.payment.state', {}, 'State')}: {order.paymentState || t('admin.orders.payment.pending', {}, 'pending')}</div>
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
                                                    {pendingRefundCount > 1 ? (
                                                        <div className="text-[10px] font-bold text-amber-700">
                                                            {t('admin.orders.pendingMore', { count: pendingRefundCount - 1 }, `+${pendingRefundCount - 1} more pending`)}
                                                        </div>
                                                    ) : null}
                                                    {latestRefund.refundId && <div className="font-mono text-[10px]"><FormattedMessage id="order.jsx.text.id" defaultMessage="ID:" />{' '}{latestRefund.refundId}</div>}
                                                    {['pending', 'approved'].includes(String(latestRefund.status || '').toLowerCase()) ? (
                                                        <div className="space-y-1 pt-1">
                                                            <label className="flex items-center gap-1.5 text-[10px] font-semibold text-gray-600">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={Boolean(restockDrafts[order._id]?.enabled)}
                                                                    onChange={(event) => updateRestockDraft(order._id, (prev) => ({
                                                                        enabled: event.target.checked,
                                                                        quantities: event.target.checked
                                                                            ? Object.fromEntries((order.orderItems || [])
                                                                                .map((item) => [resolveRestockProductId(item), String(item?.quantity ?? '')]))
                                                                            : (prev?.quantities || {}),
                                                                    }))}
                                                                    className="h-3 w-3 rounded border-gray-300"
                                                                    disabled={isRefundBusy}
                                                                />
                                                                {t('admin.orders.restock.toggle', {}, 'Restock returned items')}
                                                            </label>
                                                            {restockDrafts[order._id]?.enabled ? (
                                                                <div className="space-y-1 rounded border border-gray-200 bg-gray-50 p-1.5">
                                                                    <div className="text-[10px] text-gray-500">
                                                                        {t('admin.orders.restock.hint', {}, 'Returned units re-enter inventory once the refund is processed.')}
                                                                    </div>
                                                                    {(order.orderItems || []).map((item) => {
                                                                        const productId = resolveRestockProductId(item);
                                                                        const orderedQuantity = Number(item?.quantity || 0);
                                                                        return (
                                                                            <label key={productId || item?.title} className="flex items-center justify-between gap-2 text-[10px] text-gray-600">
                                                                                <span className="truncate">{item?.title || productId}</span>
                                                                                <span className="flex items-center gap-1">
                                                                                    {t('admin.orders.restock.quantityLabel', {}, 'Qty')}
                                                                                    <input
                                                                                        type="number"
                                                                                        min={0}
                                                                                        max={orderedQuantity}
                                                                                        value={restockDrafts[order._id]?.quantities?.[productId] ?? String(orderedQuantity)}
                                                                                        onChange={(event) => updateRestockDraft(order._id, (prev) => ({
                                                                                            ...prev,
                                                                                            quantities: { ...(prev?.quantities || {}), [productId]: event.target.value },
                                                                                        }))}
                                                                                        className="w-12 rounded border border-gray-300 px-1 py-0.5 text-right text-[10px]"
                                                                                        disabled={isRefundBusy}
                                                                                    />
                                                                                </span>
                                                                            </label>
                                                                        );
                                                                    })}
                                                                </div>
                                                            ) : null}
                                                            <div className="flex gap-1">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => processRefundRequest(order, latestRefund.requestId, 'processed')}
                                                                    disabled={isRefundBusy}
                                                                    className="admin-premium-button admin-premium-button-success px-2 py-1 text-[10px] font-bold disabled:opacity-60"
                                                                >
                                                                    {isRefundBusy ? t('admin.shared.busy', {}, '...') : t('admin.orders.actions.process', {}, 'Process')}
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => processRefundRequest(order, latestRefund.requestId, 'rejected')}
                                                                    disabled={isRefundBusy}
                                                                    className="admin-premium-button admin-premium-button-danger px-2 py-1 text-[10px] font-bold disabled:opacity-60"
                                                                >
                                                                    {t('admin.orders.actions.reject', {}, 'Reject')}
                                                                </button>
                                                            </div>
                                                        </div>
                                                    ) : null}
                                                </div>
                                            ) : (
                                                <span className="text-gray-400">{t('admin.orders.empty.refunds', {}, 'No refunds')}</span>
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
                                                    <div>{latestReplacement.itemTitle || <FormattedMessage id="order.jsx.expression.item" defaultMessage="Item" />}</div>
                                                    {pendingReplacementCount > 1 ? (
                                                        <div className="text-[10px] font-bold text-amber-700">
                                                            {t('admin.orders.pendingMore', { count: pendingReplacementCount - 1 }, `+${pendingReplacementCount - 1} more pending`)}
                                                        </div>
                                                    ) : null}
                                                    {latestReplacement.trackingId && <div className="font-mono text-[10px]"><FormattedMessage id="order.jsx.text.trk" defaultMessage="TRK:" />{' '}{latestReplacement.trackingId}</div>}
                                                    {['pending', 'approved'].includes(String(latestReplacement.status || '').toLowerCase()) ? (
                                                        <>
                                                            <input
                                                                type="text"
                                                                placeholder={t('admin.orders.trackingPlaceholder', {}, 'Tracking ID (optional)')}
                                                                value={trackingDrafts[order._id] || ''}
                                                                onChange={(e) => setTrackingDraft(order._id, e.target.value)}
                                                                className="admin-premium-control w-full px-2 py-1 text-[10px]"
                                                                disabled={isReplacementBusy}
                                                            />
                                                            <div className="flex gap-1 pt-1">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => processReplacementRequest(order._id, latestReplacement.requestId, 'shipped')}
                                                                    disabled={isReplacementBusy}
                                                                    className="admin-premium-button admin-premium-button-success px-2 py-1 text-[10px] font-bold disabled:opacity-60"
                                                                >
                                                                    {isReplacementBusy ? t('admin.shared.busy', {}, '...') : t('admin.orders.actions.ship', {}, 'Ship')}
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => processReplacementRequest(order._id, latestReplacement.requestId, 'rejected')}
                                                                    disabled={isReplacementBusy}
                                                                    className="admin-premium-button admin-premium-button-danger px-2 py-1 text-[10px] font-bold disabled:opacity-60"
                                                                >
                                                                    {t('admin.orders.actions.reject', {}, 'Reject')}
                                                                </button>
                                                            </div>
                                                        </>
                                                    ) : null}
                                                </div>
                                            ) : (
                                                <span className="text-gray-400">{t('admin.orders.empty.replacements', {}, 'No replacements')}</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-4 text-xs">
                                            <div className="space-y-2">
                                                <div className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">
                                                    {t('admin.orders.currentStatus', { status: currentStatus }, `Current: ${currentStatus}`)}
                                                </div>
                                                <PremiumSelect
                                                    value={statusDrafts[order._id] || currentStatus}
                                                    onChange={(e) => setDraftStatus(order._id, e.target.value)}
                                                    className="admin-premium-control w-full px-2 py-1.5 text-xs"
                                                    disabled={isBusy || currentStatus === 'cancelled' || currentStatus === 'delivered'}
                                                >
                                                    <option value={currentStatus}>{currentStatus}</option>
                                                    {STATUS_OPTIONS.filter((entry) => entry !== currentStatus).map((entry) => (
                                                        <option key={entry} value={entry}>{entry}</option>
                                                    ))}
                                                </PremiumSelect>
                                                <button
                                                    type="button"
                                                    onClick={() => updateStatus(order._id)}
                                                    disabled={isBusy || currentStatus === 'cancelled' || currentStatus === 'delivered'}
                                                    className="admin-premium-button admin-premium-button-primary w-full px-2 py-1.5 text-xs font-bold disabled:opacity-50"
                                                >
                                                    {isBusy ? t('admin.orders.actions.updating', {}, 'Updating...') : t('admin.orders.actions.apply', {}, 'Apply')}
                                                </button>

                                                <input
                                                    type="text"
                                                    placeholder={t('admin.orders.cancelReasonPlaceholder', {}, 'Cancel reason (optional)')}
                                                    value={cancelReasonDrafts[order._id] || ''}
                                                    onChange={(e) => setDraftCancelReason(order._id, e.target.value)}
                                                    className="admin-premium-control w-full px-2 py-1.5 text-xs"
                                                    disabled={isCancelBusy || currentStatus === 'cancelled' || currentStatus === 'delivered'}
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => cancelOrderAsAdmin(order._id)}
                                                    disabled={isCancelBusy || currentStatus === 'cancelled' || currentStatus === 'delivered'}
                                                    className="admin-premium-button admin-premium-button-danger w-full px-2 py-1.5 text-xs font-bold disabled:opacity-50"
                                                >
                                                    {currentStatus === 'cancelled'
                                                        ? t('admin.orders.cancelled', {}, 'Cancelled')
                                                        : isCancelBusy
                                                            ? t('admin.orders.actions.cancelling', {}, 'Cancelling...')
                                                            : t('admin.orders.actions.adminCancel', {}, 'Admin Cancel')}
                                                </button>

                                                <div className="rounded border border-gray-200 p-2">
                                                    <div className="mb-1 text-[10px] uppercase tracking-wider text-gray-500 font-bold">
                                                        {t('admin.orders.warranty.title', {}, 'Warranty')}
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
                                                                    className="admin-premium-button admin-premium-button-success px-2 py-1 text-[10px] font-bold disabled:opacity-60"
                                                                    >
                                                                        {isWarrantyBusy ? t('admin.shared.busy', {}, '...') : t('admin.orders.actions.approve', {}, 'Approve')}
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => processWarrantyClaim(order._id, latestWarranty.claimId, 'rejected')}
                                                                    disabled={isWarrantyBusy}
                                                                    className="admin-premium-button admin-premium-button-danger px-2 py-1 text-[10px] font-bold disabled:opacity-60"
                                                                >
                                                                        {t('admin.orders.actions.reject', {}, 'Reject')}
                                                                    </button>
                                                                </div>
                                                            ) : null}
                                                        </div>
                                                    ) : (
                                                        <span className="text-[10px] text-gray-400">{t('admin.orders.empty.warranty', {}, 'No warranty claims')}</span>
                                                    )}
                                                </div>

                                                <div className="rounded border border-gray-200 p-2">
                                                    <div className="mb-1 text-[10px] uppercase tracking-wider text-gray-500 font-bold">
                                                        {t('admin.orders.supportReply', {}, 'Support Reply')}
                                                    </div>
                                                    <input
                                                        type="text"
                                                        placeholder={t('admin.orders.supportPlaceholder', {}, 'Reply to customer...')}
                                                        value={supportReplyDrafts[order._id] || ''}
                                                        onChange={(e) => setSupportDraft(order._id, e.target.value)}
                                                    className="admin-premium-control w-full px-2 py-1.5 text-[10px]"
                                                    disabled={isSupportBusy}
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => sendSupportReply(order._id)}
                                                    disabled={isSupportBusy}
                                                    className="admin-premium-button mt-1 w-full px-2 py-1.5 text-[10px] font-bold disabled:opacity-60"
                                                >
                                                    {isSupportBusy ? t('admin.orders.actions.sending', {}, 'Sending...') : t('admin.orders.actions.sendReply', {}, 'Send Reply')}
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
        </AdminPremiumShell>
    );
};

export default OrderList;
