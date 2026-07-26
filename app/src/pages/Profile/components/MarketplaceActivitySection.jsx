import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
    BellRing,
    Heart,
    MessageSquareText,
    PackageCheck,
    RefreshCw,
    Repeat2,
    Store,
} from 'lucide-react';
import { authApi } from '@/services/api';
import { useMarket } from '@/context/MarketContext';
import { useStableIcuMessages } from '@/i18n/useStableIcuMessages';

const EMPTY_HUB = {
    savedItems: { count: 0, items: [], href: '/wishlist' },
    reviews: { count: 0, items: [] },
    listings: { count: 0, items: [], href: '/my-listings' },
    tradeIns: { count: 0, items: [], href: '/trade-in' },
    priceAlerts: { count: 0, items: [], href: '/price-alerts' },
};

const ActivityLink = ({ item, title, detail }) => (
    <Link
        to={item.href}
        className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-white/10 py-3 last:border-b-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
    >
        <span className="min-w-0">
            <strong className="block truncate text-sm text-[#fffaf0]">{title}</strong>
            <span className="mt-1 block truncate text-xs text-slate-400">{detail}</span>
        </span>
        <span aria-hidden="true" className="text-[#d2a96c]">→</span>
    </Link>
);

const DomainCard = ({ icon: Icon, label, count, href }) => (
    <Link
        to={href}
        className="grid min-h-28 content-between rounded-xl border border-white/10 bg-white/[0.04] p-4 transition-colors hover:border-[#d2a96c]/40 hover:bg-[#d2a96c]/[0.06] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
    >
        <Icon className="h-5 w-5 text-[#d2a96c]" aria-hidden="true" />
        <span>
            <strong className="block text-2xl font-black text-white">{count}</strong>
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">{label}</span>
        </span>
    </Link>
);

