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
import { useMarket } from '@/context/MarketContext';
import { StatCard, QuickLink } from './ProfileShared';

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
    const { t, formatPrice } = useMarket();

    const accountStateCopy = {
        active: {
            label: t('profile.overview.account.active.label', {}, 'Active'),
            detail: t('profile.overview.account.active.detail', {}, 'Account is clear for shopping, selling, and support.'),
        },
        warned: {
            label: t('profile.overview.account.warned.label', {}, 'Warned'),
            detail: t('profile.overview.account.warned.detail', {}, 'There is an active governance warning that needs attention.'),
        },
        suspended: {
            label: t('profile.overview.account.suspended.label', {}, 'Suspended'),
            detail: t('profile.overview.account.suspended.detail', {}, 'Some core actions are restricted until admin resolution.'),
        },
        deleted: {
            label: t('profile.overview.account.deleted.label', {}, 'Deleting'),
            detail: t('profile.overview.account.deleted.detail', {}, 'This account is in the deletion pipeline.'),
        },
    };

    const accountState = accountStateCopy[profile?.accountState] || accountStateCopy.active;
    const addressCount = profile?.addresses?.length || 0;

    return (
        <div className="space-y-8">
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                <div className="premium-panel premium-card-hover p-5">
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">
                                {t('profile.overview.identity.label', {}, 'Identity posture')}
                            </p>
                            <p className="mt-2 text-2xl font-black text-white">
                                {hasOtpReadyIdentity
                                    ? t('profile.overview.identity.strong', {}, 'Fortified')
                                    : t('profile.overview.identity.weak', {}, 'Needs attention')}
                            </p>
                        </div>
                        <div className={`flex h-12 w-12 items-center justify-center rounded-2xl border ${hasOtpReadyIdentity ? 'border-emerald-400/20 bg-emerald-500/12 text-emerald-200' : 'border-amber-400/20 bg-amber-500/12 text-amber-100'}`}>
                            <ShieldCheck className="h-6 w-6" />
                        </div>
                    </div>
                    <p className="mt-3 text-sm text-slate-400">
                        {hasOtpReadyIdentity
                            ? t('profile.overview.identity.strongDetail', {}, 'Email and phone are ready for stronger account recovery and OTP-based assurance.')
                            : t('profile.overview.identity.weakDetail', {}, 'Finish phone-based identity setup to restore a fully fortified posture.')}
                    </p>
                </div>

                <div className="premium-panel premium-card-hover p-5">
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">
                                {t('profile.overview.standing.label', {}, 'Account standing')}
                            </p>
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
                            <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">
                                {t('profile.overview.readiness.label', {}, 'Profile readiness')}
                            </p>
                            <p className="mt-2 text-2xl font-black text-white">{profileCompletion}%</p>
                        </div>
                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-neo-cyan">
                            <UserRound className="h-6 w-6" />
                        </div>
                    </div>
                    <p className="mt-3 text-sm text-slate-400">
                        {t(
                            'profile.overview.readiness.detail',
                            {
                                memberSince,
                                paymentCount: paymentMethodCount,
                                paymentLabel: paymentMethodCount === 1
                                    ? t('profile.overview.paymentMethod.single', {}, 'method')
                                    : t('profile.overview.paymentMethod.plural', {}, 'methods'),
                                addressCount,
                                addressLabel: addressCount === 1
                                    ? t('profile.overview.address.single', {}, 'address')
                                    : t('profile.overview.address.plural', {}, 'addresses'),
                            },
                            `Member since ${memberSince}. ${paymentMethodCount} saved payment ${paymentMethodCount === 1 ? 'method' : 'methods'} and ${addressCount} stored ${addressCount === 1 ? 'address' : 'addresses'}.`,
                        )}
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                <StatCard icon={Package} label={t('profile.overview.stats.orders', {}, 'Total Orders')} value={stats.totalOrders || 0} color="blue" />
                <StatCard icon={Wallet} label={t('profile.overview.stats.spent', {}, 'Total Spent')} value={formatPrice(stats.totalSpent || 0, 'INR', undefined, { presentmentCurrency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 0 })} color="green" />
                <StatCard icon={Heart} label={t('profile.overview.stats.wishlist', {}, 'Wishlist Items')} value={wishlistItems?.length || 0} color="pink" />
                <StatCard icon={ShoppingCart} label={t('profile.overview.stats.cart', {}, 'Cart Items')} value={cartItems?.length || 0} color="purple" />
                <StatCard icon={Sparkles} label={t('profile.overview.stats.points', {}, 'Aura Points')} value={auraPoints.toLocaleString('en-IN')} color="amber" />
                <StatCard icon={Trophy} label={t('profile.overview.stats.tier', {}, 'Tier')} value={auraTier} color="cyan" />
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <StatCard icon={Store} label={t('profile.overview.stats.activeListings', {}, 'Active Listings')} value={stats.listings?.active || 0} color="indigo" />
                <StatCard icon={Tag} label={t('profile.overview.stats.itemsSold', {}, 'Items Sold')} value={stats.listings?.sold || 0} color="emerald" />
                <StatCard icon={Eye} label={t('profile.overview.stats.views', {}, 'Total Views')} value={stats.listings?.totalViews || 0} color="amber" />
            </div>

            <div className="premium-panel p-6">
                <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h3 className="flex items-center gap-2 font-bold text-white">
                            <Package className="h-5 w-5 text-neo-cyan" />
                            {t('profile.overview.orders.title', {}, 'Recent Orders')}
                        </h3>
                        <p className="mt-1 text-sm text-slate-400">{t('profile.overview.orders.body', {}, 'Latest purchase activity visible at a glance.')}</p>
                    </div>
                    <Link to="/orders" className="text-sm font-semibold text-neo-cyan hover:underline">
                        {t('profile.overview.orders.viewAll', {}, 'View all orders')}
                    </Link>
                </div>

                {recentOrders.length === 0 ? (
                    <div className="rounded-[1.8rem] border border-dashed border-white/10 py-12 text-center">
                        <Package className="mx-auto mb-3 h-12 w-12 text-slate-600" />
                        <p className="font-semibold text-white">{t('profile.overview.orders.emptyTitle', {}, 'No orders yet')}</p>
                        <p className="mt-1 text-sm text-slate-400">{t('profile.overview.orders.emptyBody', {}, 'Start shopping to populate your command deck.')}</p>
                        <Link to="/products" className="mt-3 inline-block text-sm font-semibold text-neo-cyan hover:underline">
                            {t('profile.overview.orders.start', {}, 'Start shopping')}
                        </Link>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {recentOrders.map((order) => (
                            <div key={order._id} className="flex items-center gap-4 rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-4">
                                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-neo-cyan">
                                    <Package className="h-5 w-5" />
                                </div>
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-bold text-white">
                                        {order.orderItems?.map((item) => item.title).join(', ') || t('profile.overview.orders.fallback', {}, 'Order')}
                                    </p>
                                    <p className="mt-1 text-xs text-slate-500">
                                        {new Date(order.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                                    </p>
                                </div>
                                <div className="text-right">
                                    <p className="font-black text-white">{formatPrice(order.totalPrice || 0, 'INR', undefined, { presentmentCurrency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 0 })}</p>
                                    <span className={`mt-1 inline-flex rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${order.isDelivered ? 'bg-emerald-500/12 text-emerald-100' : order.isPaid ? 'bg-cyan-500/12 text-cyan-100' : 'bg-amber-500/12 text-amber-100'}`}>
                                        {order.isDelivered
                                            ? t('profile.overview.orders.status.delivered', {}, 'Delivered')
                                            : order.isPaid
                                                ? t('profile.overview.orders.status.shipped', {}, 'Shipped')
                                                : t('profile.overview.orders.status.processing', {}, 'Processing')}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <QuickLink to="/marketplace" icon={Store} label={t('profile.overview.links.marketplace.label', {}, 'Marketplace')} desc={t('profile.overview.links.marketplace.desc', {}, 'Browse listings')} />
                <QuickLink to="/sell" icon={Plus} label={t('profile.overview.links.sell.label', {}, 'Sell Item')} desc={t('profile.overview.links.sell.desc', {}, 'Post a listing')} />
                <QuickLink to="/wishlist" icon={Heart} label={t('profile.overview.links.wishlist.label', {}, 'Wishlist')} desc={t('profile.overview.links.wishlist.desc', { count: wishlistItems?.length || 0 }, `${wishlistItems?.length || 0} items saved`)} />
                <QuickLink
                    to={isAdminAccount ? '/admin/dashboard' : '/payments'}
                    icon={isAdminAccount ? Shield : BadgeCheck}
                    label={isAdminAccount
                        ? t('profile.overview.links.admin.label', {}, 'Admin Console')
                        : t('profile.overview.links.payment.label', {}, 'Payment Safety')}
                    desc={isAdminAccount
                        ? t('profile.overview.links.admin.desc', {}, 'Secure admin operations')
                        : paymentMethodsSecured
                            ? t('profile.overview.links.payment.secured', {}, 'Tokenized and secured')
                            : t('profile.overview.links.payment.review', {}, 'Review your payment posture')}
                />
            </div>
        </div>
    );
}
