import { useIntl } from 'react-intl';
import { cn } from '@/lib/utils';
import { useMarket } from '@/context/MarketContext';
import { criticalMessages } from '@/i18n/messages/criticalMessages';
import { useStableIcuMessages } from '@/i18n/useStableIcuMessages';
import { getShipmentStage, ORDER_FLOW_STAGES, STAGE_LABEL_FALLBACKS } from './orderProgress';

// Progress tracker: placed → packed → shipped → out for delivery → delivered.
// Stage is derived from the order status plus any shipment checkpoints the
// lifecycle engine has recorded; legacy orders without shipments still land
// on placed/processing correctly.
const OrderProgressStepper = ({ orderMeta, t: tProp, intl }) => {
    const { t: legacyT } = useMarket();
    const contextT = useStableIcuMessages(legacyT);
    const t = tProp ?? contextT;
    const contextIntl = useIntl();
    const activeIntl = intl ?? contextIntl;
    const stage = getShipmentStage(orderMeta);
    if (stage === 'cancelled') {
        return (
            <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 p-4">
                <p className="text-xs font-black uppercase tracking-[0.24em] text-amber-200">
                    {t('orders.status.cancelled', {}, 'Cancelled')}
                </p>
            </div>
        );
    }

    const activeIndex = ORDER_FLOW_STAGES.indexOf(stage);
    const shipments = Array.isArray(orderMeta.shipments) ? orderMeta.shipments : [];
    const latestShipment = shipments.length > 0 ? shipments[shipments.length - 1] : null;
    const latestCheckpoint = latestShipment && Array.isArray(latestShipment.checkpoints)
        ? latestShipment.checkpoints[latestShipment.checkpoints.length - 1]
        : null;

    return (
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
            <div className="flex items-center justify-between">
                {ORDER_FLOW_STAGES.map((stageKey, index) => {
                    const done = index < activeIndex;
                    const active = index === activeIndex;
                    return (
                        <div key={stageKey} className="flex flex-1 items-center last:flex-none">
                            <div className="flex flex-col items-center gap-2">
                                <div
                                    className={cn(
                                        'h-3 w-3 rounded-full border transition-all duration-300',
                                        done && 'border-neo-cyan bg-neo-cyan shadow-[0_0_8px_rgba(6,182,212,0.7)]',
                                        active && 'h-4 w-4 border-neo-fuchsia bg-neo-fuchsia shadow-[0_0_12px_rgba(217,70,239,0.8)]',
                                        !done && !active && 'border-white/20 bg-zinc-950'
                                    )}
                                    aria-hidden="true"
                                />
                                <span
                                    className={cn(
                                        'whitespace-nowrap text-[9px] font-black uppercase tracking-wider sm:text-[10px]',
                                        active ? 'text-neo-fuchsia' : done ? 'text-neo-cyan' : 'text-slate-500'
                                    )}
                                >
                                    {stageKey === 'placed'
                                        ? activeIntl.formatMessage(criticalMessages.orderConfirmed)
                                        : t(`orders.status.${stageKey}`, {}, STAGE_LABEL_FALLBACKS[stageKey])}
                                </span>
                            </div>
                            {index < ORDER_FLOW_STAGES.length - 1 && (
                                <div
                                    className={cn(
                                        'mx-1 h-[2px] flex-1 rounded sm:mx-2',
                                        index < activeIndex ? 'bg-neo-cyan/70' : 'bg-white/10'
                                    )}
                                    aria-hidden="true"
                                />
                            )}
                        </div>
                    );
                })}
            </div>
            {latestCheckpoint && (
                <p className="mt-3 text-center text-[11px] font-medium text-slate-400">
                    {latestCheckpoint.message
                        || t('orders.progress.latest', {}, 'Latest update received')}
                    {latestShipment?.courier
                        ? ` · ${latestShipment.courier}`
                        : ''}
                    {latestShipment?.trackingId
                        ? ` · ${latestShipment.trackingId}`
                        : ''}
                </p>
            )}
        </div>
    );
};

export default OrderProgressStepper;
