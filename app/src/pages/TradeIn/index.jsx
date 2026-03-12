import { useState, useEffect, useContext } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, RefreshCw, Package, Trash2, Clock, CheckCircle, XCircle, ArrowLeftRight, Sparkles } from 'lucide-react';
import { tradeInApi } from '@/services/api';
import { AuthContext } from '@/context/AuthContext';

const STATUS_STYLES = {
    pending: { bg: 'bg-amber-100', text: 'text-amber-700', icon: Clock },
    'under-review': { bg: 'bg-blue-100', text: 'text-blue-700', icon: RefreshCw },
    approved: { bg: 'bg-green-100', text: 'text-green-700', icon: CheckCircle },
    rejected: { bg: 'bg-red-100', text: 'text-red-700', icon: XCircle },
    completed: { bg: 'bg-purple-100', text: 'text-purple-700', icon: Sparkles },
};

export default function TradeIn() {
    const { currentUser } = useContext(AuthContext);
    const [tradeIns, setTradeIns] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            try {
                const data = await tradeInApi.getMyTradeIns();
                setTradeIns(data.tradeIns || []);
            } catch (err) { console.error(err); }
            finally { setLoading(false); }
        })();
    }, []);

    const handleCancel = async (id) => {
        if (!confirm('Cancel this trade-in request?')) return;
        try {
            await tradeInApi.cancel(id);
            setTradeIns(prev => prev.filter(t => t._id !== id));
        } catch (err) { alert(err.message); }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 via-orange-50 to-amber-50">
            {/* Hero */}
            <div className="bg-gradient-to-r from-orange-500 via-amber-500 to-yellow-500 relative overflow-hidden">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_30%,rgba(255,255,255,0.15),transparent)] pointer-events-none" />
                <div className="max-w-6xl mx-auto px-4 py-10 sm:py-14 relative z-10">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-3">
                        <div className="w-14 h-14 bg-white/20 rounded-2xl flex items-center justify-center">
                            <ArrowLeftRight className="w-7 h-7 text-white" />
                        </div>
                        <div>
                            <h1 className="text-3xl sm:text-4xl font-black text-white">Trade-In</h1>
                            <p className="text-white/70 text-sm">Exchange your old items for discounts on new products</p>
                        </div>
                    </div>

                    {/* How it works */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-8">
                        {[
                            { step: '1', label: 'Choose Product', desc: 'Pick the new product you want' },
                            { step: '2', label: 'Select Trade-In', desc: 'Choose your item to trade in' },
                            { step: '3', label: 'Get Estimate', desc: 'See instant trade-in value' },
                            { step: '4', label: 'Save Big', desc: 'Pay only the difference!' },
                        ].map(s => (
                            <div key={s.step} className="bg-white/10 rounded-xl p-4">
                                <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center text-white font-black text-sm mb-2">{s.step}</div>
                                <p className="text-white font-bold text-sm">{s.label}</p>
                                <p className="text-white/60 text-xs">{s.desc}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <div className="max-w-6xl mx-auto px-4 py-8">
                {/* CTA */}
                <div className="bg-white rounded-2xl border shadow-sm p-6 mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                        <h2 className="text-xl font-bold text-gray-900">Ready to trade in?</h2>
                        <p className="text-gray-500 text-sm mt-1">Browse products and look for the "Trade-In" button on any product page</p>
                    </div>
                    <Link to="/products" className="px-6 py-3 bg-gradient-to-r from-orange-500 to-amber-500 text-white font-bold rounded-xl shadow-lg hover:from-orange-600 hover:to-amber-600 transition-all flex items-center gap-2">
                        Browse Products <ArrowRight className="w-4 h-4" />
                    </Link>
                </div>

                {/* My Trade-Ins */}
                <h3 className="text-lg font-bold text-gray-900 mb-4">My Trade-In Requests</h3>

                {loading ? (
                    <div className="space-y-4">
                        {[1, 2].map(i => (
                            <div key={i} className="bg-white rounded-xl p-5 animate-pulse">
                                <div className="flex flex-col sm:flex-row gap-4">
                                    <div className="w-20 h-20 bg-gray-200 rounded-xl" />
                                    <div className="flex-1 space-y-2">
                                        <div className="h-5 bg-gray-200 rounded w-1/2" />
                                        <div className="h-4 bg-gray-200 rounded w-1/3" />
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : tradeIns.length === 0 ? (
                    <div className="bg-white rounded-2xl border shadow-sm p-12 text-center">
                        <ArrowLeftRight className="w-16 h-16 text-gray-200 mx-auto mb-3" />
                        <h3 className="text-lg font-bold text-gray-900 mb-1">No trade-ins yet</h3>
                        <p className="text-gray-400 text-sm">Visit any product page and click "Trade-In" to get started</p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {tradeIns.map(t => {
                            const st = STATUS_STYLES[t.status] || STATUS_STYLES.pending;
                            const StIcon = st.icon;
                            const itemTitle = t.listing?.title || t.manualItem?.title || 'Your Item';
                            const itemImage = t.listing?.images?.[0] || '';
                            return (
                                <div key={t._id} className="bg-white rounded-2xl border shadow-sm p-5">
                                    <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                                        {/* Trade-in item */}
                                        <div className="text-center flex-shrink-0">
                                            <div className="w-16 h-16 bg-gray-100 rounded-xl overflow-hidden mx-auto">
                                                {itemImage ? <img src={itemImage} alt="" className="w-full h-full object-cover" /> :
                                                    <div className="w-full h-full flex items-center justify-center text-gray-300"><Package className="w-8 h-8" /></div>}
                                            </div>
                                            <p className="text-[10px] text-gray-400 mt-1 font-bold">YOUR ITEM</p>
                                        </div>

                                        <ArrowRight className="w-5 h-5 text-orange-400 flex-shrink-0" />

                                        {/* Target product */}
                                        <div className="text-center flex-shrink-0">
                                            <div className="w-16 h-16 bg-gray-100 rounded-xl overflow-hidden mx-auto">
                                                {t.targetProduct?.image ? <img src={t.targetProduct.image} alt="" className="w-full h-full object-cover" /> :
                                                    <div className="w-full h-full flex items-center justify-center text-gray-300"><Package className="w-8 h-8" /></div>}
                                            </div>
                                            <p className="text-[10px] text-gray-400 mt-1 font-bold">NEW PRODUCT</p>
                                        </div>

                                        {/* Details */}
                                        <div className="flex-1 min-w-0 sm:ml-2">
                                            <p className="font-bold text-gray-900 text-sm truncate">{itemTitle} → {t.targetProduct?.title}</p>
                                            <div className="flex flex-wrap items-center gap-2 sm:gap-3 mt-1 text-xs">
                                                <span className="text-orange-600 font-black">Trade Value: ₹{t.estimatedValue?.toLocaleString('en-IN')}</span>
                                                <span className="text-gray-400">|</span>
                                                <span className="text-green-600 font-bold">You Pay: ₹{(t.targetProduct?.price - t.estimatedValue)?.toLocaleString('en-IN')}</span>
                                            </div>
                                            <div className="flex items-center gap-2 mt-2">
                                                <span className={`flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded-full ${st.bg} ${st.text}`}>
                                                    <StIcon className="w-3 h-3" /> {t.status.replace('-', ' ').toUpperCase()}
                                                </span>
                                                <span className="text-[10px] text-gray-400">{new Date(t.createdAt).toLocaleDateString('en-IN')}</span>
                                            </div>
                                        </div>

                                        {/* Actions */}
                                        {['pending', 'under-review'].includes(t.status) && (
                                            <button onClick={() => handleCancel(t._id)}
                                                className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        )}
                                    </div>
                                    {t.rejectionReason && (
                                        <p className="mt-3 text-xs text-red-500 bg-red-50 p-2 rounded-lg">Reason: {t.rejectionReason}</p>
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
