import { Box, Info, Loader2, RefreshCcw, TicketPercent, Zap } from 'lucide-react';
import { formatPrice } from '@/utils/format';
import { cn } from '@/lib/utils';

const OrderSummary = ({
    items,
    quote,
    fallbackTotals,
    isQuoting,
    quoteError,
    isQuoteStale,
    couponCode,
    onCouponCodeChange,
    onApplyCoupon,
    onRemoveCoupon,
    onRecalculate,
}) => {
    const itemsPrice = quote?.itemsPrice ?? fallbackTotals.itemsPrice;
    const shippingPrice = quote?.shippingPrice ?? 0;
    const couponDiscount = quote?.couponDiscount ?? 0;
    const paymentAdjustment = quote?.paymentAdjustment ?? 0;
    const taxPrice = quote?.taxPrice ?? 0;
    const totalPrice = quote?.totalPrice ?? fallbackTotals.totalPrice;
    const appliedCoupon = quote?.appliedCoupon;
    const logistics = quote?.logisticsInsights;

    return (
        <aside className="h-fit lg:sticky lg:top-32">
            <div className="checkout-premium-summary overflow-hidden">
                <div className="border-b border-white/10 bg-white/5 p-6">
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <p className="text-xs font-black uppercase tracking-[0.22em] text-slate-400">Order Summary</p>
                            <h3 className="mt-2 text-2xl font-black tracking-tight text-white">Final price intelligence</h3>
                        </div>
                        {isQuoting ? <Loader2 className="h-4 w-4 animate-spin text-neo-cyan" /> : null}
                    </div>
                </div>

                <div className="space-y-5 p-5 sm:p-6">
                    <div className="space-y-3 max-h-64 overflow-auto pr-1">
                        {items.map((item) => (
                            <div key={item.id} className="checkout-premium-option flex items-center gap-3">
                                <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/5 p-2">
                                    <img src={item.image} alt={item.title} className="h-full w-full object-contain" />
                                </div>
                                <div className="min-w-0 flex-1">
                                    <p className="line-clamp-1 text-sm font-semibold text-white">{item.title}</p>
                                    <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-400">Qty {item.quantity}</p>
                                </div>
                                <p className="text-sm font-bold text-slate-200">{formatPrice(item.price * item.quantity)}</p>
                            </div>
                        ))}
                    </div>

                    {logistics && (
                        <div className="checkout-premium-surface bg-neo-cyan/5 border-neo-cyan/20 space-y-3">
                            <div className="flex items-center justify-between">
                                <p className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.22em] text-neo-cyan">
                                    <Box className="h-4 w-4" />
                                    Aura Logistics Insight
                                </p>
                                <span className="bg-neo-cyan/20 text-neo-cyan px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider">
                                    NP-Hard Optimized
                                </span>
                            </div>
                            
                            <div className="grid grid-cols-2 gap-2 mt-2">
                                <div className="bg-white/5 p-2 rounded-xl border border-white/5">
                                    <p className="text-[10px] text-slate-400 uppercase tracking-wider">Consolidation</p>
                                    <p className="text-sm font-bold text-white">{logistics.consolidationEfficiency || 'Direct'}</p>
                                </div>
                                <div className="bg-white/5 p-2 rounded-xl border border-white/5">
                                    <p className="text-[10px] text-slate-400 uppercase tracking-wider">Eco-Impact</p>
                                    <p className="text-[11px] font-bold text-neo-cyan truncate">{logistics.ecoBadge || 'Standard'}</p>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-2">
                                <div className="bg-white/5 p-2 rounded-xl border border-white/5">
                                    <p className="text-[10px] text-slate-400 uppercase tracking-wider">Efficiency</p>
                                    <p className="text-sm font-bold text-white">{logistics.efficiency}</p>
                                </div>
                                <div className="bg-white/5 p-2 rounded-xl border border-white/5">
                                    <p className="text-[10px] text-slate-400 uppercase tracking-wider">Net Savings</p>
                                    <p className="text-sm font-bold text-neo-cyan">-{formatPrice(logistics.savings)}</p>
                                </div>
                            </div>
                            
                            <div className="space-y-1.5 pt-1">
                                {logistics.hub && (
                                    <div className="flex items-center gap-2 text-[11px] text-neo-cyan font-bold">
                                        <div className="w-1 h-1 rounded-full bg-neo-cyan" />
                                        <span>Merging at {logistics.hub}</span>
                                    </div>
                                )}
                                {logistics.containers.map((c, i) => (
                                    <div key={i} className="flex items-center justify-between text-[11px] text-slate-300">
                                        <div className="flex items-center gap-2">
                                            <div className="w-1 h-1 rounded-full bg-neo-cyan/50" />
                                            <span>{c.type} ({c.itemCount} items)</span>
                                        </div>
                                        <span className="text-slate-500 font-mono">Density: {c.efficiency}</span>
                                    </div>
                                ))}
                            </div>
                            
                            <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-400 italic">
                                <Info className="h-3 w-3" />
                                Strategy: {logistics.strategy}
                            </div>
                        </div>
                    )}

                    <div className="checkout-premium-surface space-y-3">
                        <div className="flex justify-between text-sm text-slate-300">
                            <span>Items</span>
                            <span>{formatPrice(itemsPrice)}</span>
                        </div>
                        <div className="flex justify-between text-sm text-slate-300">
                            <span>Shipping</span>
                            <div className="text-right">
                                <span>{shippingPrice === 0 ? 'FREE' : formatPrice(shippingPrice)}</span>
                                {logistics && <p className="text-[10px] text-neo-cyan font-bold tracking-tight mt-0.5">ALGO-CONSOLIDATED</p>}
                            </div>
                        </div>
                        <div className="flex justify-between text-sm text-slate-300">
                            <span>Payment Adjustment</span>
                            <span className={cn(paymentAdjustment <= 0 ? 'text-neo-cyan' : 'text-amber-300')}>
                                {paymentAdjustment === 0 ? formatPrice(0) : `${paymentAdjustment > 0 ? '+' : '-'} ${formatPrice(Math.abs(paymentAdjustment))}`}
                            </span>
                        </div>
                        <div className="flex justify-between text-sm text-slate-300">
                            <span>Coupon Discount</span>
                            <span className="text-neo-cyan">- {formatPrice(couponDiscount)}</span>
                        </div>
                        <div className="flex justify-between text-sm text-slate-300">
                            <span>Tax</span>
                            <span>{formatPrice(taxPrice)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3 border-t border-white/10 pt-4">
                            <span className="text-xs font-black uppercase tracking-[0.22em] text-slate-400">Total</span>
                            <span className="text-2xl font-black tracking-tight text-white">{formatPrice(totalPrice)}</span>
                        </div>
                    </div>

                    <div className="checkout-premium-surface space-y-3">
                        <p className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.22em] text-slate-400">
                            <TicketPercent className="h-4 w-4 text-neo-cyan" />
                            Coupon
                        </p>
                        <div className="flex flex-col gap-2 sm:flex-row">
                            <input
                                value={couponCode}
                                onChange={(event) => onCouponCodeChange(event.target.value.toUpperCase())}
                                placeholder="Enter code"
                                className="checkout-premium-input flex-1"
                            />
                            <button
                                type="button"
                                onClick={onApplyCoupon}
                                className="checkout-premium-secondary w-full text-xs font-black uppercase tracking-[0.2em] sm:w-auto"
                            >
                                Apply
                            </button>
                        </div>
                        {appliedCoupon ? (
                            <div className="checkout-premium-alert flex items-center justify-between gap-2 border-neo-cyan/20 bg-neo-cyan/10 text-neo-cyan">
                                <span>{appliedCoupon.code} applied</span>
                                <button type="button" onClick={onRemoveCoupon} className="underline">
                                    Remove
                                </button>
                            </div>
                        ) : null}
                    </div>

                    <button
                        type="button"
                        onClick={onRecalculate}
                        className="checkout-premium-secondary flex w-full items-center justify-center gap-2 text-xs font-black uppercase tracking-[0.2em]"
                    >
                        <RefreshCcw className="h-3.5 w-3.5" />
                        Recalculate Quote
                    </button>

                    {isQuoteStale ? (
                        <div className="checkout-premium-alert border-amber-500/30 bg-amber-500/10 text-amber-200">
                            Pricing may be stale. Recalculate before placing the order.
                        </div>
                    ) : null}

                    {quoteError ? (
                        <div className="checkout-premium-alert border-rose-500/30 bg-rose-500/10 text-rose-200">
                            {quoteError}
                        </div>
                    ) : null}

                    <div className="checkout-premium-note text-xs">
                        <Zap className="mt-0.5 h-4 w-4 text-neo-cyan" />
                        <span>All totals are backend-validated during order placement.</span>
                    </div>
                </div>
            </div>
        </aside>
    );
};

export default OrderSummary;
