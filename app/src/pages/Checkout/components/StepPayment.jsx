import { CheckCircle2, CreditCard, Smartphone, Wallet, AlertCircle, Loader2, ShieldCheck } from 'lucide-react';
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
    const chunks = [type, brand, last4].filter(Boolean);
    return chunks.join(' ');
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
                'bg-white/5 backdrop-blur-xl rounded-3xl border shadow-glass overflow-hidden transition-all duration-300',
                isActive ? 'border-neo-cyan/50 shadow-[0_0_30px_rgba(6,182,212,0.12)]' : 'border-white/10'
            )}
        >
            <button
                type="button"
                onClick={onSetActive}
                className="w-full p-6 bg-zinc-950/50 border-b border-white/5 flex items-center justify-between text-left"
            >
                <h3 className={cn('font-black uppercase tracking-widest text-sm md:text-base flex items-center gap-3', isActive ? 'text-neo-cyan' : 'text-white')}>
                    <CreditCard className="w-5 h-5" />
                    3. Payment
                </h3>
                {completed ? <CheckCircle2 className="w-5 h-5 text-neo-cyan" /> : null}
            </button>

            {isActive ? (
                <div className="p-6 md:p-8 space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {PAYMENT_OPTIONS.map((option) => {
                            const Icon = option.icon;
                            const selected = paymentMethod === option.id;
                            return (
                                <button
                                    key={option.id}
                                    type="button"
                                    onClick={() => onPaymentMethodChange(option.id)}
                                    className={cn(
                                        'p-4 rounded-xl border text-left transition-all',
                                        selected ? 'border-neo-cyan bg-neo-cyan/10' : 'border-white/10 hover:border-white/30'
                                    )}
                                >
                                    <div className="flex items-center gap-3 mb-2">
                                        <Icon className="w-5 h-5 text-neo-cyan" />
                                        <span className="text-white font-black text-sm uppercase tracking-wider">{option.title}</span>
                                    </div>
                                    <p className="text-slate-400 text-sm">{option.description}</p>
                                </button>
                            );
                        })}
                    </div>

                    {isDigital && savedMethods.length > 0 ? (
                        <div className="bg-zinc-950/50 border border-white/10 rounded-2xl p-5 space-y-4">
                            <p className="text-xs uppercase tracking-widest font-bold text-slate-400">Saved Methods</p>
                            <div className="space-y-3">
                                {savedMethods.map((method) => (
                                    <button
                                        key={method._id}
                                        type="button"
                                        onClick={() => onSelectSavedMethod?.(method._id)}
                                        className={cn(
                                            'w-full text-left p-3 rounded-xl border transition-colors',
                                            selectedSavedMethodId === method._id
                                                ? 'border-neo-cyan bg-neo-cyan/10'
                                                : 'border-white/10 hover:border-white/30'
                                        )}
                                    >
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="text-sm font-semibold text-white">{humanizeSavedMethod(method) || 'Saved method'}</span>
                                            {method.isDefault ? (
                                                <span className="text-[10px] uppercase tracking-wider px-2 py-1 rounded-full border border-emerald-400/30 bg-emerald-500/10 text-emerald-300">
                                                    Default
                                                </span>
                                            ) : null}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    ) : null}

                    {isDigital ? (
                        <div className="bg-zinc-950/50 border border-white/10 rounded-2xl p-5 space-y-4">
                            <p className="text-xs uppercase tracking-widest font-bold text-slate-400">
                                {useSimulatedFlow ? 'Simulated Digital Payment' : 'Razorpay Secure Payment'}
                            </p>

                            {challengeRequired ? (
                                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-200 px-4 py-3 text-sm">
                                    <div className="flex items-center gap-2 font-semibold">
                                        <ShieldCheck className="w-4 h-4" />
                                        Additional verification required
                                    </div>
                                    <p className="text-xs mt-1 text-amber-100/90">Run payment OTP challenge before confirming payment.</p>
                                    <div className="flex flex-col sm:flex-row gap-2 mt-3">
                                        <button
                                            type="button"
                                            onClick={onSendChallengeOtp}
                                            disabled={isChallengeLoading}
                                            className="px-4 py-2 rounded-lg border border-white/20 text-xs uppercase tracking-wider font-bold"
                                        >
                                            Send OTP
                                        </button>
                                        <button
                                            type="button"
                                            onClick={onMarkChallengeComplete}
                                            disabled={isChallengeLoading}
                                            className="px-4 py-2 rounded-lg border border-white/20 text-xs uppercase tracking-wider font-bold"
                                        >
                                            Mark Verified
                                        </button>
                                    </div>
                                </div>
                            ) : null}

                            {challengeRequired && challengeVerified ? (
                                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 px-4 py-3 text-sm">
                                    Challenge verification complete.
                                </div>
                            ) : null}

                            <button
                                type="button"
                                onClick={onSimulatePayment}
                                disabled={isSimulatingPayment || (challengeRequired && !challengeVerified)}
                                className="w-full sm:w-auto btn-primary px-5 py-2 text-xs uppercase tracking-widest font-black disabled:opacity-60"
                            >
                                {isSimulatingPayment ? (
                                    <span className="flex items-center gap-2">
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        Processing...
                                    </span>
                                ) : actionLabel}
                            </button>

                            {paymentSimulation.status && paymentSimulation.status !== 'idle' ? (
                                <div className={cn('rounded-xl border px-4 py-3 text-sm', STATUS_STYLES[paymentSimulation.status])}>
                                    <p className="font-semibold uppercase tracking-wider text-xs mb-1">
                                        Status: {paymentSimulation.status}
                                    </p>
                                    <p>{paymentSimulation.message}</p>
                                    {paymentSimulation.referenceId ? (
                                        <p className="text-xs mt-2 opacity-90">Ref: {paymentSimulation.referenceId}</p>
                                    ) : null}
                                </div>
                            ) : null}

                            {(paymentSimulation.status === 'failure' || paymentSimulation.status === 'pending') ? (
                                <button
                                    type="button"
                                    onClick={onFallbackToCod}
                                    className="w-full sm:w-auto px-4 py-2 rounded-xl border border-white/20 text-xs uppercase tracking-wider font-bold text-slate-200 hover:border-neo-cyan/40"
                                >
                                    Fallback to COD
                                </button>
                            ) : null}
                        </div>
                    ) : null}

                    {paymentError ? (
                        <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 text-rose-200 text-sm flex items-start gap-2">
                            <AlertCircle className="w-4 h-4 mt-0.5" />
                            <span>{paymentError}</span>
                        </div>
                    ) : null}

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
                            onClick={onContinue}
                            className="w-full sm:w-auto sm:ml-auto btn-primary px-8 py-3 text-sm uppercase tracking-widest font-black"
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

