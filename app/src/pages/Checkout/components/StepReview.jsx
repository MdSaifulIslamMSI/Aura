import { CheckCircle2, ClipboardCheck, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';

const StepReview = ({
    isActive,
    completed,
    contact,
    shippingAddress,
    deliveryOption,
    deliverySlot,
    paymentMethod,
    acceptedTerms,
    reviewError,
    isPlacingOrder,
    onSetActive,
    onAcceptedTermsChange,
    onBack,
    onPlaceOrder,
}) => {
    return (
        <section
            className={cn(
                'bg-white/5 backdrop-blur-xl rounded-3xl border shadow-glass overflow-hidden transition-all duration-300',
                isActive ? 'border-neo-fuchsia/50 shadow-[0_0_30px_rgba(217,70,239,0.12)]' : 'border-white/10'
            )}
        >
            <button
                type="button"
                onClick={onSetActive}
                className="w-full p-6 bg-zinc-950/50 border-b border-white/5 flex items-center justify-between text-left"
            >
                <h3 className={cn('font-black uppercase tracking-widest text-sm md:text-base flex items-center gap-3', isActive ? 'text-neo-fuchsia' : 'text-white')}>
                    <ClipboardCheck className="w-5 h-5" />
                    4. Review & Place Order
                </h3>
                {completed ? <CheckCircle2 className="w-5 h-5 text-neo-cyan" /> : null}
            </button>

            {isActive ? (
                <div className="p-6 md:p-8 space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="bg-zinc-950/50 border border-white/10 rounded-2xl p-4">
                            <p className="text-xs uppercase tracking-widest font-bold text-slate-400 mb-2">Contact</p>
                            <p className="text-white font-semibold">{contact.name || '-'}</p>
                            <p className="text-slate-300 text-sm">{contact.phone || '-'}</p>
                            <p className="text-slate-500 text-xs">{contact.email || ''}</p>
                        </div>
                        <div className="bg-zinc-950/50 border border-white/10 rounded-2xl p-4">
                            <p className="text-xs uppercase tracking-widest font-bold text-slate-400 mb-2">Address</p>
                            <p className="text-white font-semibold">{shippingAddress.address || '-'}</p>
                            <p className="text-slate-300 text-sm">{shippingAddress.city} - {shippingAddress.postalCode}</p>
                            <p className="text-slate-500 text-xs">{shippingAddress.country}</p>
                        </div>
                        <div className="bg-zinc-950/50 border border-white/10 rounded-2xl p-4">
                            <p className="text-xs uppercase tracking-widest font-bold text-slate-400 mb-2">Delivery</p>
                            <p className="text-white font-semibold capitalize">{deliveryOption}</p>
                            <p className="text-slate-300 text-sm">{deliverySlot.date || 'No date selected'}</p>
                            <p className="text-slate-500 text-xs">{deliverySlot.window || 'No window selected'}</p>
                        </div>
                        <div className="bg-zinc-950/50 border border-white/10 rounded-2xl p-4">
                            <p className="text-xs uppercase tracking-widest font-bold text-slate-400 mb-2">Payment</p>
                            <p className="text-white font-semibold">{paymentMethod}</p>
                            <p className="text-slate-500 text-xs">Server-side quote will be used for final charging.</p>
                        </div>
                    </div>

                    <label className="flex items-start gap-3 text-sm text-slate-300">
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
                        <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 text-rose-200 text-sm">
                            {reviewError}
                        </div>
                    ) : null}

                    <div className="flex items-center gap-2 text-xs uppercase tracking-widest font-bold text-slate-500">
                        <ShieldCheck className="w-4 h-4 text-neo-cyan" />
                        Secure Checkout Session
                    </div>

                    <div className="flex flex-col-reverse sm:flex-row gap-3 pt-2">
                        <button
                            type="button"
                            onClick={onBack}
                            className="w-full sm:w-auto px-5 py-3 rounded-xl border border-white/15 text-sm font-bold uppercase tracking-wider text-slate-200"
                        >
                            Back
                        </button>
                        <button
                            type="button"
                            onClick={onPlaceOrder}
                            disabled={isPlacingOrder}
                            className="w-full sm:w-auto sm:ml-auto btn-primary px-8 py-3 text-sm uppercase tracking-widest font-black disabled:opacity-60"
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
