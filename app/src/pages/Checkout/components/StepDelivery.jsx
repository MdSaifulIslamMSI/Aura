import { CalendarClock, CheckCircle2, Truck } from 'lucide-react';
import { cn } from '@/lib/utils';
import PremiumSelect from '@/components/ui/premium-select';
import { useMarket } from '@/context/MarketContext';

const SLOT_WINDOWS = ['09:00-12:00', '12:00-15:00', '15:00-18:00', '18:00-21:00'];

const StepDelivery = ({
    isActive,
    completed,
    deliveryOption,
    deliverySlot,
    optimizedSlots = [],
    shippingOptions = [],
    deliveryError,
    onSetActive,
    onDeliveryOptionChange,
    onDeliverySlotChange,
    onBack,
    onContinue,
}) => {
    const { t } = useMarket();
    const availableShippingOptions = shippingOptions.length > 0
        ? shippingOptions
        : [
            { id: 'standard', label: 'Standard', etaLabel: '3-5 business days' },
            { id: 'express', label: 'Express', etaLabel: '1-2 business days' },
        ];

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
                    {t('checkout.stepDelivery.title', {}, '2. Delivery Slot')}
                </h3>
                {completed ? <CheckCircle2 className="w-5 h-5 text-neo-cyan" /> : null}
            </button>

            {isActive ? (
                <div className="space-y-6 p-6 md:p-8">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        {availableShippingOptions.map((option) => (
                            <button
                                key={option.id}
                                type="button"
                                onClick={() => onDeliveryOptionChange(option.id)}
                                className={cn(
                                    'checkout-premium-option',
                                    deliveryOption === option.id && 'checkout-premium-option-active'
                                )}
                            >
                                <p className="text-sm font-black uppercase tracking-[0.22em] text-white">{option.label || option.id}</p>
                                <p className="mt-2 text-sm text-slate-400">{option.etaLabel || t('checkout.liveShippingEta', {}, 'Live shipping ETA')}</p>
                            </button>
                        ))}
                    </div>

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <label className="space-y-2">
                            <span className="text-xs font-black uppercase tracking-[0.22em] text-slate-400">{t('checkout.deliveryDate', {}, 'Delivery Date')}</span>
                            <input
                                type="date"
                                value={deliverySlot.date}
                                min={new Date().toISOString().slice(0, 10)}
                                onChange={(event) => onDeliverySlotChange('date', event.target.value)}
                                className="checkout-premium-input"
                            />
                        </label>
                        <label className="space-y-2">
                            <span className="text-xs font-black uppercase tracking-[0.22em] text-slate-400">{t('checkout.deliveryWindow', {}, 'Delivery Window')}</span>
                            <PremiumSelect
                                value={deliverySlot.window}
                                onChange={(event) => onDeliverySlotChange('window', event.target.value)}
                                className="checkout-premium-input"
                            >
                                <option value="">{t('checkout.selectSlot', {}, 'Select slot')}</option>
                                {SLOT_WINDOWS.map((windowLabel) => {
                                    const opt = optimizedSlots.find(s => s.window === windowLabel);
                                    const extra = opt ? ` (${opt.label})` : '';
                                    return (
                                        <option key={windowLabel} value={windowLabel}>
                                            {windowLabel}{extra}
                                        </option>
                                    );
                                })}
                            </PremiumSelect>
                        </label>
                    </div>

                    {deliverySlot.window && optimizedSlots.find(s => s.window === deliverySlot.window) && (
                        <div className="bg-neo-cyan/5 border border-neo-cyan/20 rounded-2xl p-4 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="h-10 w-10 rounded-xl bg-neo-cyan/10 flex items-center justify-center">
                                    <Truck className="w-5 h-5 text-neo-cyan" />
                                </div>
                                <div>
                                    <p className="text-xs font-black uppercase tracking-[0.22em] text-neo-cyan">{t('checkout.deliveryInsight', {}, 'Aura Density Insight')}</p>
                                    <p className="text-xs text-slate-400 mt-0.5">
                                        {t('checkout.selected', {}, 'Selected')}: <span className="text-white font-bold">{optimizedSlots.find(s => s.window === deliverySlot.window)?.label}</span>
                                    </p>
                                </div>
                            </div>
                            <div className="text-right">
                                <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">{t('checkout.almightySolver', {}, 'Almighty Solver')}</p>
                                <p className="text-sm font-black text-white">{t('checkout.optimized', {}, 'NP-Hard Optimized')}</p>
                            </div>
                        </div>
                    )}

                    {deliveryError ? (
                        <div className="checkout-premium-alert border-rose-500/30 bg-rose-500/10 text-rose-200">
                            {deliveryError}
                        </div>
                    ) : null}

                    <div className="checkout-premium-note text-xs">
                        <CalendarClock className="w-4 h-4" />
                        {t('checkout.slotsLiveNote', {}, 'Slots are subject to live availability during order placement.')}
                    </div>

                    <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row">
                        <button
                            type="button"
                            onClick={onBack}
                            className="checkout-premium-secondary w-full text-xs font-black uppercase tracking-[0.2em] sm:w-auto"
                        >
                            {t('checkout.back', {}, 'Back')}
                        </button>
                        <button
                            type="button"
                            onClick={onContinue}
                            className="checkout-premium-primary w-full px-8 py-3 text-sm font-black uppercase tracking-[0.24em] sm:ml-auto sm:w-auto"
                        >
                            {t('checkout.continue', {}, 'Continue')}
                        </button>
                    </div>
                </div>
            ) : null}
        </section>
    );
};

export default StepDelivery;
