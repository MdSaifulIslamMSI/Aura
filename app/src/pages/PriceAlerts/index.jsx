import { useState, useEffect, useContext } from 'react';
import { Link } from 'react-router-dom';
import { Bell, BellRing, Trash2, TrendingDown, Target, ArrowDown, Plus } from 'lucide-react';
import { priceAlertApi } from '@/services/api';
import { AuthContext } from '@/context/AuthContext';

export default function PriceAlerts() {
    const { currentUser } = useContext(AuthContext);
    const [alerts, setAlerts] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            try {
                const data = await priceAlertApi.getMyAlerts();
                setAlerts(data.alerts || []);
            } catch (err) { console.error(err); }
            finally { setLoading(false); }
        })();
    }, []);

    const handleDelete = async (id) => {
        try {
            await priceAlertApi.delete(id);
            setAlerts(prev => prev.filter(a => a._id !== id));
        } catch (err) { alert(err.message); }
    };

    const activeAlerts = alerts.filter(a => a.isActive && !a.triggered);
    const triggeredAlerts = alerts.filter(a => a.triggered);

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 via-purple-50 to-pink-50">
            {/* Hero */}
            <div className="bg-gradient-to-r from-purple-600 via-fuchsia-600 to-pink-500 relative overflow-hidden">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_50%,rgba(255,255,255,0.1),transparent)] pointer-events-none" />
                <div className="max-w-6xl mx-auto px-4 py-10 sm:py-14 relative z-10">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-2">
                        <div className="w-14 h-14 bg-white/20 rounded-2xl flex items-center justify-center">
                            <BellRing className="w-7 h-7 text-white" />
                        </div>
                        <div>
                            <h1 className="text-3xl sm:text-4xl font-black text-white">Price Alerts</h1>
                            <p className="text-white/70 text-sm">Get notified when prices drop to your target</p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-8">
                        <div className="bg-white/10 rounded-xl p-4 text-center">
                            <p className="text-3xl font-black text-white">{activeAlerts.length}</p>
                            <p className="text-white/60 text-xs font-bold">Active Alerts</p>
                        </div>
                        <div className="bg-white/10 rounded-xl p-4 text-center">
                            <p className="text-3xl font-black text-green-300">{triggeredAlerts.length}</p>
                            <p className="text-white/60 text-xs font-bold">Price Dropped!</p>
                        </div>
                        <div className="bg-white/10 rounded-xl p-4 text-center">
                            <p className="text-3xl font-black text-white">{alerts.length}</p>
                            <p className="text-white/60 text-xs font-bold">Total Alerts</p>
                        </div>
                    </div>
                </div>
            </div>

            <div className="max-w-6xl mx-auto px-4 py-8">
                {/* CTA */}
                <div className="bg-white rounded-2xl border shadow-sm p-6 mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                        <h2 className="text-xl font-bold text-gray-900">Set a new alert</h2>
                        <p className="text-gray-500 text-sm mt-1">Browse any product and click "Set Price Alert" to track price drops</p>
                    </div>
                    <Link to="/products" className="px-6 py-3 bg-gradient-to-r from-purple-600 to-fuchsia-600 text-white font-bold rounded-xl shadow-lg hover:from-purple-700 hover:to-fuchsia-700 transition-all flex items-center gap-2">
                        <Plus className="w-4 h-4" /> Browse Products
                    </Link>
                </div>

                {/* Triggered Alerts */}
                {triggeredAlerts.length > 0 && (
                    <div className="mb-8">
                        <h3 className="text-lg font-bold text-green-700 mb-4 flex items-center gap-2">
                            <TrendingDown className="w-5 h-5" /> Price Dropped! 🎉
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {triggeredAlerts.map(alert => (
                                <div key={alert._id} className="bg-green-50 border-2 border-green-200 rounded-2xl p-5 relative">
                                    <span className="absolute top-3 right-3 px-2 py-0.5 bg-green-500 text-white text-[10px] font-bold rounded-full animate-pulse">DROPPED!</span>
                                    <div className="flex flex-col sm:flex-row gap-4">
                                        <div className="w-16 h-16 bg-white rounded-xl overflow-hidden flex-shrink-0">
                                            {alert.productImage && <img src={alert.productImage} alt="" className="w-full h-full object-cover" />}
                                        </div>
                                        <div className="flex-1">
                                            <Link to={`/product/${alert.productId}`} className="font-bold text-gray-900 text-sm hover:text-green-700 line-clamp-1">{alert.productTitle}</Link>
                                            <div className="flex flex-wrap items-center gap-2 mt-1">
                                                <span className="text-gray-400 line-through text-xs">₹{alert.currentPrice?.toLocaleString('en-IN')}</span>
                                                <ArrowDown className="w-3 h-3 text-green-600" />
                                                <span className="text-green-700 font-black">₹{(alert.latestPrice || alert.targetPrice)?.toLocaleString('en-IN')}</span>
                                            </div>
                                            <p className="text-[10px] text-green-600 font-bold mt-1">Your target: ₹{alert.targetPrice?.toLocaleString('en-IN')}</p>
                                            <div className="flex gap-2 mt-2">
                                                <Link to={`/product/${alert.productId}`} className="px-3 py-1 bg-green-600 text-white text-xs font-bold rounded-lg">Buy Now</Link>
                                                <button onClick={() => handleDelete(alert._id)} className="px-3 py-1 border border-gray-200 text-gray-400 text-xs rounded-lg hover:bg-gray-50">Dismiss</button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Active Alerts */}
                <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                    <Bell className="w-5 h-5 text-purple-500" /> Active Alerts
                </h3>

                {loading ? (
                    <div className="space-y-4">
                        {[1, 2, 3].map(i => (
                            <div key={i} className="bg-white rounded-xl p-5 animate-pulse flex flex-col sm:flex-row gap-4">
                                <div className="w-16 h-16 bg-gray-200 rounded-xl" />
                                <div className="flex-1 space-y-2">
                                    <div className="h-5 bg-gray-200 rounded w-1/2" />
                                    <div className="h-4 bg-gray-200 rounded w-1/3" />
                                </div>
                            </div>
                        ))}
                    </div>
                ) : activeAlerts.length === 0 ? (
                    <div className="bg-white rounded-2xl border shadow-sm p-12 text-center">
                        <Bell className="w-16 h-16 text-gray-200 mx-auto mb-3" />
                        <h3 className="text-lg font-bold text-gray-900 mb-1">No active alerts</h3>
                        <p className="text-gray-400 text-sm">Set alerts on products to get notified when prices drop</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {activeAlerts.map(alert => (
                            <div key={alert._id} className="bg-white rounded-xl border shadow-sm p-4 flex flex-col sm:flex-row sm:items-center gap-4">
                                <div className="w-14 h-14 bg-gray-100 rounded-xl overflow-hidden flex-shrink-0">
                                    {alert.productImage && <img src={alert.productImage} alt="" className="w-full h-full object-cover" />}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <Link to={`/product/${alert.productId}`} className="font-bold text-gray-900 text-sm hover:text-purple-600 line-clamp-1">{alert.productTitle}</Link>
                                    <div className="flex flex-wrap items-center gap-2 sm:gap-3 mt-1 text-xs">
                                        <span className="text-gray-500">Current: <strong>₹{alert.currentPrice?.toLocaleString('en-IN')}</strong></span>
                                        <span className="flex items-center gap-1 text-purple-600 font-bold">
                                            <Target className="w-3 h-3" /> Target: ₹{alert.targetPrice?.toLocaleString('en-IN')}
                                        </span>
                                    </div>
                                </div>
                                <button onClick={() => handleDelete(alert._id)}
                                    className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
