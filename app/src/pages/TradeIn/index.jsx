import { useState, useEffect, useContext, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, RefreshCw, Package, Trash2, Clock, CheckCircle, XCircle, ArrowLeftRight, Sparkles } from 'lucide-react';
import { tradeInApi } from '@/services/api';
import { AuthContext } from '@/context/AuthContext';
import { useDynamicTranslations } from '@/hooks/useDynamicTranslations';

const STATUS_STYLES = {
    pending: { bg: 'bg-amber-100', text: 'text-amber-700', icon: Clock },
    'under-review': { bg: 'bg-blue-100', text: 'text-blue-700', icon: RefreshCw },
    approved: { bg: 'bg-green-100', text: 'text-green-700', icon: CheckCircle },
    rejected: { bg: 'bg-red-100', text: 'text-red-700', icon: XCircle },
    completed: { bg: 'bg-purple-100', text: 'text-purple-700', icon: Sparkles },
};

const HOW_IT_WORKS = [
    { step: '1', label: 'Choose Product', desc: 'Pick the new product you want' },
    { step: '2', label: 'Select Trade-In', desc: 'Choose your item to trade in' },
    { step: '3', label: 'Get Estimate', desc: 'See instant trade-in value' },
    { step: '4', label: 'Save Big', desc: 'Pay only the difference!' },
];

