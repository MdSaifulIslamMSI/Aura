import { useState, useEffect, useContext, useMemo, useRef } from 'react';
import { orderApi } from '@/services/api';
import { AuthContext } from '@/context/AuthContext';
import { useMarket } from '@/context/MarketContext';
import { Package, Clock, CheckCircle, ChevronDown, ChevronUp, Zap, Server, ShieldCheck, AlertTriangle, Loader2, MessageSquare, RefreshCw, ShieldAlert, Wallet, XCircle } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { cn } from '@/lib/utils';

const getOrderStatusLabel = (orderMeta, t) => {
    if (orderMeta.orderStatus === 'cancelled') {
        return t('orders.status.cancelled', {}, 'Cancelled');
    }
    if (orderMeta.isDelivered) {
        return t('orders.status.delivered', {}, 'Delivered');
    }
    return t('orders.status.inTransit', {}, 'In Transit');
};

const getCommandStatusLabel = (status, t) => {
    const normalized = String(status || '').toLowerCase();
    switch (normalized) {
        case 'processed':
            return t('orders.command.status.processed', {}, 'processed');
        case 'rejected':
            return t('orders.command.status.rejected', {}, 'rejected');
        case 'shipped':
            return t('orders.command.status.shipped', {}, 'shipped');
        case 'pending':
            return t('orders.command.status.pending', {}, 'pending');
        default:
            return normalized || t('orders.command.status.pending', {}, 'pending');
    }
};

