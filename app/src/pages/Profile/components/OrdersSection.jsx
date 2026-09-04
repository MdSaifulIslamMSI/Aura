import { Link } from 'react-router-dom';
import { Package, MapPin, CreditCard } from 'lucide-react';

import { StableText } from '@/i18n/StableText';
export default function OrdersSection({ recentOrders, stats }) {
    return (
        <div className="space-y-5">
            <div className="premium-panel premium-card-hover p-6">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-6">
                    <h2 className="text-xl font-black text-white">Order History</h2>
                    <span className="text-sm text-slate-400">{stats.totalOrders || 0} <StableText id={"order.jsx.text.total.orders.eed7543a"} defaultMessage={"total orders"} /></span>
                </div>
                {recentOrders.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-white/10 px-6 py-12 text-center">
                        <Package className="h-12 w-12 text-slate-600 mx-auto mb-3" aria-hidden="true" />
                        <h2 className="text-lg font-black text-white mb-1">No orders yet</h2>
                        <p className="text-slate-400 text-sm mb-4"><StableText id={"order.jsx.text.start.shopping.to.see.your.orders.here.b15e523d"} defaultMessage={"Start shopping to see your orders here"} /></p>
                        <Link to="/products" className="inline-flex min-h-11 items-center px-6 py-2 rounded-xl bg-[#d2a96c] font-bold text-sm text-[#17231e] transition-colors hover:bg-[#f3c982]">
                            <StableText id={"order.jsx.text.shop.now.7bbc4028"} defaultMessage={"Shop Now"} />
                        </Link>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {recentOrders.map(order => (
                            <div key={order._id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 transition-colors hover:bg-white/[0.05]">
                                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
                                    <div>
                                        <p className="text-xs text-slate-400"><StableText id={"order.jsx.text.order.449420.7246c296"} defaultMessage={"Order #"} />{order._id?.slice(-8).toUpperCase()}</p>
                                        <p className="text-xs text-slate-400">{new Date(order.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                                    </div>
                                    <div className="text-right">
                                        <p className="font-black text-white">₹{order.totalPrice?.toLocaleString('en-IN')}</p>
                                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold
                ${order.isDelivered ? 'border-emerald-400/20 bg-emerald-500/12 text-emerald-200' : order.isPaid ? 'border-blue-400/20 bg-blue-500/12 text-blue-200' : 'border-amber-400/20 bg-amber-500/12 text-amber-200'}`}>
                                            {order.isDelivered ? 'Delivered' : order.isPaid ? 'Shipped' : 'Processing'}
                                        </span>
                                    </div>
                                </div>
                                <div className="flex gap-2 overflow-x-auto">
                                    {order.orderItems?.map((item, idx) => (
                                        <div key={idx} className="flex flex-shrink-0 items-center gap-2 px-3 py-2 rounded-xl border border-white/10 bg-white/[0.04]">
                                            <img src={item.image} alt="" loading="lazy" className="w-10 h-10 rounded-lg object-cover" />
                                            <div>
                                                <p className="text-xs font-semibold text-slate-200 line-clamp-1 max-w-[150px]">{item.title}</p>
                                                <p className="text-[10px] text-slate-400"><StableText id={"order.jsx.text.qty.68ff921a"} defaultMessage={"Qty:"} /> {item.quantity} · ₹{item.price}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                <div className="flex items-center gap-3 mt-3 pt-3 border-t border-white/10 text-xs text-slate-400">
                                    <span className="flex items-center gap-1"><MapPin className="w-3 h-3" aria-hidden="true" /> {order.shippingAddress?.city}</span>
                                    <span className="flex items-center gap-1"><CreditCard className="w-3 h-3" aria-hidden="true" /> {order.paymentMethod}</span>
                                </div>
                            </div>
                        ))}
                        <Link to="/orders" className="block py-3 text-center text-sm font-bold text-neo-cyan hover:underline">
                            <StableText id={"order.jsx.text.view.all.orders.7f96ae61"} defaultMessage={"View All Orders →"} />
                        </Link>
                    </div>
                )}
            </div>
        </div>
    );
}