export default function TradeIn() {
    const { currentUser } = useContext(AuthContext);
    const [tradeIns, setTradeIns] = useState([]);
    const [loading, setLoading] = useState(true);

    const tradeInDynamicTexts = useMemo(() => ([
        'Cancel this trade-in request?',
        'Trade-In',
        'Exchange your old items for discounts on new products',
        'Choose Product',
        'Pick the new product you want',
        'Select Trade-In',
        'Choose your item to trade in',
        'Get Estimate',
        'See instant trade-in value',
        'Save Big',
        'Pay only the difference!',
        'Ready to trade in?',
        'Browse products and look for the "Trade-In" button on any product page',
        'Browse Products',
        'My Trade-In Requests',
        'No trade-ins yet',
        'Visit any product page and click "Trade-In" to get started',
        'Your Item',
        'New Product',
        'Trade Value',
        'You Pay',
        'Reason',
        ...tradeIns.flatMap((entry) => [
            entry?.listing?.title,
            entry?.manualItem?.title,
            entry?.targetProduct?.title,
            entry?.rejectionReason,
            String(entry?.status || '').replace('-', ' '),
        ]),
    ]), [tradeIns]);
    const { translateText: translateTradeText } = useDynamicTranslations(tradeInDynamicTexts);
    const translatedTradeIns = useMemo(() => (
        tradeIns.map((entry) => ({
            ...entry,
            translatedItemTitle: translateTradeText(entry?.listing?.title || entry?.manualItem?.title || 'Your Item') || entry?.listing?.title || entry?.manualItem?.title || 'Your Item',
            translatedTargetTitle: translateTradeText(entry?.targetProduct?.title) || entry?.targetProduct?.title,
            translatedRejectionReason: translateTradeText(entry?.rejectionReason) || entry?.rejectionReason,
            translatedStatus: translateTradeText(String(entry?.status || '').replace('-', ' ')) || String(entry?.status || '').replace('-', ' '),
        }))
    ), [tradeIns, translateTradeText]);

    useEffect(() => {
        (async () => {
            try {
                const data = await tradeInApi.getMyTradeIns();
                setTradeIns(data.tradeIns || []);
            } catch (err) {
                console.error(err);
            } finally {
                setLoading(false);
            }
        })();
    }, [currentUser]);

    const handleCancel = async (id) => {
        if (!confirm(translateTradeText('Cancel this trade-in request?') || 'Cancel this trade-in request?')) return;
        try {
            await tradeInApi.cancel(id);
            setTradeIns((prev) => prev.filter((entry) => entry._id !== id));
        } catch (err) {
            alert(err.message);
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 via-orange-50 to-amber-50">
            <div className="relative overflow-hidden bg-gradient-to-r from-orange-500 via-amber-500 to-yellow-500">
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_70%_30%,rgba(255,255,255,0.15),transparent)]" />
                <div className="relative z-10 mx-auto max-w-6xl px-4 py-10 sm:py-14">
                    <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center">
                        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/20">
                            <ArrowLeftRight className="h-7 w-7 text-white" />
                        </div>
                        <div>
                            <h1 className="text-3xl font-black text-white sm:text-4xl">{translateTradeText('Trade-In') || 'Trade-In'}</h1>
                            <p className="text-sm text-white/70">{translateTradeText('Exchange your old items for discounts on new products') || 'Exchange your old items for discounts on new products'}</p>
                        </div>
                    </div>

                    <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        {HOW_IT_WORKS.map((step) => (
                            <div key={step.step} className="rounded-xl bg-white/10 p-4">
                                <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-sm font-black text-white">{step.step}</div>
                                <p className="text-sm font-bold text-white">{translateTradeText(step.label) || step.label}</p>
                                <p className="text-xs text-white/60">{translateTradeText(step.desc) || step.desc}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <div className="mx-auto max-w-6xl px-4 py-8">
                <div className="mb-8 flex flex-col gap-4 rounded-2xl border bg-white p-6 shadow-sm sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h2 className="text-xl font-bold text-gray-900">{translateTradeText('Ready to trade in?') || 'Ready to trade in?'}</h2>
                        <p className="mt-1 text-sm text-gray-500">{translateTradeText('Browse products and look for the "Trade-In" button on any product page') || 'Browse products and look for the "Trade-In" button on any product page'}</p>
                    </div>
                    <Link to="/products" className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 px-6 py-3 font-bold text-white shadow-lg transition-all hover:from-orange-600 hover:to-amber-600">
                        {translateTradeText('Browse Products') || 'Browse Products'}
                        <ArrowRight className="h-4 w-4" />
                    </Link>
                </div>

                <h3 className="mb-4 text-lg font-bold text-gray-900">{translateTradeText('My Trade-In Requests') || 'My Trade-In Requests'}</h3>

                {loading ? (
                    <div className="space-y-4">
                        {[1, 2].map((item) => (
                            <div key={item} className="animate-pulse rounded-xl bg-white p-5">
                                <div className="flex flex-col gap-4 sm:flex-row">
                                    <div className="h-20 w-20 rounded-xl bg-gray-200" />
                                    <div className="flex-1 space-y-2">
                                        <div className="h-5 w-1/2 rounded bg-gray-200" />
                                        <div className="h-4 w-1/3 rounded bg-gray-200" />
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : translatedTradeIns.length === 0 ? (
                    <div className="rounded-2xl border bg-white p-12 text-center shadow-sm">
                        <ArrowLeftRight className="mx-auto mb-3 h-16 w-16 text-gray-200" />
                        <h3 className="mb-1 text-lg font-bold text-gray-900">{translateTradeText('No trade-ins yet') || 'No trade-ins yet'}</h3>
                        <p className="text-sm text-gray-400">{translateTradeText('Visit any product page and click "Trade-In" to get started') || 'Visit any product page and click "Trade-In" to get started'}</p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {translatedTradeIns.map((entry) => {
                            const statusStyle = STATUS_STYLES[entry.status] || STATUS_STYLES.pending;
                            const StatusIcon = statusStyle.icon;
                            const itemImage = entry.listing?.images?.[0] || '';
                            const itemTitle = entry.translatedItemTitle || translateTradeText('Your Item') || 'Your Item';
                            const targetTitle = entry.translatedTargetTitle || entry.targetProduct?.title || '';

                            return (
                                <div key={entry._id} className="rounded-2xl border bg-white p-5 shadow-sm">
                                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                                        <div className="text-center">
                                            <div className="mx-auto h-16 w-16 overflow-hidden rounded-xl bg-gray-100">
                                                {itemImage ? (
                                                    <img src={itemImage} alt={itemTitle} className="h-full w-full object-cover" />
                                                ) : (
                                                    <div className="flex h-full w-full items-center justify-center text-gray-300">
                                                        <Package className="h-8 w-8" />
                                                    </div>
                                                )}
                                            </div>
                                            <p className="mt-1 text-[10px] font-bold text-gray-400">{translateTradeText('Your Item') || 'Your Item'}</p>
                                        </div>

                                        <ArrowRight className="h-5 w-5 flex-shrink-0 text-orange-400" />

                                        <div className="text-center">
                                            <div className="mx-auto h-16 w-16 overflow-hidden rounded-xl bg-gray-100">
                                                {entry.targetProduct?.image ? (
                                                    <img src={entry.targetProduct.image} alt={targetTitle} className="h-full w-full object-cover" />
                                                ) : (
                                                    <div className="flex h-full w-full items-center justify-center text-gray-300">
                                                        <Package className="h-8 w-8" />
                                                    </div>
                                                )}
                                            </div>
                                            <p className="mt-1 text-[10px] font-bold text-gray-400">{translateTradeText('New Product') || 'New Product'}</p>
                                        </div>

                                        <div className="min-w-0 flex-1 sm:ml-2">
                                            <p className="truncate text-sm font-bold text-gray-900">{itemTitle} {'->'} {targetTitle}</p>
                                            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs sm:gap-3">
                                                <span className="font-black text-orange-600">{translateTradeText('Trade Value') || 'Trade Value'}: Rs {entry.estimatedValue?.toLocaleString('en-IN')}</span>
                                                <span className="text-gray-400">|</span>
                                                <span className="font-bold text-green-600">{translateTradeText('You Pay') || 'You Pay'}: Rs {(entry.targetProduct?.price - entry.estimatedValue)?.toLocaleString('en-IN')}</span>
                                            </div>
                                            <div className="mt-2 flex items-center gap-2">
                                                <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${statusStyle.bg} ${statusStyle.text}`}>
                                                    <StatusIcon className="h-3 w-3" />
                                                    {entry.translatedStatus || entry.status.replace('-', ' ')}
                                                </span>
                                                <span className="text-[10px] text-gray-400">{new Date(entry.createdAt).toLocaleDateString('en-IN')}</span>
                                            </div>
                                        </div>

                                        {['pending', 'under-review'].includes(entry.status) && (
                                            <button onClick={() => handleCancel(entry._id)} className="rounded-lg p-2 text-red-400 transition-colors hover:bg-red-50 hover:text-red-600">
                                                <Trash2 className="h-4 w-4" />
                                            </button>
                                        )}
                                    </div>

                                    {entry.rejectionReason && (
                                        <p className="mt-3 rounded-lg bg-red-50 p-2 text-xs text-red-500">{translateTradeText('Reason') || 'Reason'}: {entry.translatedRejectionReason || entry.rejectionReason}</p>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
