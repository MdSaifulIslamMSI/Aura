import { Link } from 'react-router-dom';
import { Package, CreditCard, Heart, ShoppingCart, Sparkles, Trophy, Store, Tag, Eye, Shield, Plus, ChevronRight } from 'lucide-react';
import { StatCard, QuickLink } from './ProfileShared';

export default function OverviewSection({ stats, cartItems, wishlistItems, recentOrders, auraPoints, auraTier, isAdminAccount }) {
    return (
        <div className="space-y-8">
            {/* Stats Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
                <StatCard icon={Package} label="Total Orders" value={stats.totalOrders || 0} color="blue" />
                <StatCard icon={CreditCard} label="Total Spent" value={`₹${(stats.totalSpent || 0).toLocaleString('en-IN')}`} color="green" />
                <StatCard icon={Heart} label="Wishlist Items" value={wishlistItems?.length || 0} color="pink" />
                <StatCard icon={ShoppingCart} label="Cart Items" value={cartItems?.length || 0} color="purple" />
                <StatCard icon={Sparkles} label="Aura Points" value={auraPoints.toLocaleString('en-IN')} color="amber" />
                <StatCard icon={Trophy} label="Tier" value={auraTier} color="cyan" />
            </div>

            {/* Marketplace Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <StatCard icon={Store} label="Active Listings" value={stats.listings?.active || 0} color="indigo" />
                <StatCard icon={Tag} label="Items Sold" value={stats.listings?.sold || 0} color="emerald" />
                <StatCard icon={Eye} label="Total Views" value={stats.listings?.totalViews || 0} color="amber" />
            </div>

            {/* Recent Orders */}
            <div className="bg-white rounded-2xl border shadow-sm p-6">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
                    <h3 className="font-bold text-gray-900 flex items-center gap-2"><Package className="w-5 h-5 text-indigo-500" /> Recent Orders</h3>
                    <Link to="/orders" className="text-sm text-indigo-600 font-semibold hover:underline">View All →</Link>
                </div>
                {recentOrders.length === 0 ? (
                    <div className="text-center py-8">
                        <Package className="w-12 h-12 text-gray-200 mx-auto mb-2" />
                        <p className="text-gray-400 text-sm">No orders yet</p>
                        <Link to="/products" className="text-indigo-600 text-sm font-semibold hover:underline mt-1 inline-block">Start Shopping →</Link>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {recentOrders.map(order => (
                            <div key={order._id} className="flex items-center gap-4 p-3 border rounded-xl hover:bg-gray-50 transition-colors">
                                <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center flex-shrink-0">
                                    <Package className="w-6 h-6 text-indigo-500" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="font-bold text-gray-900 text-sm truncate">
                                        {order.orderItems?.map(i => i.title).join(', ') || 'Order'}
                                    </p>
                                    <p className="text-xs text-gray-400">{new Date(order.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                                </div>
                                <div className="text-right">
                                    <p className="font-bold text-gray-900">₹{order.totalPrice?.toLocaleString('en-IN')}</p>
                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full
              ${order.isDelivered ? 'bg-green-100 text-green-700' : order.isPaid ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>
                                        {order.isDelivered ? 'Delivered' : order.isPaid ? 'Shipped' : 'Processing'}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Quick Links */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <QuickLink to="/marketplace" icon={Store} label="Marketplace" desc="Browse listings" />
                <QuickLink to="/sell" icon={Plus} label="Sell Item" desc="Post a listing" />
                <QuickLink to="/my-listings" icon={Tag} label="My Listings" desc="Manage items" />
                <QuickLink to="/wishlist" icon={Heart} label="Wishlist" desc={`${wishlistItems?.length || 0} items saved`} />
                {isAdminAccount && (
                    <QuickLink to="/admin/dashboard" icon={Shield} label="Admin Console" desc="Secure admin operations" />
                )}
            </div>
        </div>
    );
}
