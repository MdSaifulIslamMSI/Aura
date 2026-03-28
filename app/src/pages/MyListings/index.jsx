import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Eye, Package, CheckCircle, Trash2, MapPin, Clock, Plus } from 'lucide-react';
import { listingApi } from '@/services/api';
import { useMarket } from '@/context/MarketContext';

const formatRelativeSellerTime = (dateStr, t, formatNumber) => {
  const timestamp = new Date(dateStr).getTime();
  if (!Number.isFinite(timestamp)) {
    return '';
  }

  const diff = Date.now() - timestamp;
  const days = Math.max(0, Math.floor(diff / 86400000));
  if (days < 1) return t('seller.shared.today', {}, 'Today');
  if (days === 1) return t('seller.shared.yesterday', {}, 'Yesterday');
  if (days < 30) {
    return t('seller.shared.daysAgo', { count: formatNumber(days) }, `${formatNumber(days)}d ago`);
  }

  const months = Math.max(1, Math.floor(days / 30));
  return t('seller.shared.monthsAgo', { count: formatNumber(months) }, `${formatNumber(months)}mo ago`);
};

const getSellerTabLabel = (tab, t) => {
  if (tab === 'active') return t('seller.shared.status.active', {}, 'Active');
  if (tab === 'sold') return t('seller.shared.status.sold', {}, 'Sold');
  return t('seller.shared.status.all', {}, 'All');
};

const getListingStatusLabel = (status, t) => {
  if (status === 'active') return t('seller.shared.status.active', {}, 'Active');
  if (status === 'sold') return t('seller.shared.status.sold', {}, 'Sold');
  return String(status || '');
};

