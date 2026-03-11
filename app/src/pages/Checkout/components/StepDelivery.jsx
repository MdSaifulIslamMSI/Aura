import { CalendarClock, CheckCircle2, Truck } from 'lucide-react';
import { cn } from '@/lib/utils';
import PremiumSelect from '@/components/ui/premium-select';

const SLOT_WINDOWS = ['09:00-12:00', '12:00-15:00', '15:00-18:00', '18:00-21:00'];

const StepDelivery = ({
    isActive,
    completed,
    deliveryOption,
    deliverySlot,
    deliveryError,
    onSetActive,
    onDeliveryOptionChange,
    onDeliverySlotChange,
    onBack,
    onContinue,
}) => {
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
                    <Truck className="w-5 h-5" />
                    2. Delivery Slot
                </h3>
                {completed ? <CheckCircle2 className="w-5 h-5 text-neo-cyan" /> : null}
            </button>

            {isActive ? (
                <div className="space-y-6 p-6 md:p-8">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <button
                            type="button"
                            onClick={() => onDeliveryOptionChange('standard')}
                            className={cn(
                                'checkout-premium-option',
                                deliveryOption === 'standard' && 'checkout-premium-option-active'
                            )}
                        >
                            <p className="text-sm font-black uppercase tracking-[0.22em] text-white">Standard</p>
                            <p className="mt-2 text-sm text-slate-400">3-5 business days | lower delivery fee</p>
                        </button>
                        <button
                            type="button"
                            onClick={() => onDeliveryOptionChange('express')}
                            className={cn(
                                'checkout-premium-option',
                                deliveryOption === 'express' && 'checkout-premium-option-active'
                            )}
                        >
                            <p className="text-sm font-black uppercase tracking-[0.22em] text-white">Express</p>
                            <p className="mt-2 text-sm text-slate-400">1-2 business days | priority handling</p>
                        </button>
                    </div>

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <label className="space-y-2">
                            <span className="text-xs font-black uppercase tracking-[0.22em] text-slate-400">Delivery Date</span>
                            <input
                                type="date"
                                value={deliverySlot.date}
                                min={new Date().toISOString().slice(0, 10)}
                                onChange={(event) => onDeliverySlotChange('date', event.target.value)}
                                className="checkout-premium-input"
                            />
                        </label>
                        <label className="space-y-2">
                            <span className="text-xs font-black uppercase tracking-[0.22em] text-slate-400">Delivery Window</span>
                            <PremiumSelect
                                value={deliverySlot.window}
                                onChange={(event) => onDeliverySlotChange('window', event.target.value)}
                                className="checkout-premium-input"
                            >
                                <option value="">Select slot</option>
                                {SLOT_WINDOWS.map((windowLabel) => (
                                    <option key={windowLabel} value={windowLabel}>{windowLabel}</option>
                                ))}
                            </PremiumSelect>
                        </label>
                    </div>

                    {deliveryError ? (
                        <div className="checkout-premium-alert border-rose-500/30 bg-rose-500/10 text-rose-200">
                            {deliveryError}
                        </div>
                    ) : null}

                    <div className="checkout-premium-note text-xs">
                        <CalendarClock className="w-4 h-4" />
                        Slots are subject to live availability during order placement.
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

export default StepDelivery;
