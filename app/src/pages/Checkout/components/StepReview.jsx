import { CheckCircle2, ClipboardCheck, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatPrice } from '@/utils/format';

const StepReview = ({
    isActive,
    completed,
    contact,
    shippingAddress,
    deliveryOption,
    deliverySlot,
    paymentMethod,
    quote,
    acceptedTerms,
    reviewError,
    isPlacingOrder,
    onSetActive,
    onAcceptedTermsChange,
    onBack,
    onPlaceOrder,
}) => {
    const chargeAmount = Number(quote?.presentmentTotalPrice ?? quote?.totalPrice ?? 0);
    const chargeCurrency = quote?.presentmentCurrency || quote?.settlementCurrency || 'INR';
    const settlementAmount = Number(quote?.settlementAmount ?? quote?.totalPrice ?? 0);
    const settlementCurrency = quote?.settlementCurrency || 'INR';
    const marketSummary = quote?.market?.countryCode
        ? `${quote.market.countryName || quote.market.countryCode} | ${chargeCurrency}`
        : '';

    return (
        <section
            className={cn(
                'checkout-premium-card transition-all duration-300',
                isActive && 'checkout-premium-card-active'
            )}
        >
            <button
                type="button"
                onClick={onSetActive}
                className="checkout-premium-header w-full"
            >
                <h3 className={cn('flex items-center gap-3 text-sm font-black uppercase tracking-[0.22em] md:text-base', isActive ? 'text-neo-fuchsia' : 'text-white')}>
                    <ClipboardCheck className="w-5 h-5" />
                    4. Review and Place Order
                </h3>
                {completed ? <CheckCircle2 className="w-5 h-5 text-neo-cyan" /> : null}
            </button>

            {isActive ? (
                <div className="space-y-6 p-6 md:p-8">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <div className="checkout-premium-surface">
                            <p className="text-xs font-black uppercase tracking-[0.22em] text-slate-400">Contact</p>
                            <p className="mt-3 text-base font-semibold text-white">{contact.name || '-'}</p>
                            <p className="text-sm text-slate-300">{contact.phone || '-'}</p>
                            <p className="text-xs text-slate-500">{contact.email || ''}</p>
                        </div>
                        <div className="checkout-premium-surface">
                            <p className="text-xs font-black uppercase tracking-[0.22em] text-slate-400">Address</p>
                            <p className="mt-3 text-base font-semibold text-white">{shippingAddress.address || '-'}</p>
                            <p className="text-sm text-slate-300">{shippingAddress.city} - {shippingAddress.postalCode}</p>
                            <p className="text-xs text-slate-500">{shippingAddress.country}</p>
                        </div>
                        <div className="checkout-premium-surface">
                            <p className="text-xs font-black uppercase tracking-[0.22em] text-slate-400">Delivery</p>
                            <p className="mt-3 text-base font-semibold capitalize text-white">{deliveryOption}</p>
                            <p className="text-sm text-slate-300">{deliverySlot.date || 'No date selected'}</p>
                            <p className="text-xs text-slate-500">{deliverySlot.window || 'No window selected'}</p>
                        </div>
                        <div className="checkout-premium-surface">
                            <p className="text-xs font-black uppercase tracking-[0.22em] text-slate-400">Payment</p>
                            <p className="mt-3 text-base font-semibold text-white">{paymentMethod}</p>
                            <p className="mt-2 text-sm text-slate-300">{formatPrice(chargeAmount, chargeCurrency)}</p>
                            <p className="text-xs text-slate-500">
                                {chargeCurrency !== settlementCurrency
                                    ? `Settles against ${formatPrice(settlementAmount, settlementCurrency)} after provider conversion.`
                                    : 'Server-side quote remains the source of truth for final charging.'}
                            </p>
                            {marketSummary ? (
                                <p className="mt-1 text-xs text-slate-500">{marketSummary}</p>
                            ) : null}
                        </div>
                    </div>

                    <label className="checkout-premium-note">
                        <input
                            type="checkbox"
                            checked={acceptedTerms}
                            onChange={(event) => onAcceptedTermsChange(event.target.checked)}
                            className="mt-1 accent-neo-cyan"
                        />
                        <span>
                            I confirm this order information and agree to the checkout policy and payment terms.
                        </span>
                    </label>

                    {reviewError ? (
                        <div className="checkout-premium-alert border-rose-500/30 bg-rose-500/10 text-rose-200">
                            {reviewError}
                        </div>
                    ) : null}

                    <div className="checkout-premium-note text-xs font-black uppercase tracking-[0.2em]">
                        <ShieldCheck className="w-4 h-4 text-neo-cyan" />
                        Secure Checkout Session
                    </div>

                    <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row">
                        <button
                            type="button"
                            onClick={onBack}
                            className="checkout-premium-secondary w-full text-xs font-black uppercase tracking-[0.2em] sm:w-auto"
                        >
                            Back
                        </button>
                        <button
                            type="button"
                            onClick={onPlaceOrder}
                            disabled={isPlacingOrder}
                            className="checkout-premium-primary w-full px-8 py-3 text-sm font-black uppercase tracking-[0.24em] disabled:opacity-60 sm:ml-auto sm:w-auto"
                        >
                            {isPlacingOrder ? 'Placing Order...' : 'Place Order'}
                        </button>
                    </div>
                </div>
            ) : null}
        </section>
    );
};

export default StepReview;