const Orders = () => {
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const { currentUser } = useContext(AuthContext);
    const { t, formatPrice } = useMarket();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const focusOrderId = String(searchParams.get('focus') || '').trim();
    const shouldExpandFocus = searchParams.get('expand') === '1' || searchParams.get('support') === '1';

    const orderSummary = useMemo(() => {
        const activeOrders = orders.filter((order) => {
            const status = String(order.orderStatus || '').toLowerCase();
            return !order.isDelivered && status !== 'cancelled';
        }).length;

        const deliveredOrders = orders.filter((order) => {
            const status = String(order.orderStatus || '').toLowerCase();
            return order.isDelivered || status === 'delivered';
        }).length;

        const protectedPayments = orders.filter((order) => Boolean(order.isPaid)).length;
        const totalSpend = orders.reduce((sum, order) => sum + (Number(order.totalPrice) || 0), 0);

        return [
            {
                label: t('orders.summary.active.label', {}, 'Active Orders'),
                value: activeOrders,
                detail: t('orders.summary.active.detail', {}, 'Orders still moving through delivery or post-purchase handling.'),
                tone: 'text-neo-cyan',
                icon: Clock,
            },
            {
                label: t('orders.summary.delivered.label', {}, 'Delivered'),
                value: deliveredOrders,
                detail: t('orders.summary.delivered.detail', {}, 'Orders that have completed the delivery side of the lifecycle.'),
                tone: 'text-neo-emerald',
                icon: CheckCircle,
            },
            {
                label: t('orders.summary.payments.label', {}, 'Protected Payments'),
                value: protectedPayments,
                detail: t('orders.summary.payments.detail', {}, 'Orders already marked paid by the backend payment state.'),
                tone: 'text-amber-300',
                icon: ShieldCheck,
            },
            {
                label: t('orders.summary.spend.label', {}, 'Total Spend'),
                value: formatPrice(totalSpend),
                detail: t('orders.summary.spend.detail', {}, 'Lifetime order value visible from this command center session.'),
                tone: 'text-white',
                icon: Wallet,
            },
        ];
    }, [formatPrice, orders, t]);

    useEffect(() => {
        if (currentUser) {
            orderApi.getMyOrders()
                .then(data => {
                    // Sort orders by latest first
                    const sortedOrders = data.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
                    setOrders(sortedOrders);
                })
                .catch(err => console.error("Failed to fetch orders:", err))
                .finally(() => setLoading(false));
        } else {
            setLoading(false);
        }
    }, [currentUser]);

    if (!currentUser) {
        return (
            <div className="min-h-[80vh] flex items-center justify-center relative overflow-hidden">
                <div className="container-custom py-10">
                    <div className="bg-white/5 border border-white/10 rounded-3xl p-12 text-center max-w-lg mx-auto shadow-glass">
                        <h2 className="text-2xl font-black text-white uppercase tracking-widest mb-6 border-b border-white/10 pb-4">{t('orders.authRequiredTitle', {}, 'Authentication Required')}</h2>
                        <p className="text-slate-400 mb-8">{t('orders.authRequiredBody', {}, 'Sign in to view your order history.')}</p>
                        <button onClick={() => navigate('/login')} className="btn-primary w-full shadow-[0_0_15px_rgba(6,182,212,0.3)]">
                            {t('orders.signIn', {}, 'Sign In')}
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center relative overflow-hidden">
                <div className="absolute inset-0 bg-zinc-950 flex flex-col items-center justify-center">
                    <div className="relative w-24 h-24 flex items-center justify-center mb-6">
                        <div className="absolute inset-0 border-4 border-white/10 rounded-full" />
                        <div className="absolute inset-0 border-4 border-neo-cyan rounded-full border-t-transparent animate-spin" />
                        <Server className="w-8 h-8 text-neo-cyan animate-pulse shadow-[0_0_10px_rgba(6,182,212,0.8)]" />
                    </div>
                    <p className="text-neo-cyan font-bold tracking-[0.3em] uppercase text-xs">{t('orders.loading', {}, 'Loading Orders...')}</p>
                </div>
            </div>
        );
    }

    if (orders.length === 0) {
        return (
            <div className="min-h-[80vh] flex items-center justify-center relative overflow-hidden">
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(80vw,600px)] h-[min(80vw,600px)] bg-neo-fuchsia/5 rounded-full blur-[150px] pointer-events-none -z-10" />
                <div className="container-custom py-10">
                    <div className="bg-white/5 border border-white/10 rounded-3xl p-12 text-center max-w-lg mx-auto shadow-glass relative group overflow-hidden">
                        <div className="absolute inset-0 bg-gradient-to-br from-transparent to-neo-fuchsia/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />

                        <div className="w-24 h-24 rounded-full bg-zinc-950/50 border border-white/10 flex items-center justify-center mx-auto mb-6 shadow-[0_0_30px_rgba(0,0,0,0.5)]">
                            <Package className="w-10 h-10 text-slate-500 group-hover:text-neo-fuchsia transition-colors duration-300" />
                        </div>

                        <h2 className="text-3xl font-black text-white tracking-tight mb-4">{t('orders.emptyTitle', {}, 'No Orders Yet')}</h2>
                        <p className="text-slate-400 mb-8 font-medium">{t('orders.emptyBody', {}, "You haven't placed any orders yet.")}</p>
                        <button onClick={() => navigate('/')} className="btn-primary w-full shadow-[0_0_20px_rgba(217,70,239,0.3)] flex items-center justify-center gap-2">
                            <Zap className="w-4 h-4 fill-white" /> {t('orders.startShopping', {}, 'Start Shopping')}
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen pb-20 pt-8 relative">
            <div className="absolute top-0 right-0 w-[min(70vw,500px)] h-[min(70vw,500px)] bg-neo-cyan/5 rounded-full blur-[150px] pointer-events-none -z-10" />

            <div className="container-custom max-w-4xl mx-auto px-4 lg:px-8">
                <div className="flex items-center gap-4 mb-10 pb-6 border-b border-white/10">
                    <Server className="w-8 h-8 text-neo-cyan drop-shadow-[0_0_10px_rgba(6,182,212,0.8)]" />
                    <div>
                        <h1 className="text-3xl font-black text-white tracking-tighter uppercase">{t('orders.title', {}, 'Order History')}</h1>
                        <p className="mt-2 text-sm text-slate-400">{t('orders.subtitle', {}, 'Track delivery, payment, refund, replacement, and support actions from one persistent surface.')}</p>
                    </div>
                </div>

                <section className="mb-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    {orderSummary.map((item) => (
                        <article
                            key={item.label}
                            className="rounded-[1.5rem] border border-white/10 bg-white/[0.045] p-5 shadow-glass"
                        >
                            <div className="flex items-center justify-between gap-3">
                                <div className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">{item.label}</div>
                                <item.icon className={cn('h-4 w-4', item.tone)} />
                            </div>
                            <div className={cn('mt-4 text-3xl font-black', item.tone)}>{item.value}</div>
                            <p className="mt-2 text-sm leading-6 text-slate-400">{item.detail}</p>
                        </article>
                    ))}
                </section>

                <section className="mb-8 rounded-[1.75rem] border border-white/10 bg-white/[0.04] p-5 shadow-glass">
                    <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.24em] text-neo-cyan">
                        <ShieldCheck className="h-4 w-4" />
                        {t('orders.trustLayerTitle', {}, 'Post-Purchase Trust Layer')}
                    </div>
                    <div className="mt-4 grid gap-3 md:grid-cols-3">
                        <div className="rounded-2xl border border-white/8 bg-zinc-950/35 px-4 py-4 text-sm text-slate-300">
                            <span className="mr-2 text-neo-cyan">•</span>
                            {t('orders.trustNote1', {}, 'Order status, payment state, and command-center actions are read from backend order records.')}
                        </div>
                        <div className="rounded-2xl border border-white/8 bg-zinc-950/35 px-4 py-4 text-sm text-slate-300">
                            <span className="mr-2 text-neo-emerald">•</span>
                            {t('orders.trustNote2', {}, 'Refund, replacement, warranty, and support requests remain attached to the originating order.')}
                        </div>
                        <div className="rounded-2xl border border-white/8 bg-zinc-950/35 px-4 py-4 text-sm text-slate-300">
                            <span className="mr-2 text-amber-300">•</span>
                            {t('orders.trustNote3', {}, 'Each order card exposes trust timeline events before you trigger a disruptive action.')}
                        </div>
                    </div>
                </section>

                <div className="space-y-6">
                    {orders.map((order) => (
                        <OrderCard
                            key={order._id}
                            order={order}
                            autoExpand={shouldExpandFocus && String(order._id) === focusOrderId}
                        />
                    ))}
                </div>
            </div>
        </div>
    );
};

