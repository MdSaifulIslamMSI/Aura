import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useMarket } from '@/context/MarketContext';
import { useStableIcuMessages } from '@/i18n/useStableIcuMessages';
import { userApi } from '@/services/api';
import { cn } from '@/lib/utils';

export default function NotificationPreferencesPanel() {
    const { t: legacyT } = useMarket();
    const t = useStableIcuMessages(legacyT);
    const [preferences, setPreferences] = useState(null);
    const [loading, setLoading] = useState(true);
    const [savingKey, setSavingKey] = useState('');
    const [error, setError] = useState('');
    const [status, setStatus] = useState('');

    const loadPreferences = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            setPreferences(await userApi.getAccountPreferences());
        } catch (loadError) {
            setError(loadError.message || t(
                'profile.settings.notifications.loadError',
                {},
                'Notification preferences could not be loaded.'
            ));
        } finally {
            setLoading(false);
        }
    }, [t]);

    useEffect(() => {
        void loadPreferences();
    }, [loadPreferences]);

    const updateChannel = async (topic, channel, enabled) => {
        if (!preferences || (topic === 'security' && enabled === false)) return;
        const key = `${topic}.${channel}`;
        setSavingKey(key);
        setError('');
        setStatus('');
        try {
            const updated = await userApi.updateAccountPreferences({
                version: preferences.version,
                notifications: {
                    [topic]: {
                        [channel]: enabled,
                    },
                },
            });
            setPreferences(updated);
            setStatus(t(
                'profile.settings.notifications.saved',
                {},
                'Notification preference saved.'
            ));
        } catch (saveError) {
            setError(saveError.message || t(
                'profile.settings.notifications.saveError',
                {},
                'Notification preference could not be saved.'
            ));
        } finally {
            setSavingKey('');
        }
    };

    if (loading && !preferences) {
        return (
            <p role="status" className="text-sm text-slate-400">
                {t('profile.settings.notifications.loading', {}, 'Loading notification preferences...')}
            </p>
        );
    }

    if (!preferences) {
        return (
            <div role="alert" className="rounded-xl border border-rose-400/20 bg-rose-500/10 p-4">
                <p className="text-sm text-rose-100">{error}</p>
                <button
                    type="button"
                    onClick={loadPreferences}
                    className="mt-3 inline-flex items-center gap-2 rounded-lg border border-rose-300/30 px-3 py-2 text-sm font-bold text-rose-100"
                >
                    <RefreshCw className="h-4 w-4" />
                    {t('profile.settings.notifications.retry', {}, 'Retry')}
                </button>
            </div>
        );
    }

    const topics = [
        ['orderUpdates', t('profile.settings.notifications.orderUpdates.label', {}, 'Order updates'), t('profile.settings.notifications.orderUpdates.desc', {}, 'Order confirmation and status changes.')],
        ['deliveryUpdates', t('profile.settings.notifications.deliveryUpdates.label', {}, 'Delivery updates'), t('profile.settings.notifications.deliveryUpdates.desc', {}, 'Shipment progress and delivery actions.')],
        ['returnRefundUpdates', t('profile.settings.notifications.returnRefundUpdates.label', {}, 'Returns and refunds'), t('profile.settings.notifications.returnRefundUpdates.desc', {}, 'Return, exchange, replacement, and refund progress.')],
        ['marketplaceUpdates', t('profile.settings.notifications.marketplaceUpdates.label', {}, 'Marketplace'), t('profile.settings.notifications.marketplaceUpdates.desc', {}, 'Listings, offers, disputes, and selling activity.')],
        ['productAlerts', t('profile.settings.notifications.productAlerts.label', {}, 'Product alerts'), t('profile.settings.notifications.productAlerts.desc', {}, 'Saved-product price and availability changes.')],
        ['marketing', t('profile.settings.notifications.marketing.label', {}, 'Marketing'), t('profile.settings.notifications.marketing.desc', {}, 'Optional product discovery and promotional messages.')],
        ['security', t('profile.settings.notifications.security.label', {}, 'Security'), t('profile.settings.notifications.security.desc', {}, 'Required sign-in, factor, recovery, and account-safety notices.')],
    ];
    const channels = [
        ['email', t('profile.settings.notifications.channel.email', {}, 'email')],
        ['sms', t('profile.settings.notifications.channel.sms', {}, 'sms')],
        ['push', t('profile.settings.notifications.channel.push', {}, 'push')],
    ];

    return (
        <div className="space-y-3">
            <p className="text-sm text-slate-400">
                {t(
                    'profile.settings.notifications.consentNote',
                    {},
                    'Transactional messages support your purchases. Marketing choices are optional and consent changes are timestamped.'
                )}
            </p>
            {topics.map(([topic, label, description]) => {
                const mandatory = topic === 'security';
                const topicPreferences = preferences.notifications?.[topic] || {};
                return (
                    <div key={topic} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="max-w-xl">
                                <p className="text-sm font-bold text-white">
                                    {label}
                                    {mandatory ? (
                                        <span className="ml-2 text-xs font-semibold text-amber-200">
                                            {t('profile.settings.notifications.required', {}, 'Required')}
                                        </span>
                                    ) : null}
                                </p>
                                <p className="mt-1 text-xs text-slate-400">
                                    {description}
                                </p>
                            </div>
                            <div className="flex flex-wrap gap-2" aria-label={label}>
                                {channels.map(([channel, channelLabel]) => {
                                    const enabled = mandatory || Boolean(topicPreferences[channel]);
                                    const key = [topic, channel].join('.');
                                    return (
                                        <button
                                            key={channel}
                                            type="button"
                                            role="switch"
                                            aria-checked={enabled}
                                            disabled={mandatory || Boolean(savingKey)}
                                            onClick={() => updateChannel(topic, channel, !enabled)}
                                            className={cn(
                                                'min-h-11 rounded-xl border px-3 py-2 text-xs font-black uppercase tracking-wide',
                                                enabled
                                                    ? 'border-neo-cyan/30 bg-neo-cyan/10 text-neo-cyan'
                                                    : 'border-white/10 bg-white/5 text-slate-400',
                                                (mandatory || savingKey === key) && 'cursor-not-allowed opacity-70',
                                            )}
                                        >
                                            {channelLabel}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                );
            })}
            {error ? <p role="alert" className="text-sm font-semibold text-rose-200">{error}</p> : null}
            {status ? <p role="status" className="text-sm font-semibold text-emerald-200">{status}</p> : null}
        </div>
    );
}