export default function MarketplaceActivitySection({ firebaseUser }) {
    const { t: legacyT, formatCurrency } = useMarket();
    const t = useStableIcuMessages(legacyT);
    const translateRef = useRef(t);
    const [hub, setHub] = useState(EMPTY_HUB);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        translateRef.current = t;
    }, [t]);

    const loadHub = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const payload = await authApi.getAccountMarketplace({ firebaseUser });
            setHub({ ...EMPTY_HUB, ...payload });
        } catch (loadError) {
            setError(loadError?.message || translateRef.current(
                'profile.marketplace.error',
                {},
                'Marketplace activity could not be loaded.'
            ));
        } finally {
            setLoading(false);
        }
    }, [firebaseUser]);

    useEffect(() => {
        void loadHub();
    }, [loadHub]);

    if (loading) {
        return (
            <section
                className="rounded-2xl border border-white/10 bg-white/[0.04] p-6"
                aria-busy="true"
                aria-labelledby="account-marketplace-title"
            >
                <h2 id="account-marketplace-title" className="text-xl font-black text-white">
                    {t('profile.marketplace.title', {}, 'Marketplace activity')}
                </h2>
                <p role="status" className="mt-3 text-sm text-slate-400">
                    {t('profile.marketplace.loading', {}, 'Loading your saved items and marketplace activity...')}
                </p>
            </section>
        );
    }

    if (error) {
        return (
            <section className="rounded-2xl border border-rose-300/20 bg-rose-950/20 p-6" aria-labelledby="account-marketplace-title">
                <h2 id="account-marketplace-title" className="text-xl font-black text-white">
                    {t('profile.marketplace.title', {}, 'Marketplace activity')}
                </h2>
                <p role="alert" className="mt-3 text-sm text-rose-100">{error}</p>
                <button
                    type="button"
                    onClick={loadHub}
                    className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-lg border border-rose-200/30 px-4 text-sm font-black text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
                >
                    <RefreshCw className="h-4 w-4" aria-hidden="true" />
                    {t('profile.marketplace.retry', {}, 'Try again')}
                </button>
            </section>
        );
    }

    const hasRecentActivity = [
        hub.savedItems?.items,
        hub.reviews?.items,
        hub.listings?.items,
        hub.tradeIns?.items,
        hub.priceAlerts?.items,
    ].some((items) => Array.isArray(items) && items.length > 0);

    return (
        <section className="grid gap-5" aria-labelledby="account-marketplace-title">
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 sm:p-6">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                        <p className="text-[11px] font-black uppercase tracking-[0.18em] text-[#d2a96c]">
                            {t('profile.marketplace.eyebrow', {}, 'Buyer and seller tools')}
                        </p>
                        <h2 id="account-marketplace-title" className="mt-1 text-2xl font-black text-white">
                            {t('profile.marketplace.title', {}, 'Marketplace activity')}
                        </h2>
                        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
                            {t(
                                'profile.marketplace.description',
                                {},
                                'Open the real saved-item, review, listing, trade-in, and price-alert workflows attached to this account.'
                            )}
                        </p>
                    </div>
                    <Link
                        to="/sell"
                        className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[#d2a96c] px-4 text-sm font-black text-[#17231e] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
                    >
                        {t('profile.marketplace.newListing', {}, 'Create listing')}
                    </Link>
                </div>

                <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
                    <DomainCard icon={Heart} label={t('profile.marketplace.saved', {}, 'Saved')} count={hub.savedItems?.count || 0} href={hub.savedItems?.href || '/wishlist'} />
                    <DomainCard icon={MessageSquareText} label={t('profile.marketplace.reviews', {}, 'Reviews')} count={hub.reviews?.count || 0} href={hub.reviews?.items?.[0]?.href || '/products'} />
                    <DomainCard icon={Store} label={t('profile.marketplace.listings', {}, 'Listings')} count={hub.listings?.count || 0} href={hub.listings?.href || '/my-listings'} />
                    <DomainCard icon={Repeat2} label={t('profile.marketplace.tradeIns', {}, 'Trade-ins')} count={hub.tradeIns?.count || 0} href={hub.tradeIns?.href || '/trade-in'} />
                    <DomainCard icon={BellRing} label={t('profile.marketplace.priceAlerts', {}, 'Price alerts')} count={hub.priceAlerts?.count || 0} href={hub.priceAlerts?.href || '/price-alerts'} />
                </div>
            </div>

            {!hasRecentActivity ? (
                <div className="rounded-2xl border border-dashed border-white/15 bg-white/[0.03] p-8 text-center">
                    <PackageCheck className="mx-auto h-7 w-7 text-[#d2a96c]" aria-hidden="true" />
                    <h3 className="mt-3 text-lg font-black text-white">
                        {t('profile.marketplace.empty.title', {}, 'No marketplace activity yet')}
                    </h3>
                    <p className="mt-2 text-sm text-slate-400">
                        {t('profile.marketplace.empty.body', {}, 'Saved products, reviews, listings, trade-ins, and alerts will appear here.')}
                    </p>
                    <Link to="/products" className="mt-4 inline-flex min-h-11 items-center font-black text-[#f3c982]">
                        {t('profile.marketplace.empty.action', {}, 'Browse products')}
                    </Link>
                </div>
            ) : (
                <div className="grid gap-4 xl:grid-cols-2">
                    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
                        <h3 className="text-base font-black text-white">{t('profile.marketplace.recentSaved', {}, 'Recently saved')}</h3>
                        <div className="mt-2">
                            {(hub.savedItems?.items || []).map((item) => (
                                <ActivityLink
                                    key={item.productId}
                                    item={item}
                                    title={item.title}
                                    detail={item.inStock ? formatCurrency(item.price) : t('profile.marketplace.outOfStock', {}, 'Out of stock')}
                                />
                            ))}
                            {hub.savedItems?.items?.length ? null : (
                                <p className="py-4 text-sm text-slate-400">{t('profile.marketplace.noneSaved', {}, 'No saved products.')}</p>
                            )}
                        </div>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
                        <h3 className="text-base font-black text-white">{t('profile.marketplace.yourReviews', {}, 'Your reviews')}</h3>
                        <div className="mt-2">
                            {(hub.reviews?.items || []).map((item) => (
                                <ActivityLink
                                    key={item.id}
                                    item={item}
                                    title={item.productTitle || t('profile.marketplace.productFallback', {}, 'Reviewed product')}
                                    detail={t('profile.marketplace.reviewDetail', { rating: item.rating, status: item.status }, '{rating}/5 · {status}')}
                                />
                            ))}
                            {hub.reviews?.items?.length ? null : (
                                <p className="py-4 text-sm text-slate-400">{t('profile.marketplace.noReviews', {}, 'No reviews submitted yet.')}</p>
                            )}
                        </div>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
                        <h3 className="text-base font-black text-white">{t('profile.marketplace.yourListings', {}, 'Your listings')}</h3>
                        <div className="mt-2">
                            {(hub.listings?.items || []).map((item) => (
                                <ActivityLink
                                    key={item.id}
                                    item={item}
                                    title={item.title}
                                    detail={t('profile.marketplace.listingDetail', { status: item.status, views: item.views }, '{status} · {views} views')}
                                />
                            ))}
                            {hub.listings?.items?.length ? null : (
                                <p className="py-4 text-sm text-slate-400">{t('profile.marketplace.noListings', {}, 'No listings created yet.')}</p>
                            )}
                        </div>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
                        <h3 className="text-base font-black text-white">{t('profile.marketplace.followUps', {}, 'Trade-ins and alerts')}</h3>
                        <div className="mt-2">
                            {(hub.tradeIns?.items || []).map((item) => (
                                <ActivityLink
                                    key={`trade-${item.id}`}
                                    item={item}
                                    title={item.productTitle}
                                    detail={t('profile.marketplace.tradeInDetail', { status: item.status }, 'Trade-in · {status}')}
                                />
                            ))}
                            {(hub.priceAlerts?.items || []).map((item) => (
                                <ActivityLink
                                    key={`alert-${item.id}`}
                                    item={item}
                                    title={item.productTitle}
                                    detail={t('profile.marketplace.alertDetail', { price: formatCurrency(item.targetPrice) }, 'Target {price}')}
                                />
                            ))}
                            {hub.tradeIns?.items?.length || hub.priceAlerts?.items?.length ? null : (
                                <p className="py-4 text-sm text-slate-400">{t('profile.marketplace.noFollowUps', {}, 'No trade-ins or price alerts yet.')}</p>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </section>
    );
}