export const OrderCard = ({ order, autoExpand = false }) => {
    const [expanded, setExpanded] = useState(false);
    const { t, formatDateTime, formatPrice } = useMarket();
    const [orderMeta, setOrderMeta] = useState({
        orderStatus: order.orderStatus || (order.isDelivered ? 'delivered' : 'placed'),
        isDelivered: Boolean(order.isDelivered),
        isPaid: Boolean(order.isPaid),
    });
    const [timeline, setTimeline] = useState([]);
    const [timelineLoading, setTimelineLoading] = useState(false);
    const [timelineError, setTimelineError] = useState('');
    const [commandCenter, setCommandCenter] = useState(null);
    const [commandLoading, setCommandLoading] = useState(false);
    const [commandError, setCommandError] = useState('');
    const [commandSubmitting, setCommandSubmitting] = useState('');
    const [commandInput, setCommandInput] = useState({
        cancelReason: '',
        refundReason: '',
        refundAmount: '',
        replaceReason: '',
        supportMessage: '',
        warrantyIssue: '',
    });
    const cardRef = useRef(null);

    // Format Date
    const date = String(formatDateTime(order.createdAt, undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    }) || t('orders.date.unknown', {}, 'Unknown')).toUpperCase();

    useEffect(() => {
        if (!autoExpand) return;
        setExpanded(true);
        window.requestAnimationFrame(() => {
            cardRef.current?.scrollIntoView({
                behavior: 'smooth',
                block: 'start',
            });
        });
    }, [autoExpand]);

    useEffect(() => {
        if (!expanded || timelineLoading || timeline.length > 0 || timelineError) {
            return undefined;
        }

        let active = true;
        setTimelineLoading(true);
        setTimelineError('');

        orderApi.getOrderTimeline(order._id)
            .then((response) => {
                if (!active) return;
                setTimeline(Array.isArray(response?.timeline) ? response.timeline : []);
            })
            .catch((error) => {
                if (!active) return;
                setTimelineError(error.message || t('orders.timeline.error.load', {}, 'Unable to load trust timeline'));
            })
            .finally(() => {
                if (active) {
                    setTimelineLoading(false);
                }
            });

        return () => {
            active = false;
        };
    }, [expanded, order._id, t, timeline.length, timelineError]);

    useEffect(() => {
        if (!expanded || commandLoading || commandCenter || commandError) {
            return undefined;
        }

        let active = true;
        setCommandLoading(true);
        setCommandError('');

        orderApi.getCommandCenter(order._id)
            .then((response) => {
                if (!active) return;
                setCommandCenter(response?.commandCenter || null);
            })
            .catch((error) => {
                if (!active) return;
                setCommandError(error.message || t('orders.command.error.load', {}, 'Unable to load command center'));
            })
            .finally(() => {
                if (active) {
                    setCommandLoading(false);
                }
            });

        return () => {
            active = false;
        };
    }, [commandCenter, commandError, expanded, order._id, t]);

    const formatTimelineDate = (value) => {
        const dateValue = new Date(value);
        if (!Number.isFinite(dateValue.getTime())) return t('orders.date.unknown', {}, 'Unknown');
        return formatDateTime(dateValue, undefined, {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
        });
    };

    const timelineToneClass = (severity) => {
        switch (severity) {
            case 'critical':
                return 'border-neo-rose/40 bg-neo-rose/10 text-neo-rose';
            case 'warning':
                return 'border-amber-400/40 bg-amber-400/10 text-amber-300';
            default:
                return 'border-neo-cyan/35 bg-neo-cyan/10 text-neo-cyan';
        }
    };

    const timelineDotClass = (severity) => {
        switch (severity) {
            case 'critical':
                return 'bg-neo-rose border-neo-rose/80';
            case 'warning':
                return 'bg-amber-300 border-amber-300/80';
            default:
                return 'bg-neo-cyan border-neo-cyan/80';
        }
    };

    const refreshCommandCenter = async () => {
        setCommandLoading(true);
        setCommandError('');
        try {
            const response = await orderApi.getCommandCenter(order._id);
            setCommandCenter(response?.commandCenter || null);
        } catch (error) {
            setCommandError(error.message || t('orders.command.error.refresh', {}, 'Unable to refresh command center'));
        } finally {
            setCommandLoading(false);
        }
    };

    const submitCommand = async (type) => {
        setCommandSubmitting(type);
        setCommandError('');
        try {
            if (type === 'cancel') {
                const response = await orderApi.cancelOrder(order._id, {
                    reason: commandInput.cancelReason || t('orders.command.cancel.defaultReason', {}, 'Cancelled by customer'),
                });
                setCommandInput((prev) => ({ ...prev, cancelReason: '' }));
                if (response?.order) {
                    setOrderMeta({
                        orderStatus: response.order.orderStatus || 'cancelled',
                        isDelivered: Boolean(response.order.isDelivered),
                        isPaid: Boolean(response.order.isPaid),
                    });
                } else {
                    setOrderMeta((prev) => ({ ...prev, orderStatus: 'cancelled' }));
                }
                setTimeline([]);
            } else if (type === 'refund') {
                await orderApi.requestRefund(order._id, {
                    reason: commandInput.refundReason || t('orders.command.refund.defaultReason', {}, 'Customer refund request'),
                    amount: commandInput.refundAmount ? Number(commandInput.refundAmount) : undefined,
                });
                setCommandInput((prev) => ({ ...prev, refundReason: '', refundAmount: '' }));
            } else if (type === 'replace') {
                const firstItem = order.orderItems?.[0];
                await orderApi.requestReplacement(order._id, {
                    reason: commandInput.replaceReason || t('orders.command.replace.defaultReason', {}, 'Product issue reported'),
                    itemProductId: firstItem?.product || firstItem?.id,
                    itemTitle: firstItem?.title,
                });
                setCommandInput((prev) => ({ ...prev, replaceReason: '' }));
            } else if (type === 'support') {
                await orderApi.sendSupportMessage(order._id, {
                    message: commandInput.supportMessage || t('orders.command.support.defaultMessage', {}, 'Need help with this order.'),
                });
                setCommandInput((prev) => ({ ...prev, supportMessage: '' }));
            } else if (type === 'warranty') {
                const firstItem = order.orderItems?.[0];
                await orderApi.createWarrantyClaim(order._id, {
                    issue: commandInput.warrantyIssue || t('orders.command.warranty.defaultIssue', {}, 'Warranty support needed'),
                    itemProductId: firstItem?.product || firstItem?.id,
                    itemTitle: firstItem?.title,
                });
                setCommandInput((prev) => ({ ...prev, warrantyIssue: '' }));
            }
            await refreshCommandCenter();
        } catch (error) {
            setCommandError(error.message || t('orders.command.error.action', {}, 'Command center action failed'));
        } finally {
            setCommandSubmitting('');
        }
    };

    return (
        <div ref={cardRef} className={cn("bg-white/5 rounded-2xl shadow-glass border transition-all duration-300 overflow-hidden relative group", expanded ? "border-neo-cyan/50 shadow-[0_0_25px_rgba(6,182,212,0.15)] bg-zinc-950/80" : "border-white/10 hover:border-white/30")}>
            {expanded && <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-neo-cyan to-neo-fuchsia z-10" />}

            {/* Header */}
            <div className="p-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 cursor-pointer relative z-10"
                onClick={() => setExpanded(!expanded)}>

                <div className="flex gap-5 items-center">
                    <div className="bg-zinc-950/80 border border-white/10 p-4 rounded-xl shadow-inner group-hover:border-neo-cyan/40 transition-colors">
                        <Package className="w-6 h-6 text-neo-cyan" />
                    </div>
                    <div>
                        <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">{t('orders.orderId', {}, 'Order ID')}: <span className="font-mono text-neo-fuchsia tracking-normal ml-1">#{order._id.slice(-8).toUpperCase()}</span></p>
                        <h3 className="font-black text-white text-xl tracking-tight">{formatPrice(order.totalPrice)}</h3>
                    </div>
                </div>

                <div className="flex items-center gap-6 w-full sm:w-auto justify-between sm:justify-end border-t border-white/10 sm:border-0 pt-4 sm:pt-0 mt-2 sm:mt-0">
                    <div className="flex flex-col items-start sm:items-end gap-1.5">
                        <p className="text-xs font-bold text-slate-400 tracking-wider">{t('orders.dateLabel', {}, 'Date')}: {date}</p>
                        <span className={cn("text-[10px] px-3 py-1 rounded border font-black uppercase tracking-widest flex items-center gap-1.5",
                            orderMeta.orderStatus === 'cancelled'
                                ? 'bg-amber-500/15 border-amber-400/30 text-amber-200 shadow-[0_0_10px_rgba(251,191,36,0.2)]'
                                : orderMeta.isDelivered
                                ? 'bg-neo-cyan/10 border-neo-cyan/30 text-neo-cyan shadow-[0_0_10px_rgba(6,182,212,0.2)]'
                                : 'bg-neo-rose/10 border-neo-rose/30 text-neo-rose shadow-[0_0_10px_rgba(244,63,94,0.2)]'
                        )}>
                            {orderMeta.orderStatus === 'cancelled'
                                ? <XCircle className="w-3 h-3" />
                                : orderMeta.isDelivered
                                    ? <CheckCircle className="w-3 h-3" />
                                    : <Clock className="w-3 h-3" />}
                            {getOrderStatusLabel(orderMeta, t)}
                        </span>
                    </div>
                    <div className="w-8 h-8 rounded-full bg-zinc-950/50 border border-white/10 flex items-center justify-center text-slate-400 group-hover:text-white transition-colors">
                        {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </div>
                </div>
            </div>

            {/* Details (Collapsible) */}
            {expanded && (
                <div className="p-6 border-t border-white/5 bg-zinc-950/50 relative z-10 animate-fade-in">
                    <div className="space-y-4">
                        <h4 className="font-bold text-xs text-slate-500 uppercase tracking-widest border-b border-white/5 pb-2">{t('orders.itemsTitle', {}, 'Items in Order')}</h4>
                        {order.orderItems.map((item, index) => (
                            <div key={index} className="flex gap-6 items-center bg-white/5 p-4 rounded-xl border border-white/10 hover:bg-white/10 transition-colors">
                                <div className="w-16 h-16 bg-zinc-950/80 rounded-lg p-2 border border-white/5 flex items-center justify-center">
                                    <img src={item.image} alt={item.title} className="w-full h-full object-contain mix-blend-screen" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="font-bold text-white line-clamp-1 text-sm">{item.title}</p>
                                    <p className="text-xs font-bold text-neo-cyan mt-1">{t('orders.qty', {}, 'Qty')}: {item.quantity}</p>
                                </div>
                                <p className="font-black text-white whitespace-nowrap">{formatPrice(item.price)}</p>
                            </div>
                        ))}
                    </div>

                    <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
                        <div className="bg-white/5 p-6 rounded-2xl border border-white/10">
                            <h4 className="font-black text-white text-xs uppercase tracking-widest mb-4 flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-neo-fuchsia shadow-[0_0_5px_rgba(217,70,239,0.8)]" />
                                {t('orders.addressTitle', {}, 'Target Coordinates')}
                            </h4>
                            <div className="space-y-1 text-slate-300 font-medium leading-relaxed">
                                <p className="text-white">{order.shippingAddress.address}</p>
                                <p>{order.shippingAddress.city}, {order.shippingAddress.postalCode}</p>
                                <p>{order.shippingAddress.country}</p>
                            </div>
                        </div>
                        <div className="bg-white/5 p-6 rounded-2xl border border-white/10">
                            <h4 className="font-black text-white text-xs uppercase tracking-widest mb-4 flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-neo-cyan shadow-[0_0_5px_rgba(6,182,212,0.8)]" />
                                {t('orders.paymentTitle', {}, 'Payment Details')}
                            </h4>
                            <div className="flex justify-between items-center py-2 border-b border-white/5">
                                <span className="text-slate-400 font-bold uppercase tracking-wider text-[10px]">{t('orders.paymentMethod', {}, 'Method')}:</span>
                                <span className="font-medium text-white">{order.paymentMethod}</span>
                            </div>
                            <div className="flex justify-between items-center mt-3">
                                <span className="text-slate-400 font-bold uppercase tracking-wider text-[10px]">{t('orders.paymentVerification', {}, 'Verification')}:</span>
                                <span className={cn("font-black tracking-wider uppercase text-[10px] px-2 py-1 rounded border",
                                    orderMeta.isPaid
                                        ? 'bg-neo-cyan/10 border-neo-cyan/30 text-neo-cyan shadow-[0_0_8px_rgba(6,182,212,0.3)]'
                                        : 'bg-neo-rose/10 border-neo-rose/30 text-neo-rose shadow-[0_0_8px_rgba(244,63,94,0.3)]'
                                )}>
                                    {orderMeta.isPaid ? t('orders.payment.paid', {}, 'Paid') : t('orders.payment.pending', {}, 'Pending')}
                                </span>
                            </div>
                        </div>
                    </div>

                    <div className="mt-8 bg-white/5 p-6 rounded-2xl border border-white/10">
                        <h4 className="font-black text-white text-xs uppercase tracking-widest mb-4 flex items-center gap-2">
                            <ShieldCheck className="w-4 h-4 text-neo-cyan" />
                            {t('orders.timelineTitle', {}, 'Trust Timeline')}
                        </h4>

                        {timelineLoading && (
                            <div className="flex items-center gap-2 text-slate-300 text-sm">
                                <Loader2 className="w-4 h-4 animate-spin text-neo-cyan" />
                                {t('orders.timeline.loading', {}, 'Loading trust events...')}
                            </div>
                        )}

                        {!timelineLoading && timelineError && (
                            <div className="rounded-xl border border-neo-rose/35 bg-neo-rose/10 px-4 py-3 text-sm text-neo-rose flex items-center gap-2">
                                <AlertTriangle className="w-4 h-4" />
                                {timelineError}
                            </div>
                        )}

                        {!timelineLoading && !timelineError && timeline.length === 0 && (
                            <p className="text-sm text-slate-400">{t('orders.timeline.empty', {}, 'No timeline events available yet.')}</p>
                        )}

                        {!timelineLoading && !timelineError && timeline.length > 0 && (
                            <ol className="space-y-3">
                                {timeline.map((event, index) => (
                                    <li key={`${event.type}-${event.at}-${index}`} className="flex gap-3 items-start">
                                        <div className={cn(
                                            'mt-1 w-2.5 h-2.5 rounded-full border',
                                            timelineDotClass(event.severity)
                                        )} />
                                        <div className={cn('flex-1 rounded-xl border px-3 py-2', timelineToneClass(event.severity))}>
                                            <div className="flex items-center justify-between gap-3">
                                                <p className="text-xs font-black uppercase tracking-wider">{event.title}</p>
                                                <span className="text-[10px] font-bold uppercase tracking-wider opacity-80">{event.stage}</span>
                                            </div>
                                            {event.detail && (
                                                <p className="mt-1 text-xs text-slate-100/90">{event.detail}</p>
                                            )}
                                            <p className="mt-1 text-[10px] font-semibold tracking-wider opacity-70">{formatTimelineDate(event.at)}</p>
                                        </div>
                                    </li>
                                ))}
                            </ol>
                        )}
                    </div>

                    <div className="mt-8 bg-white/5 p-6 rounded-2xl border border-white/10">
                        <div className="flex items-center justify-between gap-3 mb-4">
                            <h4 className="font-black text-white text-xs uppercase tracking-widest flex items-center gap-2">
                                <Server className="w-4 h-4 text-neo-emerald" />
                                {t('orders.command.title', {}, 'Post-Purchase Command Center')}
                            </h4>
                            <button
                                type="button"
                                onClick={refreshCommandCenter}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-300 hover:text-white"
                            >
                                <RefreshCw className={cn('w-3.5 h-3.5', commandLoading && 'animate-spin')} />
                                {t('orders.command.refresh', {}, 'Refresh')}
                            </button>
                        </div>

                        {commandLoading && (
                            <div className="flex items-center gap-2 text-slate-300 text-sm">
                                <Loader2 className="w-4 h-4 animate-spin text-neo-emerald" />
                                {t('orders.command.loading', {}, 'Loading command center...')}
                            </div>
                        )}

                        {!commandLoading && commandError && (
                            <div className="rounded-xl border border-neo-rose/35 bg-neo-rose/10 px-4 py-3 text-sm text-neo-rose flex items-center gap-2">
                                <AlertTriangle className="w-4 h-4" />
                                {commandError}
                            </div>
                        )}

                        {!commandLoading && !commandError && (
                            <div className="space-y-4">
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                    <div className="rounded-xl border border-white/10 bg-zinc-950/50 p-3">
                                        <p className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">{t('orders.command.stats.refunds', {}, 'Refund Requests')}</p>
                                        <p className="text-lg font-black text-white">{commandCenter?.refunds?.length || 0}</p>
                                    </div>
                                    <div className="rounded-xl border border-white/10 bg-zinc-950/50 p-3">
                                        <p className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">{t('orders.command.stats.replacements', {}, 'Replacements')}</p>
                                        <p className="text-lg font-black text-white">{commandCenter?.replacements?.length || 0}</p>
                                    </div>
                                    <div className="rounded-xl border border-white/10 bg-zinc-950/50 p-3">
                                        <p className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">{t('orders.command.stats.support', {}, 'Support Messages')}</p>
                                        <p className="text-lg font-black text-white">{commandCenter?.supportChats?.length || 0}</p>
                                    </div>
                                    <div className="rounded-xl border border-white/10 bg-zinc-950/50 p-3">
                                        <p className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">{t('orders.command.stats.warranty', {}, 'Warranty Claims')}</p>
                                        <p className="text-lg font-black text-white">{commandCenter?.warrantyClaims?.length || 0}</p>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="rounded-xl border border-white/10 bg-zinc-950/40 p-4">
                                        <p className="text-xs font-black uppercase tracking-[0.14em] text-amber-300 flex items-center gap-1.5 mb-2">
                                            <XCircle className="w-3.5 h-3.5" />
                                            {t('orders.command.cancel.title', {}, 'Cancel Order')}
                                        </p>
                                        <input
                                            type="text"
                                            placeholder={t('orders.command.cancel.placeholder', {}, 'Cancellation reason')}
                                            value={commandInput.cancelReason}
                                            onChange={(e) => setCommandInput((prev) => ({ ...prev, cancelReason: e.target.value }))}
                                            className="w-full rounded-lg border border-white/15 bg-zinc-950/60 px-3 py-2 text-xs text-white outline-none focus:border-amber-300"
                                        />
                                        <button
                                            type="button"
                                            disabled={commandSubmitting === 'cancel' || orderMeta.orderStatus === 'cancelled' || orderMeta.isDelivered}
                                            onClick={() => submitCommand('cancel')}
                                            className="mt-2 w-full rounded-lg border border-amber-300/35 bg-amber-500/10 px-3 py-2 text-xs font-black uppercase tracking-wider text-amber-200 disabled:opacity-60"
                                        >
                                            {orderMeta.orderStatus === 'cancelled'
                                                ? t('orders.command.cancel.already', {}, 'Already Cancelled')
                                                : commandSubmitting === 'cancel'
                                                    ? t('orders.command.cancel.submitting', {}, 'Cancelling...')
                                                    : t('orders.command.cancel.submit', {}, 'Cancel Order')}
                                        </button>
                                    </div>

                                    <div className="rounded-xl border border-white/10 bg-zinc-950/40 p-4">
                                        <p className="text-xs font-black uppercase tracking-[0.14em] text-neo-cyan flex items-center gap-1.5 mb-2">
                                            <Wallet className="w-3.5 h-3.5" />
                                            {t('orders.command.refund.title', {}, 'Refund')}
                                        </p>
                                        <input
                                            type="text"
                                            placeholder={t('orders.command.refund.placeholder', {}, 'Reason')}
                                            value={commandInput.refundReason}
                                            onChange={(e) => setCommandInput((prev) => ({ ...prev, refundReason: e.target.value }))}
                                            className="w-full rounded-lg border border-white/15 bg-zinc-950/60 px-3 py-2 text-xs text-white outline-none focus:border-neo-cyan"
                                        />
                                        <input
                                            type="number"
                                            placeholder={t('orders.command.refund.amountPlaceholder', {}, 'Amount (optional)')}
                                            value={commandInput.refundAmount}
                                            onChange={(e) => setCommandInput((prev) => ({ ...prev, refundAmount: e.target.value }))}
                                            className="mt-2 w-full rounded-lg border border-white/15 bg-zinc-950/60 px-3 py-2 text-xs text-white outline-none focus:border-neo-cyan"
                                        />
                                        <button
                                            type="button"
                                            disabled={commandSubmitting === 'refund' || orderMeta.orderStatus === 'cancelled'}
                                            onClick={() => submitCommand('refund')}
                                            className="mt-2 w-full rounded-lg border border-neo-cyan/35 bg-neo-cyan/15 px-3 py-2 text-xs font-black uppercase tracking-wider text-neo-cyan disabled:opacity-60"
                                        >
                                            {commandSubmitting === 'refund' ? t('orders.command.refund.submitting', {}, 'Submitting...') : t('orders.command.refund.submit', {}, 'Request Refund')}
                                        </button>
                                    </div>

                                    <div className="rounded-xl border border-white/10 bg-zinc-950/40 p-4">
                                        <p className="text-xs font-black uppercase tracking-[0.14em] text-amber-200 flex items-center gap-1.5 mb-2">
                                            <RefreshCw className="w-3.5 h-3.5" />
                                            {t('orders.command.replace.title', {}, 'Replacement')}
                                        </p>
                                        <input
                                            type="text"
                                            placeholder={t('orders.command.replace.placeholder', {}, 'Replacement reason')}
                                            value={commandInput.replaceReason}
                                            onChange={(e) => setCommandInput((prev) => ({ ...prev, replaceReason: e.target.value }))}
                                            className="w-full rounded-lg border border-white/15 bg-zinc-950/60 px-3 py-2 text-xs text-white outline-none focus:border-amber-300"
                                        />
                                        <button
                                            type="button"
                                            disabled={commandSubmitting === 'replace' || orderMeta.orderStatus === 'cancelled'}
                                            onClick={() => submitCommand('replace')}
                                            className="mt-2 w-full rounded-lg border border-amber-300/35 bg-amber-500/10 px-3 py-2 text-xs font-black uppercase tracking-wider text-amber-200 disabled:opacity-60"
                                        >
                                            {commandSubmitting === 'replace' ? t('orders.command.replace.submitting', {}, 'Submitting...') : t('orders.command.replace.submit', {}, 'Request Replacement')}
                                        </button>
                                    </div>

                                    <div className="rounded-xl border border-white/10 bg-zinc-950/40 p-4">
                                        <p className="text-xs font-black uppercase tracking-[0.14em] text-neo-emerald flex items-center gap-1.5 mb-2">
                                            <MessageSquare className="w-3.5 h-3.5" />
                                            {t('orders.command.support.title', {}, 'Support Chat')}
                                        </p>
                                        <textarea
                                            placeholder={t('orders.command.support.placeholder', {}, 'Ask support team')}
                                            value={commandInput.supportMessage}
                                            onChange={(e) => setCommandInput((prev) => ({ ...prev, supportMessage: e.target.value }))}
                                            rows={3}
                                            className="w-full rounded-lg border border-white/15 bg-zinc-950/60 px-3 py-2 text-xs text-white outline-none focus:border-neo-emerald resize-none"
                                        />
                                        <button
                                            type="button"
                                            disabled={commandSubmitting === 'support'}
                                            onClick={() => submitCommand('support')}
                                            className="mt-2 w-full rounded-lg border border-neo-emerald/35 bg-neo-emerald/15 px-3 py-2 text-xs font-black uppercase tracking-wider text-neo-emerald disabled:opacity-60"
                                        >
                                            {commandSubmitting === 'support' ? t('orders.command.support.sending', {}, 'Sending...') : t('orders.command.support.submit', {}, 'Send Message')}
                                        </button>
                                    </div>

                                    <div className="rounded-xl border border-white/10 bg-zinc-950/40 p-4">
                                        <p className="text-xs font-black uppercase tracking-[0.14em] text-fuchsia-200 flex items-center gap-1.5 mb-2">
                                            <ShieldAlert className="w-3.5 h-3.5" />
                                            {t('orders.command.warranty.title', {}, 'Warranty Claim')}
                                        </p>
                                        <textarea
                                            placeholder={t('orders.command.warranty.placeholder', {}, 'Describe warranty issue')}
                                            value={commandInput.warrantyIssue}
                                            onChange={(e) => setCommandInput((prev) => ({ ...prev, warrantyIssue: e.target.value }))}
                                            rows={3}
                                            className="w-full rounded-lg border border-white/15 bg-zinc-950/60 px-3 py-2 text-xs text-white outline-none focus:border-fuchsia-300 resize-none"
                                        />
                                        <button
                                            type="button"
                                            disabled={commandSubmitting === 'warranty'}
                                            onClick={() => submitCommand('warranty')}
                                            className="mt-2 w-full rounded-lg border border-fuchsia-300/35 bg-fuchsia-500/10 px-3 py-2 text-xs font-black uppercase tracking-wider text-fuchsia-200 disabled:opacity-60"
                                        >
                                            {commandSubmitting === 'warranty' ? t('orders.command.warranty.submitting', {}, 'Submitting...') : t('orders.command.warranty.submit', {}, 'Open Claim')}
                                        </button>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="rounded-xl border border-white/10 bg-zinc-950/40 p-4">
                                        <p className="text-xs font-black uppercase tracking-[0.14em] text-neo-cyan mb-3">{t('orders.command.refund.operations', {}, 'Refund Operations')}</p>
                                        {(commandCenter?.refunds || []).length === 0 ? (
                                            <p className="text-xs text-slate-400">{t('orders.command.refund.empty', {}, 'No refund operations yet.')}</p>
                                        ) : (
                                            <div className="space-y-2 max-h-56 overflow-auto pr-1">
                                                {[...(commandCenter?.refunds || [])].reverse().map((entry) => (
                                                    <div key={entry.requestId} className="rounded-lg border border-white/10 bg-zinc-950/60 p-2.5">
                                                        <div className="flex items-center justify-between gap-2">
                                                            <span className="text-[10px] font-black uppercase tracking-wider text-slate-300">#{entry.requestId?.slice(-8)}</span>
                                                            <span className={cn(
                                                                'text-[10px] px-2 py-0.5 rounded border font-black uppercase tracking-wider',
                                                                entry.status === 'processed'
                                                                    ? 'border-emerald-300/40 text-emerald-200 bg-emerald-500/10'
                                                                    : entry.status === 'rejected'
                                                                        ? 'border-rose-300/40 text-rose-200 bg-rose-500/10'
                                                                    : 'border-amber-300/40 text-amber-200 bg-amber-500/10'
                                                            )}>
                                                                {getCommandStatusLabel(entry.status, t)}
                                                            </span>
                                                        </div>
                                                        <p className="mt-1 text-xs text-white">{entry.message || entry.reason || t('orders.command.refund.requestFallback', {}, 'Refund request')}</p>
                                                        <p className="text-[11px] text-slate-400">{t('orders.amount', {}, 'Amount')}: {formatPrice(entry.amount || 0)}</p>
                                                        {entry.refundId && (
                                                            <p className="text-[10px] text-neo-cyan">{t('orders.refundId', {}, 'Refund ID')}: {entry.refundId}</p>
                                                        )}
                                                        <p className="text-[10px] text-slate-500">
                                                            {formatTimelineDate(entry.processedAt || entry.createdAt)}
                                                        </p>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>

                                    <div className="rounded-xl border border-white/10 bg-zinc-950/40 p-4">
                                        <p className="text-xs font-black uppercase tracking-[0.14em] text-amber-200 mb-3">{t('orders.command.replace.operations', {}, 'Replacement Operations')}</p>
                                        {(commandCenter?.replacements || []).length === 0 ? (
                                            <p className="text-xs text-slate-400">{t('orders.command.replace.empty', {}, 'No replacements yet.')}</p>
                                        ) : (
                                            <div className="space-y-2 max-h-56 overflow-auto pr-1">
                                                {[...(commandCenter?.replacements || [])].reverse().map((entry) => (
                                                    <div key={entry.requestId} className="rounded-lg border border-white/10 bg-zinc-950/60 p-2.5">
                                                        <div className="flex items-center justify-between gap-2">
                                                            <span className="text-[10px] font-black uppercase tracking-wider text-slate-300">#{entry.requestId?.slice(-8)}</span>
                                                            <span className={cn(
                                                                'text-[10px] px-2 py-0.5 rounded border font-black uppercase tracking-wider',
                                                                entry.status === 'shipped'
                                                                    ? 'border-emerald-300/40 text-emerald-200 bg-emerald-500/10'
                                                                    : entry.status === 'rejected'
                                                                        ? 'border-rose-300/40 text-rose-200 bg-rose-500/10'
                                                                    : 'border-amber-300/40 text-amber-200 bg-amber-500/10'
                                                            )}>
                                                                {getCommandStatusLabel(entry.status, t)}
                                                            </span>
                                                        </div>
                                                        <p className="mt-1 text-xs text-white">{entry.itemTitle || t('orders.itemFallback', {}, 'Item')} {entry.message ? `- ${entry.message}` : ''}</p>
                                                        <p className="text-[11px] text-slate-400">{t('orders.qty', {}, 'Qty')}: {entry.quantity || 1}</p>
                                                        {entry.trackingId && (
                                                            <p className="text-[10px] text-neo-emerald">{t('orders.tracking', {}, 'Tracking')}: {entry.trackingId}</p>
                                                        )}
                                                        <p className="text-[10px] text-slate-500">
                                                            {formatTimelineDate(entry.processedAt || entry.createdAt)}
                                                        </p>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default Orders;