export default function MyListings() {
  const [listings, setListings] = useState([]);
  const [stats, setStats] = useState({ active: 0, sold: 0, totalViews: 0 });
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('active');
  const { t, formatNumber, formatPrice } = useMarket();

  useEffect(() => {
    (async () => {
      try {
        const data = await listingApi.getMyListings();
        setListings(data.listings || []);
        setStats(data.stats || { active: 0, sold: 0, totalViews: 0 });
      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleMarkSold = async (id) => {
    try {
      await listingApi.markSold(id);
      setListings((prev) => prev.map((listing) => (listing._id === id ? { ...listing, status: 'sold' } : listing)));
      setStats((prev) => ({ ...prev, active: Math.max(0, prev.active - 1), sold: prev.sold + 1 }));
    } catch (error) {
      window.alert(error?.message || t('sellerListings.error.markSold', {}, 'Unable to mark listing as sold right now.'));
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm(t('sellerListings.confirmDelete', {}, 'Delete this listing permanently?'))) return;

    try {
      await listingApi.deleteListing(id);
      const removed = listings.find((listing) => listing._id === id);
      setListings((prev) => prev.filter((listing) => listing._id !== id));
      if (removed?.status === 'active') {
        setStats((prev) => ({ ...prev, active: Math.max(0, prev.active - 1) }));
      }
    } catch (error) {
      window.alert(error?.message || t('sellerListings.error.delete', {}, 'Unable to delete listing right now.'));
    }
  };

  const filtered = listings.filter((listing) => {
    if (tab === 'active') return listing.status === 'active';
    if (tab === 'sold') return listing.status === 'sold';
    return true;
  });

  const emptyTitleKey = tab === 'active'
    ? 'sellerListings.emptyTitle.active'
    : tab === 'sold'
      ? 'sellerListings.emptyTitle.sold'
      : 'sellerListings.emptyTitle.all';

  return (
    <div className="min-h-screen bg-[#04060f] text-slate-100">
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -left-20 top-[8%] h-[360px] w-[360px] rounded-full bg-cyan-500/15 blur-3xl" />
        <div className="absolute right-[-10%] top-[12%] h-[420px] w-[420px] rounded-full bg-violet-500/15 blur-3xl" />
      </div>

      <div className="border-b border-cyan-400/20 bg-gradient-to-r from-[#071123] via-[#0a1230] to-[#12102d] text-white">
        <div className="mx-auto max-w-6xl px-4 py-10">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-black sm:text-3xl">{t('sellerListings.title', {}, 'My Listings')}</h1>
              <p className="mt-1 text-cyan-100/70">
                {t('sellerListings.subtitle', {}, 'Manage active items, sold history, and marketplace visibility.')}
              </p>
            </div>
            <Link
              to="/sell"
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-300/40 bg-emerald-500/20 px-6 py-3 text-sm font-bold text-emerald-100 transition hover:bg-emerald-500/30 sm:w-auto"
            >
              <Plus className="h-5 w-5" />
              {t('sellerListings.newListing', {}, 'New Listing')}
            </Link>
          </div>

          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-cyan-300/25 bg-slate-900/45 p-4">
              <p className="text-sm text-cyan-100/70">{t('sellerListings.stats.active', {}, 'Active')}</p>
              <p className="text-2xl font-black">{formatNumber(stats.active)}</p>
            </div>
            <div className="rounded-2xl border border-cyan-300/25 bg-slate-900/45 p-4">
              <p className="text-sm text-cyan-100/70">{t('sellerListings.stats.sold', {}, 'Sold')}</p>
              <p className="text-2xl font-black">{formatNumber(stats.sold)}</p>
            </div>
            <div className="rounded-2xl border border-cyan-300/25 bg-slate-900/45 p-4">
              <p className="text-sm text-cyan-100/70">{t('sellerListings.stats.totalViews', {}, 'Total Views')}</p>
              <p className="text-2xl font-black">{formatNumber(stats.totalViews)}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="mb-6 inline-flex w-full overflow-x-auto rounded-2xl border border-slate-700 bg-slate-900/70 p-1 sm:w-fit">
          {['active', 'sold', 'all'].map((tabValue) => (
            <button
              key={tabValue}
              onClick={() => setTab(tabValue)}
              className={`rounded-xl px-6 py-2 text-sm font-bold transition ${
                tab === tabValue ? 'bg-cyan-400/20 text-cyan-100' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {getSellerTabLabel(tabValue, t)}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((item) => (
              <div key={item} className="flex animate-pulse flex-col gap-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-4 sm:flex-row">
                <div className="h-24 w-32 rounded-lg bg-slate-800" />
                <div className="flex-1 space-y-2">
                  <div className="h-5 w-1/2 rounded bg-slate-700" />
                  <div className="h-4 w-1/4 rounded bg-slate-700" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-3xl border border-slate-800 bg-slate-900/60 py-20 text-center">
            <Package className="mx-auto mb-4 h-16 w-16 text-slate-500" />
            <h3 className="mb-2 text-xl font-bold text-slate-100">{t(emptyTitleKey, {}, 'No listings yet')}</h3>
            <p className="mb-4 text-slate-400">
              {tab === 'active'
                ? t('sellerListings.emptyBodyActive', {}, 'Create your first live listing and start getting buyers.')
                : t('sellerListings.emptyBodyGeneric', {}, 'No items in this state yet.')}
            </p>
            {tab === 'active' && (
              <Link
                to="/sell"
                className="inline-flex items-center gap-2 rounded-xl border border-cyan-300/35 bg-cyan-400/15 px-6 py-3 text-sm font-bold text-cyan-100 transition hover:bg-cyan-400/25"
              >
                <Plus className="h-5 w-5" />
                {t('sellerListings.createListing', {}, 'Create listing')}
              </Link>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {filtered.map((listing) => (
              <div
                key={listing._id}
                className={`flex flex-col gap-4 rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-900/85 to-slate-950/95 p-4 sm:flex-row ${
                  listing.status === 'sold' ? 'opacity-70' : ''
                }`}
              >
                <Link to={`/listing/${listing._id}`} className="h-24 w-32 flex-shrink-0 overflow-hidden rounded-lg bg-slate-800/70">
                  <img src={listing.images?.[0] || '/placeholder.png'} alt={listing.title} className="h-full w-full object-cover" />
                </Link>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <Link to={`/listing/${listing._id}`} className="line-clamp-1 font-bold text-slate-100 transition hover:text-cyan-100">
                        {listing.title}
                      </Link>
                      <p className="mt-0.5 text-lg font-black text-slate-100">{formatPrice(listing.price, 'INR')}</p>
                    </div>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ${
                        listing.status === 'active'
                          ? 'border border-emerald-300/35 bg-emerald-500/15 text-emerald-100'
                          : listing.status === 'sold'
                            ? 'border border-cyan-300/35 bg-cyan-500/15 text-cyan-100'
                            : 'border border-slate-600 bg-slate-800 text-slate-300'
                      }`}
                    >
                      {getListingStatusLabel(listing.status, t)}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-400 sm:gap-4">
                    <span className="flex items-center gap-1">
                      <Eye className="h-3 w-3 text-cyan-300/80" />
                      {t('seller.shared.views', { count: formatNumber(listing.views || 0) }, `${formatNumber(listing.views || 0)} views`)}
                    </span>
                    <span className="flex items-center gap-1">
                      <MapPin className="h-3 w-3 text-cyan-300/80" />
                      {listing.location?.city || t('seller.shared.unknownCity', {}, 'Unknown city')}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3 text-cyan-300/80" />
                      {formatRelativeSellerTime(listing.createdAt, t, formatNumber)}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {listing.escrowOptIn && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-cyan-300/35 bg-cyan-500/15 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] text-cyan-100">
                        {t('sellerListings.escrowOptIn', {}, 'Escrow Opt-in')}
                      </span>
                    )}
                    {listing.escrow?.state && listing.escrow.state !== 'none' && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-violet-300/35 bg-violet-500/15 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] text-violet-100">
                        {t('sellerListings.escrowState', { state: listing.escrow.state }, `Escrow ${listing.escrow.state}`)}
                      </span>
                    )}
                  </div>
                  {listing.status === 'active' && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        onClick={() => handleMarkSold(listing._id)}
                        className="inline-flex items-center gap-1 rounded-lg border border-emerald-300/35 bg-emerald-500/15 px-3 py-1.5 text-xs font-bold text-emerald-100 transition hover:bg-emerald-500/25"
                      >
                        <CheckCircle className="h-3.5 w-3.5" />
                        {t('sellerListings.markSold', {}, 'Mark sold')}
                      </button>
                      <button
                        onClick={() => handleDelete(listing._id)}
                        className="inline-flex items-center gap-1 rounded-lg border border-red-300/35 bg-red-500/15 px-3 py-1.5 text-xs font-bold text-red-100 transition hover:bg-red-500/25"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        {t('sellerListings.delete', {}, 'Delete')}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
