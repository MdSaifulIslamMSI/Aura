import { CalendarClock, CheckCircle2, Truck } from 'lucide-react';
import { cn } from '@/lib/utils';

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
                    <Truck className="w-5 h-5" />
                    2. Delivery Slot
                </h3>
                {completed ? <CheckCircle2 className="w-5 h-5 text-neo-cyan" /> : null}
            </button>

            {isActive ? (
                <div className="p-6 md:p-8 space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <button
                            type="button"
                            onClick={() => onDeliveryOptionChange('standard')}
                            className={cn(
                                'p-5 rounded-2xl border text-left transition-all',
                                deliveryOption === 'standard'
                                    ? 'border-neo-cyan bg-neo-cyan/10'
                                    : 'border-white/10 hover:border-white/30'
                            )}
                        >
                            <p className="text-white font-black uppercase tracking-widest text-sm">Standard</p>
                            <p className="text-slate-400 text-sm mt-2">3-5 business days · lower delivery fee</p>
                        </button>
                        <button
                            type="button"
                            onClick={() => onDeliveryOptionChange('express')}
                            className={cn(
                                'p-5 rounded-2xl border text-left transition-all',
                                deliveryOption === 'express'
                                    ? 'border-neo-fuchsia bg-neo-fuchsia/10'
                                    : 'border-white/10 hover:border-white/30'
                            )}
                        >
                            <p className="text-white font-black uppercase tracking-widest text-sm">Express</p>
                            <p className="text-slate-400 text-sm mt-2">1-2 business days · priority handling</p>
                        </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <label className="space-y-2">
                            <span className="text-xs uppercase tracking-widest font-bold text-slate-400">Delivery Date</span>
                            <input
                                type="date"
                                value={deliverySlot.date}
                                min={new Date().toISOString().slice(0, 10)}
                                onChange={(event) => onDeliverySlotChange('date', event.target.value)}
                                className="w-full bg-zinc-950/80 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-neo-cyan"
                            />
                        </label>
                        <label className="space-y-2">
                            <span className="text-xs uppercase tracking-widest font-bold text-slate-400">Delivery Window</span>
                            <select
                                value={deliverySlot.window}
                                onChange={(event) => onDeliverySlotChange('window', event.target.value)}
                                className="w-full bg-zinc-950/80 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-neo-cyan"
                            >
                                <option value="">Select slot</option>
                                {SLOT_WINDOWS.map((windowLabel) => (
                                    <option key={windowLabel} value={windowLabel}>{windowLabel}</option>
                                ))}
                            </select>
                        </label>
                    </div>

                    {deliveryError ? (
                        <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 text-rose-200 text-sm">
                            {deliveryError}
                        </div>
                    ) : null}

                    <div className="text-xs text-slate-500 flex items-center gap-2">
                        <CalendarClock className="w-4 h-4" />
                        Slots are subject to real-time availability during order placement.
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

export default StepDelivery;
