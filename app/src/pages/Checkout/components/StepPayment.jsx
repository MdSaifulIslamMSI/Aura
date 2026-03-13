import { AlertCircle, CheckCircle2, CreditCard, Loader2, ShieldCheck, Smartphone, Wallet } from 'lucide-react';
import { cn } from '@/lib/utils';

const PAYMENT_OPTIONS = [
    { id: 'COD', title: 'Cash on Delivery', description: 'Pay when your order arrives', icon: Wallet },
    { id: 'UPI', title: 'UPI', description: 'Fast payment via UPI apps', icon: Smartphone },
    { id: 'CARD', title: 'Card', description: 'Debit / credit card checkout', icon: CreditCard },
    { id: 'WALLET', title: 'Wallet', description: 'Wallet balance or linked wallet', icon: Wallet },
];

const STATUS_STYLES = {
    success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
    pending: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
    failure: 'border-rose-500/30 bg-rose-500/10 text-rose-200',
};

const humanizeSavedMethod = (method) => {
    const type = String(method.type || '').toUpperCase();
    const brand = method.brand || '';
    const last4 = method.last4 ? `**** ${method.last4}` : '';
    return [type, brand, last4].filter(Boolean).join(' ');
};

const StepPayment = ({
    isActive,
    completed,
    paymentMethod,
    paymentSimulation,
    isSimulatingPayment,
    paymentError,
    onSetActive,
    onPaymentMethodChange,
    onSimulatePayment,
    onFallbackToCod,
    onBack,
    onContinue,
    savedMethods = [],
    selectedSavedMethodId = '',
    onSelectSavedMethod,
    challengeRequired = false,
    challengeVerified = false,
    onSendChallengeOtp,
    onMarkChallengeComplete,
    isChallengeLoading = false,
    useSimulatedFlow = false,
}) => {
    const isDigital = paymentMethod !== 'COD';
    const actionLabel = useSimulatedFlow ? 'Run Payment Simulation' : 'Pay Securely';

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
                <h3 className={cn('flex items-center gap-3 text-sm font-black uppercase tracking-[0.22em] md:text-base', isActive ? 'text-neo-cyan' : 'text-white')}>
                    <CreditCard className="w-5 h-5" />
                    3. Payment
                </h3>
                {completed ? <CheckCircle2 className="w-5 h-5 text-neo-cyan" /> : null}
            </button>

            {isActive ? (
                <div className="space-y-6 p-6 md:p-8">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        {PAYMENT_OPTIONS.map((option) => {
                            const Icon = option.icon;
                            const selected = paymentMethod === option.id;

                            return (
                                <button
                                    key={option.id}
                                    type="button"
                                    onClick={() => onPaymentMethodChange(option.id)}
                                    className={cn(
                                        'checkout-premium-option',
                                        selected && 'checkout-premium-option-active'
                                    )}
                                >
                                    <div className="mb-2 flex items-center gap-3">
                                        <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-neo-cyan">
                                            <Icon className="w-5 h-5" />
                                        </div>
                                        <span className="text-sm font-black uppercase tracking-[0.2em] text-white">{option.title}</span>
                                    </div>
                                    <p className="text-sm text-slate-400">{option.description}</p>
                                </button>
                            );
                        })}
                    </div>

                    {isDigital && savedMethods.length > 0 ? (
                        <div className="checkout-premium-surface space-y-4">
                            <p className="text-xs font-black uppercase tracking-[0.22em] text-slate-400">Saved Methods</p>
                            <div className="space-y-3">
                                {savedMethods.map((method) => (
                                    <button
                                        key={method._id}
                                        type="button"
                                        onClick={() => onSelectSavedMethod?.(method._id)}
                                        className={cn(
                                            'checkout-premium-option w-full',
                                            selectedSavedMethodId === method._id && 'checkout-premium-option-active'
                                        )}
                                    >
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="text-sm font-semibold text-white">{humanizeSavedMethod(method) || 'Saved method'}</span>
                                            {method.isDefault ? (
                                                <span className="premium-chip-muted text-[10px] font-black uppercase tracking-[0.2em] text-emerald-200">Default</span>
                                            ) : null}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    ) : null}

                    {isDigital ? (
                        <div className="checkout-premium-surface space-y-4">
                            <p className="text-xs font-black uppercase tracking-[0.22em] text-slate-400">
                                {useSimulatedFlow ? 'Simulated Digital Payment' : 'Razorpay Secure Payment'}
                            </p>

                            {challengeRequired ? (
                                <div className="checkout-premium-alert border-amber-500/30 bg-amber-500/10 text-amber-200">
                                    <div className="flex items-center gap-2 font-semibold">
                                        <ShieldCheck className="w-4 h-4" />
                                        Additional verification required
                                    </div>
                                    <p className="mt-1 text-xs text-amber-100/90">Run payment OTP challenge before confirming payment.</p>
                                    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                                        <button
                                            type="button"
                                            onClick={onSendChallengeOtp}
                                            disabled={isChallengeLoading}
                                            className="checkout-premium-secondary text-xs font-black uppercase tracking-[0.2em]"
                                        >
                                            Send OTP
                                        </button>
                                        <button
                                            type="button"
                                            onClick={onMarkChallengeComplete}
                                            disabled={isChallengeLoading}
                                            className="checkout-premium-secondary text-xs font-black uppercase tracking-[0.2em]"
                                        >
                                            Mark Verified
                                        </button>
                                    </div>
                                </div>
                            ) : null}

                            {challengeRequired && challengeVerified ? (
                                <div className="checkout-premium-alert border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
                                    Challenge verification complete.
                                </div>
                            ) : null}

                            {isDigital ? (
                                <div className="flex items-center gap-2 px-1 py-1">
                                    <div className="flex h-2 w-2 animate-pulse rounded-full bg-neo-cyan shadow-[0_0_8px_var(--neo-cyan)]" />
                                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-neo-cyan/80">
                                        Multi-Commodity Routing Active
                                    </span>
                                </div>
                            ) : null}

                            <button
                                type="button"
                                onClick={onSimulatePayment}
                                disabled={isSimulatingPayment || (challengeRequired && !challengeVerified)}
                                className="checkout-premium-primary w-full px-5 py-3 text-xs font-black uppercase tracking-[0.24em] disabled:opacity-60 sm:w-auto"
                            >
                                {isSimulatingPayment ? (
                                    <span className="flex items-center gap-2">
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        Processing...
                                    </span>
                                ) : actionLabel}
                            </button>

                            {paymentSimulation.status && paymentSimulation.status !== 'idle' ? (
                                <div className={cn('checkout-premium-alert', STATUS_STYLES[paymentSimulation.status])}>
                                    <p className="mb-1 text-xs font-semibold uppercase tracking-[0.2em]">
                                        Status: {paymentSimulation.status}
                                    </p>
                                    <p>{paymentSimulation.message}</p>
                                    {paymentSimulation.referenceId ? (
                                        <p className="mt-2 text-xs opacity-90">Ref: {paymentSimulation.referenceId}</p>
                                    ) : null}
                                </div>
                            ) : null}

                            {(paymentSimulation.status === 'failure' || paymentSimulation.status === 'pending') ? (
                                <button
                                    type="button"
                                    onClick={onFallbackToCod}
                                    className="checkout-premium-secondary w-full text-xs font-black uppercase tracking-[0.2em] sm:w-auto"
                                >
                                    Fallback to COD
                                </button>
                            ) : null}
                        </div>
                    ) : null}

                    {paymentError ? (
                        <div className="checkout-premium-alert flex items-start gap-2 border-rose-500/30 bg-rose-500/10 text-rose-200">
                            <AlertCircle className="mt-0.5 w-4 h-4" />
                            <span>{paymentError}</span>
                        </div>
                    ) : null}

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
                            onClick={onContinue}
                            className="checkout-premium-primary w-full px-8 py-3 text-sm font-black uppercase tracking-[0.24em] sm:ml-auto sm:w-auto"
                        >
                            Continue
                        </button>
                    </div>
                </div>
            ) : null}
        </section>
    );
};

export default StepPayment;
