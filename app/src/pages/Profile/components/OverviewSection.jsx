import { Link } from 'react-router-dom';
import {
    BadgeCheck,
    Heart,
    Package,
    Shield,
    ShieldCheck,
    ShoppingCart,
    Sparkles,
    Store,
    Tag,
    Trophy,
    UserRound,
    Wallet,
    Eye,
    Plus,
} from 'lucide-react';
import { StatCard, QuickLink } from './ProfileShared';

const accountStateCopy = {
    active: { label: 'Active', detail: 'Account is clear for shopping, selling, and support.' },
    warned: { label: 'Warned', detail: 'There is an active governance warning that needs attention.' },
    suspended: { label: 'Suspended', detail: 'Some core actions are restricted until admin resolution.' },
    deleted: { label: 'Deleting', detail: 'This account is in the deletion pipeline.' },
};

export default function OverviewSection({
    stats,
    cartItems,
    wishlistItems,
    recentOrders,
    auraPoints,
    auraTier,
    isAdminAccount,
    profile,
    memberSince,
    hasOtpReadyIdentity,
    paymentMethodsSecured,
    paymentMethodCount,
    trustHealthy,
    profileCompletion,
}) {
    const accountState = accountStateCopy[profile?.accountState] || accountStateCopy.active;

    return (
        <div className="space-y-8">
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                <div className="premium-panel premium-card-hover p-5">
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">Identity posture</p>
                            <p className="mt-2 text-2xl font-black text-white">{hasOtpReadyIdentity ? 'Fortified' : 'Needs attention'}</p>
                        </div>
                        <div className={`flex h-12 w-12 items-center justify-center rounded-2xl border ${hasOtpReadyIdentity ? 'border-emerald-400/20 bg-emerald-500/12 text-emerald-200' : 'border-amber-400/20 bg-amber-500/12 text-amber-100'}`}>
                            <ShieldCheck className="h-6 w-6" />
                        </div>
                    </div>
                    <p className="mt-3 text-sm text-slate-400">
                        {hasOtpReadyIdentity
                            ? 'Email and phone are ready for stronger account recovery and OTP-based assurance.'
                            : 'Finish phone-based identity setup to restore a fully fortified posture.'}
                    </p>
                </div>

                <div className="premium-panel premium-card-hover p-5">
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">Account standing</p>
                            <p className="mt-2 text-2xl font-black text-white">{accountState.label}</p>
                        </div>
                        <div className={`flex h-12 w-12 items-center justify-center rounded-2xl border ${trustHealthy ? 'border-cyan-300/20 bg-cyan-500/12 text-cyan-100' : 'border-amber-400/20 bg-amber-500/12 text-amber-100'}`}>
                            <Shield className="h-6 w-6" />
                        </div>
                    </div>
                    <p className="mt-3 text-sm text-slate-400">{accountState.detail}</p>
                </div>

                <div className="premium-panel premium-card-hover p-5">
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">Profile readiness</p>
                            <p className="mt-2 text-2xl font-black text-white">{profileCompletion}%</p>
                        </div>
                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-neo-cyan">
                            <UserRound className="h-6 w-6" />
                        </div>
                    </div>
                    <p className="mt-3 text-sm text-slate-400">
                        Member since {memberSince}. {paymentMethodCount} saved payment {paymentMethodCount === 1 ? 'method' : 'methods'} and {profile?.addresses?.length || 0} stored {profile?.addresses?.length === 1 ? 'address' : 'addresses'}.
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
                <StatCard icon={Package} label="Total Orders" value={stats.totalOrders || 0} color="blue" />
                <StatCard icon={Wallet} label="Total Spent" value={`₹${(stats.totalSpent || 0).toLocaleString('en-IN')}`} color="green" />
                <StatCard icon={Heart} label="Wishlist Items" value={wishlistItems?.length || 0} color="pink" />
                <StatCard icon={ShoppingCart} label="Cart Items" value={cartItems?.length || 0} color="purple" />
                <StatCard icon={Sparkles} label="Aura Points" value={auraPoints.toLocaleString('en-IN')} color="amber" />
                <StatCard icon={Trophy} label="Tier" value={auraTier} color="cyan" />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <StatCard icon={Store} label="Active Listings" value={stats.listings?.active || 0} color="indigo" />
                <StatCard icon={Tag} label="Items Sold" value={stats.listings?.sold || 0} color="emerald" />
                <StatCard icon={Eye} label="Total Views" value={stats.listings?.totalViews || 0} color="amber" />
            </div>

            <div className="premium-panel p-6">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-4">
                    <div>
                        <h3 className="font-bold text-white flex items-center gap-2">
                            <Package className="w-5 h-5 text-neo-cyan" />
                            Recent Orders
                        </h3>
                        <p className="text-sm text-slate-400 mt-1">Latest purchase activity visible at a glance.</p>
                    </div>
                    <Link to="/orders" className="text-sm text-neo-cyan font-semibold hover:underline">View all orders</Link>
                </div>

                {recentOrders.length === 0 ? (
                    <div className="rounded-[1.8rem] border border-dashed border-white/10 py-12 text-center">
                        <Package className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                        <p className="text-white font-semibold">No orders yet</p>
                        <p className="text-slate-400 text-sm mt-1">Start shopping to populate your command deck.</p>
                        <Link to="/products" className="text-neo-cyan text-sm font-semibold hover:underline mt-3 inline-block">Start shopping</Link>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {recentOrders.map((order) => (
                            <div key={order._id} className="flex items-center gap-4 rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-4">
                                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-neo-cyan">
                                    <Package className="w-5 h-5" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="font-bold text-white text-sm truncate">
                                        {order.orderItems?.map((item) => item.title).join(', ') || 'Order'}
                                    </p>
                                    <p className="text-xs text-slate-500 mt-1">
                                        {new Date(order.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                                    </p>
                                </div>
                                <div className="text-right">
                                    <p className="font-black text-white">₹{order.totalPrice?.toLocaleString('en-IN')}</p>
                                    <span className={`mt-1 inline-flex rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${order.isDelivered ? 'bg-emerald-500/12 text-emerald-100' : order.isPaid ? 'bg-cyan-500/12 text-cyan-100' : 'bg-amber-500/12 text-amber-100'}`}>
                                        {order.isDelivered ? 'Delivered' : order.isPaid ? 'Shipped' : 'Processing'}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <QuickLink to="/marketplace" icon={Store} label="Marketplace" desc="Browse listings" />
                <QuickLink to="/sell" icon={Plus} label="Sell Item" desc="Post a listing" />
                <QuickLink to="/wishlist" icon={Heart} label="Wishlist" desc={`${wishlistItems?.length || 0} items saved`} />
                <QuickLink
                    to={isAdminAccount ? '/admin/dashboard' : '/payments'}
                    icon={isAdminAccount ? Shield : BadgeCheck}
                    label={isAdminAccount ? 'Admin Console' : 'Payment Safety'}
                    desc={isAdminAccount ? 'Secure admin operations' : paymentMethodsSecured ? 'Tokenized and secured' : 'Review your payment posture'}
                />
            </div>
        </div>
    );
}
