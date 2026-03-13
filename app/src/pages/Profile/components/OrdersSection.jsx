import { Link } from 'react-router-dom';
import { Package, MapPin, CreditCard } from 'lucide-react';

export default function OrdersSection({ recentOrders, stats }) {
    return (
        <div className="max-w-3xl">
            <div className="bg-white rounded-2xl border shadow-sm p-6">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-6">
                    <h3 className="text-lg font-bold text-gray-900">Order History</h3>
                    <span className="text-sm text-gray-400">{stats.totalOrders || 0} total orders</span>
                </div>
                {recentOrders.length === 0 ? (
                    <div className="text-center py-12">
                        <Package className="w-16 h-16 text-gray-200 mx-auto mb-3" />
                        <h3 className="text-lg font-bold text-gray-900 mb-1">No orders yet</h3>
                        <p className="text-gray-400 text-sm mb-4">Start shopping to see your orders here</p>
                        <Link to="/products" className="inline-flex px-6 py-2 bg-indigo-600 text-white font-bold rounded-lg text-sm hover:bg-indigo-700">
                            Shop Now
                        </Link>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {recentOrders.map(order => (
                            <div key={order._id} className="border rounded-xl p-4 hover:bg-gray-50 transition-colors">
                                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
                                    <div>
                                        <p className="text-xs text-gray-400">Order #{order._id?.slice(-8).toUpperCase()}</p>
                                        <p className="text-xs text-gray-400">{new Date(order.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                                    </div>
                                    <div className="text-right">
                                        <p className="font-black text-gray-900">₹{order.totalPrice?.toLocaleString('en-IN')}</p>
                                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full
                ${order.isDelivered ? 'bg-green-100 text-green-700' : order.isPaid ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>
                                            {order.isDelivered ? 'Delivered' : order.isPaid ? 'Shipped' : 'Processing'}
                                        </span>
                                    </div>
                                </div>
                                <div className="flex gap-2 overflow-x-auto">
                                    {order.orderItems?.map((item, idx) => (
                                        <div key={idx} className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg flex-shrink-0">
                                            <img src={item.image} alt="" className="w-10 h-10 rounded-lg object-cover" />
                                            <div>
                                                <p className="text-xs font-semibold text-gray-700 line-clamp-1 max-w-[150px]">{item.title}</p>
                                                <p className="text-[10px] text-gray-400">Qty: {item.quantity} · ₹{item.price}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                <div className="flex items-center gap-3 mt-3 pt-3 border-t text-xs text-gray-400">
                                    <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {order.shippingAddress?.city}</span>
                                    <span className="flex items-center gap-1"><CreditCard className="w-3 h-3" /> {order.paymentMethod}</span>
                                </div>
                            </div>
                        ))}
                        <Link to="/orders" className="block text-center py-3 text-indigo-600 font-bold text-sm hover:underline">
                            View All Orders →
                        </Link>
                    </div>
                )}
            </div>
        </div>
    );
}
