import { useState, useEffect, useContext } from 'react';
import { Link } from 'react-router-dom';
import { Bell, BellRing, Trash2, TrendingDown, Target, ArrowDown, Plus } from 'lucide-react';
import { priceAlertApi } from '@/services/api';
import { AuthContext } from '@/context/AuthContext';
import { useMarket } from '@/context/MarketContext';
import { BROWSE_BASE_CURRENCY } from '@/config/marketConfig';

export default function PriceAlerts() {
    const { currentUser } = useContext(AuthContext);
    const { t, formatPrice } = useMarket();
    const [alerts, setAlerts] = useState([]);
    const [loading, setLoading] = useState(true);

    const formatMoney = (value) => formatPrice(Number(value || 0), undefined, undefined, {
        baseCurrency: BROWSE_BASE_CURRENCY,
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    });

    useEffect(() => {
        (async () => {
            try {
                const data = await priceAlertApi.getMyAlerts();
                setAlerts(data.alerts || []);
            } catch (err) {
                console.error(err);
            } finally {
                setLoading(false);
            }
        })();
    }, [currentUser]);

    const handleDelete = async (id) => {
        try {
            await priceAlertApi.delete(id);
            setAlerts((prev) => prev.filter((alert) => alert._id !== id));
        } catch (err) {
            alert(err.message || t('priceAlerts.error.delete', {}, 'Failed to delete alert.'));
        }
    };

    const activeAlerts = alerts.filter((alert) => alert.isActive && !alert.triggered);
    const triggeredAlerts = alerts.filter((alert) => alert.triggered);

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 via-purple-50 to-pink-50">
            <div className="relative overflow-hidden bg-gradient-to-r from-purple-600 via-fuchsia-600 to-pink-500">
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_30%_50%,rgba(255,255,255,0.1),transparent)]" />
                <div className="relative z-10 mx-auto max-w-6xl px-4 py-10 sm:py-14">
                    <div className="mb-2 flex flex-col gap-3 sm:flex-row sm:items-center">
                        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/20">
                            <BellRing className="h-7 w-7 text-white" />
                        </div>
                        <div>
                            <h1 className="text-3xl font-black text-white sm:text-4xl">{t('priceAlerts.hero.title', {}, 'Price Alerts')}</h1>
                            <p className="text-sm text-white/70">{t('priceAlerts.hero.body', {}, 'Get notified when prices drop to your target')}</p>
                        </div>
                    </div>

                    <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
                        <div className="rounded-xl bg-white/10 p-4 text-center">
                            <p className="text-3xl font-black text-white">{activeAlerts.length}</p>
                            <p className="text-xs font-bold text-white/60">{t('priceAlerts.stats.active', {}, 'Active Alerts')}</p>
                        </div>
                        <div className="rounded-xl bg-white/10 p-4 text-center">
                            <p className="text-3xl font-black text-green-300">{triggeredAlerts.length}</p>
                            <p className="text-xs font-bold text-white/60">{t('priceAlerts.stats.dropped', {}, 'Price Dropped!')}</p>
                        </div>
                        <div className="rounded-xl bg-white/10 p-4 text-center">
                            <p className="text-3xl font-black text-white">{alerts.length}</p>
                            <p className="text-xs font-bold text-white/60">{t('priceAlerts.stats.total', {}, 'Total Alerts')}</p>
                        </div>
                    </div>
                </div>
            </div>

            <div className="mx-auto max-w-6xl px-4 py-8">
                <div className="mb-8 flex flex-col justify-between gap-4 rounded-2xl border bg-white p-6 shadow-sm sm:flex-row sm:items-center">
                    <div>
                        <h2 className="text-xl font-bold text-gray-900">{t('priceAlerts.cta.title', {}, 'Set a new alert')}</h2>
                        <p className="mt-1 text-sm text-gray-500">{t('priceAlerts.cta.body', {}, 'Browse any product and click "Set Price Alert" to track price drops')}</p>
                    </div>
                    <Link to="/products" className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 to-fuchsia-600 px-6 py-3 font-bold text-white shadow-lg transition-all hover:from-purple-700 hover:to-fuchsia-700">
                        <Plus className="h-4 w-4" /> {t('priceAlerts.cta.browse', {}, 'Browse Products')}
                    </Link>
                </div>

                {triggeredAlerts.length > 0 ? (
                    <div className="mb-8">
                        <h3 className="mb-4 flex items-center gap-2 text-lg font-bold text-green-700">
                            <TrendingDown className="h-5 w-5" /> {t('priceAlerts.triggered.title', {}, 'Price Dropped!')}
                        </h3>
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                            {triggeredAlerts.map((alert) => (
                                <div key={alert._id} className="relative rounded-2xl border-2 border-green-200 bg-green-50 p-5">
                                    <span className="absolute right-3 top-3 rounded-full bg-green-500 px-2 py-0.5 text-[10px] font-bold text-white animate-pulse">
                                        {t('priceAlerts.triggered.badge', {}, 'DROPPED!')}
                                    </span>
                                    <div className="flex flex-col gap-4 sm:flex-row">
                                        <div className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-xl bg-white">
                                            {alert.productImage ? <img src={alert.productImage} alt="" className="h-full w-full object-cover" /> : null}
                                        </div>
                                        <div className="flex-1">
                                            <Link to={`/product/${alert.productId}`} className="line-clamp-1 text-sm font-bold text-gray-900 hover:text-green-700">
                                                {alert.productTitle}
                                            </Link>
                                            <div className="mt-1 flex flex-wrap items-center gap-2">
                                                <span className="text-xs text-gray-400 line-through">{formatMoney(alert.currentPrice)}</span>
                                                <ArrowDown className="h-3 w-3 text-green-600" />
                                                <span className="font-black text-green-700">{formatMoney(alert.latestPrice || alert.targetPrice)}</span>
                                            </div>
                                            <p className="mt-1 text-[10px] font-bold text-green-600">
                                                {t('priceAlerts.triggered.target', { price: formatMoney(alert.targetPrice) }, `Your target: ${formatMoney(alert.targetPrice)}`)}
                                            </p>
                                            <div className="mt-2 flex gap-2">
                                                <Link to={`/product/${alert.productId}`} className="rounded-lg bg-green-600 px-3 py-1 text-xs font-bold text-white">
                                                    {t('priceAlerts.triggered.buyNow', {}, 'Buy Now')}
                                                </Link>
                                                <button onClick={() => handleDelete(alert._id)} className="rounded-lg border border-gray-200 px-3 py-1 text-xs text-gray-400 hover:bg-gray-50">
                                                    {t('priceAlerts.triggered.dismiss', {}, 'Dismiss')}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                ) : null}

                <h3 className="mb-4 flex items-center gap-2 text-lg font-bold text-gray-900">
                    <Bell className="h-5 w-5 text-purple-500" /> {t('priceAlerts.active.title', {}, 'Active Alerts')}
                </h3>

                {loading ? (
                    <div className="space-y-4">
                        {[1, 2, 3].map((value) => (
                            <div key={value} className="flex flex-col gap-4 rounded-xl bg-white p-5 animate-pulse sm:flex-row">
                                <div className="h-16 w-16 rounded-xl bg-gray-200" />
                                <div className="flex-1 space-y-2">
                                    <div className="h-5 w-1/2 rounded bg-gray-200" />
                                    <div className="h-4 w-1/3 rounded bg-gray-200" />
                                </div>
                            </div>
                        ))}
                    </div>
                ) : activeAlerts.length === 0 ? (
                    <div className="rounded-2xl border bg-white p-12 text-center shadow-sm">
                        <Bell className="mx-auto mb-3 h-16 w-16 text-gray-200" />
                        <h3 className="mb-1 text-lg font-bold text-gray-900">{t('priceAlerts.empty.title', {}, 'No active alerts')}</h3>
                        <p className="text-sm text-gray-400">{t('priceAlerts.empty.body', {}, 'Set alerts on products to get notified when prices drop')}</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {activeAlerts.map((alert) => (
                            <div key={alert._id} className="flex flex-col gap-4 rounded-xl border bg-white p-4 shadow-sm sm:flex-row sm:items-center">
                                <div className="h-14 w-14 flex-shrink-0 overflow-hidden rounded-xl bg-gray-100">
                                    {alert.productImage ? <img src={alert.productImage} alt="" className="h-full w-full object-cover" /> : null}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <Link to={`/product/${alert.productId}`} className="line-clamp-1 text-sm font-bold text-gray-900 hover:text-purple-600">
                                        {alert.productTitle}
                                    </Link>
                                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs sm:gap-3">
                                        <span className="text-gray-500">{t('priceAlerts.active.current', { price: formatMoney(alert.currentPrice) }, `Current: ${formatMoney(alert.currentPrice)}`)}</span>
                                        <span className="flex items-center gap-1 font-bold text-purple-600">
                                            <Target className="h-3 w-3" /> {t('priceAlerts.active.target', { price: formatMoney(alert.targetPrice) }, `Target: ${formatMoney(alert.targetPrice)}`)}
                                        </span>
                                    </div>
                                </div>
                                <button
                                    onClick={() => handleDelete(alert._id)}
                                    className="rounded-lg p-2 text-red-400 transition-colors hover:bg-red-50 hover:text-red-600"
                                    aria-label={t('priceAlerts.active.deleteAria', {}, 'Delete alert')}
                                >
                                    <Trash2 className="h-4 w-4" />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
