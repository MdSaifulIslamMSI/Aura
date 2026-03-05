import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { MapPin, Eye, Package, ShieldCheck, Calendar, ArrowLeft, AlertTriangle } from 'lucide-react';
import { listingApi } from '@/services/api';

function timeAgo(dateStr) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const days = Math.floor(diff / 86400000);
    if (days < 1) return 'Today';
    if (days < 30) return `${days}d ago`;
    return `${Math.floor(days / 30)}mo ago`;
}

export default function SellerProfile() {
    const { id } = useParams();
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            try {
                const res = await listingApi.getSellerProfile(id);
                setData(res);
            } catch (err) {
                console.error(err);
            } finally {
                setLoading(false);
            }
        })();
    }, [id]);

    if (loading) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-[#04060f]">
                <div className="h-12 w-12 animate-spin rounded-full border-4 border-cyan-300/70 border-t-transparent" />
            </div>
        );
    }

    if (!data?.seller) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-[#04060f] px-4 text-center text-slate-100">
                <div>
                    <h2 className="mb-2 text-2xl font-black">Seller not found</h2>
                    <Link
                        to="/marketplace"
                        className="inline-flex items-center gap-2 rounded-xl border border-cyan-300/35 bg-cyan-400/10 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-400/20"
                    >
                        <ArrowLeft className="h-4 w-4" />
                        Back to Marketplace
                    </Link>
                </div>
            </div>
        );
    }

    const { seller, listings } = data;
    const memberSince = new Date(seller.createdAt).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    const passport = seller?.trustPassport || null;

    return (
        <div className="min-h-screen bg-[#04060f] text-slate-100">
            <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
                <div className="absolute -left-20 top-[10%] h-[360px] w-[360px] rounded-full bg-cyan-500/15 blur-3xl" />
                <div className="absolute right-[-8%] top-[15%] h-[400px] w-[400px] rounded-full bg-violet-500/15 blur-3xl" />
            </div>

            <div className="border-b border-cyan-400/20 bg-gradient-to-r from-[#071123] via-[#0a1230] to-[#12102d]">
                <div className="mx-auto max-w-6xl px-4 py-12">
                    <Link
                        to="/marketplace"
                        className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-cyan-100/70 transition hover:text-cyan-100"
                    >
                        <ArrowLeft className="h-4 w-4" />
                        Back to Marketplace
                    </Link>
                    <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
                        <div className="flex h-24 w-24 items-center justify-center rounded-2xl border border-cyan-300/35 bg-white/10 text-4xl font-black">
                            {seller.name?.charAt(0)?.toUpperCase() || 'S'}
                        </div>
                        <div>
                            <h1 className="flex items-center gap-3 text-3xl font-black">
                                {seller.name}
                                <ShieldCheck className="h-6 w-6 text-emerald-300" />
                            </h1>
                            <p className="mt-1 flex items-center gap-2 text-sm text-cyan-100/70">
                                <Calendar className="h-4 w-4" />
                                Member since {memberSince}
                            </p>
                            <div className="mt-4 grid grid-cols-2 gap-3 sm:flex sm:gap-4">
                                <div className="rounded-xl border border-cyan-300/25 bg-slate-900/45 px-4 py-2 text-center">
                                    <p className="text-2xl font-black">{seller.activeListings}</p>
                                    <p className="text-xs text-cyan-100/65">Active listings</p>
                                </div>
                                <div className="rounded-xl border border-cyan-300/25 bg-slate-900/45 px-4 py-2 text-center">
                                    <p className="text-2xl font-black">{seller.totalSold}</p>
                                    <p className="text-xs text-cyan-100/65">Sold items</p>
                                </div>
                                {passport && (
                                    <div className="rounded-xl border border-emerald-300/25 bg-emerald-500/10 px-4 py-2 text-center">
                                        <p className="text-2xl font-black text-emerald-100">{passport.trustScore}</p>
                                        <p className="text-xs text-emerald-100/70">Trust score</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="mx-auto max-w-6xl px-4 py-8">
                {passport && (
                    <div className="mb-8 rounded-3xl border border-cyan-300/20 bg-slate-900/70 p-6">
                        <h2 className="text-lg font-black mb-4">Seller Trust Passport</h2>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                            <div className="rounded-xl border border-white/10 bg-slate-950/40 px-4 py-3">
                                <p className="text-xs uppercase tracking-wider text-slate-400">Fraud Risk</p>
                                <p className="text-lg font-black uppercase">{passport.fraudRiskTier}</p>
                            </div>
                            <div className="rounded-xl border border-white/10 bg-slate-950/40 px-4 py-3">
                                <p className="text-xs uppercase tracking-wider text-slate-400">Dispute Rate</p>
                                <p className="text-lg font-black">{passport.disputeRate}%</p>
                            </div>
                            <div className="rounded-xl border border-white/10 bg-slate-950/40 px-4 py-3">
                                <p className="text-xs uppercase tracking-wider text-slate-400">On-time History</p>
                                <p className="text-lg font-black">{passport.onTimeHistory}%</p>
                            </div>
                            <div className="rounded-xl border border-white/10 bg-slate-950/40 px-4 py-3">
                                <p className="text-xs uppercase tracking-wider text-slate-400">Response SLA</p>
                                <p className="text-lg font-black">{passport.responseSlaHours}h</p>
                            </div>
                        </div>
                        {Array.isArray(passport.verifiedBadges) && passport.verifiedBadges.length > 0 && (
                            <div className="mt-4 flex flex-wrap gap-2">
                                {passport.verifiedBadges.map((badge) => (
                                    <span key={badge} className="inline-flex items-center gap-1 rounded-full border border-emerald-300/35 bg-emerald-500/15 px-3 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-emerald-100">
                                        <ShieldCheck className="h-3 w-3" />
                                        {badge.replace(/_/g, ' ')}
                                    </span>
                                ))}
                            </div>
                        )}
                        {passport.fraudRiskTier === 'high' && (
                            <p className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-amber-300/35 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-100">
                                <AlertTriangle className="h-3.5 w-3.5" />
                                High risk tier means extra care is recommended before payment.
                            </p>
                        )}
                    </div>
                )}

                <h2 className="mb-6 text-xl font-black">Active Listings ({listings.length})</h2>

                {listings.length === 0 ? (
                    <div className="rounded-3xl border border-slate-800 bg-slate-900/60 py-16 text-center">
                        <Package className="mx-auto mb-4 h-16 w-16 text-slate-500" />
                        <p className="text-slate-400">This seller has no active listings right now.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        {listings.map((listing) => (
                            <Link
                                key={listing._id}
                                to={`/listing/${listing._id}`}
                                className="group overflow-hidden rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-900/85 to-slate-950/95 transition hover:border-cyan-300/40 hover:shadow-[0_0_30px_rgba(34,211,238,0.14)]"
                            >
                                <div className="relative aspect-[4/3] overflow-hidden bg-slate-800/70">
                                    <img
                                        src={listing.images?.[0] || '/placeholder.png'}
                                        alt={listing.title}
                                        className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                                    />
                                    {listing.negotiable && (
                                        <span className="absolute left-2 top-2 rounded-full bg-emerald-500/90 px-2 py-0.5 text-[10px] font-black tracking-wide text-white">
                                            NEGOTIABLE
                                        </span>
                                    )}
                                </div>
                                <div className="p-3">
                                    <p className="text-lg font-black text-slate-100">Rs. {listing.price?.toLocaleString('en-IN')}</p>
                                    <h3 className="mt-1 line-clamp-1 text-sm font-medium text-slate-200">{listing.title}</h3>
                                    <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
                                        <span className="flex items-center gap-1">
                                            <MapPin className="h-3 w-3 text-cyan-300/80" />
                                            {listing.location?.city || 'Unknown'}
                                        </span>
                                        <span className="flex items-center gap-1">
                                            <Eye className="h-3 w-3 text-cyan-300/80" />
                                            {listing.views || 0}
                                        </span>
                                    </div>
                                    <div className="mt-1 text-xs text-slate-500">Posted {timeAgo(listing.createdAt)}</div>
                                </div>
                            </Link>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
