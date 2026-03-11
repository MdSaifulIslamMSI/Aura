import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
    ArrowRight,
    BookOpen,
    Car,
    Clock,
    Dumbbell,
    Eye,
    Flame,
    Gamepad2,
    Grid3X3,
    Home as HomeIcon,
    Laptop,
    List,
    Loader2,
    LocateFixed,
    MapPin,
    Package,
    Search,
    Shirt,
    ShieldCheck,
    SlidersHorizontal,
    Smartphone,
    Sofa,
    Sparkles,
    Store,
    Tag,
    TrendingUp,
    X,
} from 'lucide-react';
import PremiumSelect from '@/components/ui/premium-select';
import { useColorMode } from '@/context/ColorModeContext';
import { FIGMA_COLOR_MODE_OPTIONS } from '@/config/figmaTokens';
import { cn } from '@/lib/utils';
import { formatPrice } from '@/utils/format';
import { listingApi } from '@/services/api';
import RevealOnScroll from '@/components/shared/RevealOnScroll';
import { detectLocationFromGps } from '@/utils/geolocation';
import { buildListingSafetyLens, buildMarketplaceSafetySummary } from '@/utils/commerceIntelligence';

const CATEGORIES = [
    { value: '', label: 'All', subtitle: 'Every live lane', icon: Grid3X3, color: '#60a5fa' },
    { value: 'mobiles', label: 'Mobiles', subtitle: 'Phones and accessories', icon: Smartphone, color: '#3b82f6' },
    { value: 'laptops', label: 'Laptops', subtitle: 'Workstations and rigs', icon: Laptop, color: '#8b5cf6' },
    { value: 'electronics', label: 'Electronics', subtitle: 'Audio, cameras, wearables', icon: Package, color: '#06b6d4' },
    { value: 'vehicles', label: 'Vehicles', subtitle: 'Cars and bikes', icon: Car, color: '#f59e0b' },
    { value: 'furniture', label: 'Furniture', subtitle: 'Home and office pieces', icon: Sofa, color: '#10b981' },
    { value: 'fashion', label: 'Fashion', subtitle: 'Apparel and sneakers', icon: Shirt, color: '#ec4899' },
    { value: 'books', label: 'Books', subtitle: 'Study and collectible shelves', icon: BookOpen, color: '#6366f1' },
    { value: 'sports', label: 'Sports', subtitle: 'Fitness and training gear', icon: Dumbbell, color: '#14b8a6' },
    { value: 'home-appliances', label: 'Home', subtitle: 'Kitchen and utility', icon: HomeIcon, color: '#f97316' },
    { value: 'gaming', label: 'Gaming', subtitle: 'Consoles and accessories', icon: Gamepad2, color: '#a855f7' },
    { value: 'other', label: 'Other', subtitle: 'Rare and niche finds', icon: Tag, color: '#64748b' },
];

const SORTS = [
    { value: 'newest', label: 'Newest First' },
    { value: 'price-low', label: 'Price: Low to High' },
    { value: 'price-high', label: 'Price: High to Low' },
    { value: 'most-viewed', label: 'Most Viewed' },
];

const CONDITIONS = [
    { value: '', label: 'Any condition' },
    { value: 'new', label: 'Brand New' },
    { value: 'like-new', label: 'Like New' },
    { value: 'good', label: 'Good' },
    { value: 'fair', label: 'Fair' },
];

const HEAT_STYLE = {
    blazing: {
        ring: 'border-rose-400/40 bg-rose-500/10',
        badge: 'border-rose-300/40 bg-rose-500/25 text-rose-100',
        demandBar: 'from-rose-400 to-fuchsia-400',
    },
    rising: {
        ring: 'border-amber-300/40 bg-amber-500/10',
        badge: 'border-amber-300/40 bg-amber-500/25 text-amber-100',
        demandBar: 'from-amber-300 to-orange-300',
    },
    balanced: {
        ring: 'border-cyan-300/35 bg-cyan-500/10',
        badge: 'border-cyan-300/30 bg-cyan-500/20 text-cyan-100',
        demandBar: 'from-cyan-300 to-sky-300',
    },
    cooling: {
        ring: 'border-slate-500/35 bg-slate-600/10',
        badge: 'border-slate-500/35 bg-slate-600/25 text-slate-200',
        demandBar: 'from-slate-300 to-slate-400',
    },
};

const PROXIMITY_LABELS = {
    local: 'Local GPS zone',
    regional: 'Regional signal',
    national: 'National signal',
};

const TRUST_NOTES = [
    'Prioritize escrow-ready listings when payment will happen remotely.',
    'Use daylight meetup windows and public pickup points for direct handoffs.',
    'Listings with multiple real photos and verified sellers deserve the shortest trust path.',
];

function timeAgo(dateStr) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}d ago`;
    return `${Math.floor(days / 30)}mo ago`;
}

const hexToRgb = (hex) => {
    const normalized = String(hex || '').trim().replace('#', '');
    if (!normalized) return { r: 6, g: 182, b: 212 };

    const safeHex = normalized.length === 3
        ? normalized.split('').map((value) => `${value}${value}`).join('')
        : normalized.padEnd(6, '0').slice(0, 6);

    const value = Number.parseInt(safeHex, 16);
    if (!Number.isFinite(value)) return { r: 6, g: 182, b: 212 };

    return {
        r: (value >> 16) & 255,
        g: (value >> 8) & 255,
        b: value & 255,
    };
};

const toRgba = (hex, alpha) => {
    const { r, g, b } = hexToRgb(hex);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const getConditionTone = (condition = '') => {
    switch (String(condition || '').toLowerCase()) {
        case 'new':
            return 'border-sky-300/40 bg-sky-500/20 text-sky-50';
        case 'like-new':
            return 'border-violet-300/40 bg-violet-500/20 text-violet-50';
        case 'good':
            return 'border-amber-300/40 bg-amber-500/20 text-amber-50';
        default:
            return 'border-slate-500/35 bg-slate-700/40 text-slate-100';
    }
};

const StatCard = ({ label, value, detail, isWhiteMode, style }) => (
    <div
        className={cn(
            'rounded-[1.4rem] border p-4 backdrop-blur-xl',
            isWhiteMode ? 'bg-white/94 text-slate-900' : 'bg-[#091121]/74 text-white'
        )}
        style={style}
    >
        <p className={cn('text-[11px] font-black uppercase tracking-[0.22em]', isWhiteMode ? 'text-slate-500' : 'text-slate-400')}>
            {label}
        </p>
        <p className="mt-2 text-2xl font-black tracking-tight">{value}</p>
        <p className={cn('mt-1 text-sm', isWhiteMode ? 'text-slate-600' : 'text-slate-400')}>
            {detail}
        </p>
    </div>
);

const HotspotCard = ({ hotspot, getCategoryLabel }) => {
    const heatStyle = HEAT_STYLE[hotspot.heatLabel] || HEAT_STYLE.balanced;
    const demandBarWidth = `${Math.max(4, Number(hotspot.demandScore || 0))}%`;
    const supplyBarWidth = `${Math.max(4, Number(hotspot.supplyScore || 0))}%`;

    return (
        <article className={`rounded-[1.45rem] border p-4 transition hover:-translate-y-0.5 ${heatStyle.ring}`}>
            <div className="mb-3 flex items-start justify-between gap-2">
                <div>
                    <p className="text-sm font-black text-slate-100">{hotspot.city}</p>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-300/85">
                        {hotspot.state}
                    </p>
                    <p className="text-[11px] font-semibold text-cyan-100/80">
                        {getCategoryLabel(hotspot.category)}
                    </p>
                </div>
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] ${heatStyle.badge}`}>
                    {hotspot.heatLabel}
                </span>
            </div>

            <div className="mb-3 flex items-center justify-between text-xs text-slate-200/90">
                <span className="inline-flex items-center gap-1">
                    <Flame className="h-3.5 w-3.5 text-fuchsia-200" />
                    Heat {hotspot.heatScore}
                </span>
                <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3.5 w-3.5 text-cyan-200" />
                    {PROXIMITY_LABELS[hotspot.proximity] || 'Signal'}
                </span>
            </div>

            <div className="space-y-2">
                <div>
                    <div className="mb-1 flex items-center justify-between text-[11px] font-semibold text-slate-300/90">
                        <span className="inline-flex items-center gap-1">
                            <TrendingUp className="h-3.5 w-3.5 text-emerald-300" />
                            Demand
                        </span>
                        <span>{hotspot.demandLevel}</span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-950/60">
                        <div className={`h-2 rounded-full bg-gradient-to-r ${heatStyle.demandBar}`} style={{ width: demandBarWidth }} />
                    </div>
                </div>
                <div>
                    <div className="mb-1 flex items-center justify-between text-[11px] font-semibold text-slate-300/90">
                        <span className="inline-flex items-center gap-1">
                            <Package className="h-3.5 w-3.5 text-cyan-300" />
                            Supply
                        </span>
                        <span>{hotspot.supplyLevel}</span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-950/60">
                        <div className="h-2 rounded-full bg-gradient-to-r from-cyan-300 to-blue-300" style={{ width: supplyBarWidth }} />
                    </div>
                </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-slate-300/90">
                <div className="rounded-lg border border-slate-700/70 bg-slate-950/45 px-2 py-1.5">
                    <p className="font-semibold text-slate-400">Listings</p>
                    <p className="text-sm font-black text-slate-100">{hotspot.supplyCount}</p>
                </div>
                <div className="rounded-lg border border-slate-700/70 bg-slate-950/45 px-2 py-1.5">
                    <p className="font-semibold text-slate-400">Sold / 21d</p>
                    <p className="text-sm font-black text-slate-100">{hotspot.soldCount}</p>
                </div>
            </div>
        </article>
    );
};

const ListingCard = ({
    listing,
    safety,
    safetyMode,
    viewMode,
    prefetchListingDetails,
    isWhiteMode,
    accentPrimary,
    accentSecondary,
}) => {
    const cardStyle = isWhiteMode
        ? {
            background: `radial-gradient(circle at top right, ${toRgba(accentPrimary, 0.08)}, transparent 36%), linear-gradient(180deg, rgba(255,255,255,0.98), rgba(245,248,255,0.98))`,
            borderColor: toRgba(accentPrimary, 0.14),
            boxShadow: '0 18px 45px rgba(15,23,42,0.08)',
        }
        : {
            background: `radial-gradient(circle at top right, ${toRgba(accentPrimary, 0.16)}, transparent 34%), radial-gradient(circle at bottom left, ${toRgba(accentSecondary, 0.14)}, transparent 34%), linear-gradient(180deg, rgba(7,12,24,0.96), rgba(4,8,20,0.98))`,
            borderColor: toRgba(accentPrimary, 0.14),
            boxShadow: '0 24px 60px rgba(2,8,23,0.42)',
        };

    const mediaStyle = {
        borderColor: toRgba(accentPrimary, 0.12),
        background: `radial-gradient(circle at top, ${toRgba(accentPrimary, 0.18)}, transparent 56%), linear-gradient(180deg, ${toRgba(accentSecondary, 0.08)}, rgba(255,255,255,0.02))`,
    };

    return (
        <Link
            to={`/listing/${listing._id}`}
            onMouseEnter={() => prefetchListingDetails(listing._id)}
            onFocus={() => prefetchListingDetails(listing._id)}
            className={cn(
                'group overflow-hidden rounded-[1.7rem] border transition-all duration-300 hover:translate-y-[-2px]',
                viewMode === 'list' ? 'flex flex-col sm:flex-row' : 'flex flex-col'
            )}
            style={cardStyle}
        >
            <div
                className={cn(
                    'relative overflow-hidden border-b',
                    viewMode === 'list' ? 'aspect-[16/10] sm:w-[260px] sm:flex-shrink-0 sm:border-b-0 sm:border-r' : 'aspect-[4/3.05]'
                )}
                style={mediaStyle}
            >
                <img
                    src={listing.images?.[0] || '/placeholder.png'}
                    alt={listing.title}
                    className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.045]"
                />
                <div className="absolute inset-x-4 top-4 flex items-start justify-between gap-3">
                    <div className="flex flex-wrap gap-2">
                        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em] ${getConditionTone(listing.condition)}`}>
                            {String(listing.condition || 'fair').replace('-', ' ')}
                        </span>
                        {listing.escrowOptIn ? (
                            <span className="inline-flex items-center gap-1 rounded-full border border-cyan-200/40 bg-cyan-500/25 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-cyan-100">
                                <ShieldCheck className="h-3 w-3" />
                                Escrow
                            </span>
                        ) : null}
                    </div>
                    {listing.negotiable ? (
                        <span className="rounded-full bg-emerald-500/90 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-white">
                            Negotiable
                        </span>
                    ) : null}
                </div>
            </div>

            <div className="flex flex-1 flex-col p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <p className={cn('text-[11px] font-black uppercase tracking-[0.22em]', isWhiteMode ? 'text-slate-500' : 'text-slate-400')}>
                            {listing.category || 'Marketplace'}
                        </p>
                        <h3 className={cn('mt-2 line-clamp-2 text-lg font-black leading-tight tracking-tight', isWhiteMode ? 'text-slate-950' : 'text-white')}>
                            {listing.title}
                        </h3>
                    </div>
                    {listing.seller?.isVerified ? (
                        <span className="inline-flex flex-shrink-0 items-center gap-1 rounded-full border border-emerald-400/35 bg-emerald-500/12 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-emerald-100">
                            <ShieldCheck className="h-3 w-3" />
                            Verified
                        </span>
                    ) : null}
                </div>

                <div className="mt-4 flex items-end justify-between gap-3">
                    <div>
                        <p className={cn('text-[1.7rem] font-black tracking-tight', isWhiteMode ? 'text-slate-950' : 'text-white')}>
                            {formatPrice(Number(listing.price || 0))}
                        </p>
                        {listing.seller?.name ? (
                            <p className={cn('mt-1 text-xs font-medium', isWhiteMode ? 'text-slate-600' : 'text-slate-400')}>
                                Seller: {listing.seller.name}
                            </p>
                        ) : null}
                    </div>
                    {safetyMode && safety ? (
                        <div className="rounded-full border border-cyan-300/30 bg-cyan-500/12 px-3 py-1.5 text-right">
                            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-cyan-100">Safety</p>
                            <p className="text-sm font-black text-cyan-50">{safety.score}</p>
                        </div>
                    ) : null}
                </div>

                <div className={cn('mt-4 grid gap-2 text-xs', isWhiteMode ? 'text-slate-600' : 'text-slate-400')}>
                    <span className="inline-flex items-center gap-2">
                        <MapPin className="h-3.5 w-3.5" style={{ color: accentPrimary }} />
                        {listing.location?.city || 'Unknown city'}
                    </span>
                    <span className="inline-flex items-center gap-2">
                        <Clock className="h-3.5 w-3.5" style={{ color: accentPrimary }} />
                        {timeAgo(listing.createdAt)}
                    </span>
                    <span className="inline-flex items-center gap-2">
                        <Eye className="h-3.5 w-3.5" style={{ color: accentPrimary }} />
                        {(listing.views || 0).toLocaleString('en-IN')} views
                    </span>
                </div>

                {safetyMode && safety ? (
                    <div className={cn('mt-4 rounded-[1.15rem] border px-3.5 py-3 text-sm', isWhiteMode ? 'bg-slate-50 text-slate-700' : 'bg-white/[0.04] text-slate-200')} style={{ borderColor: toRgba(accentPrimary, 0.16) }}>
                        {safety.highlights[0] || safety.watchouts[0] || 'Review the listing carefully before payment.'}
                    </div>
                ) : null}

                <div className="mt-4 inline-flex items-center gap-2 text-sm font-black uppercase tracking-[0.18em]" style={{ color: accentPrimary }}>
                    Open listing
                    <ArrowRight className="h-4 w-4" />
                </div>
            </div>
        </Link>
    );
};

export default function Marketplace() {
    const { colorMode } = useColorMode();
    const [listings, setListings] = useState([]);
    const [loading, setLoading] = useState(true);
    const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
    const [showFilters, setShowFilters] = useState(false);
    const [viewMode, setViewMode] = useState('grid');
    const [locatingCity, setLocatingCity] = useState(false);
    const [locationHint, setLocationHint] = useState('');
    const [locationError, setLocationError] = useState('');
    const [gpsContext, setGpsContext] = useState(null);
    const [hotspots, setHotspots] = useState([]);
    const [hotspotsLoading, setHotspotsLoading] = useState(false);
    const [hotspotsError, setHotspotsError] = useState('');
    const [safetyMode, setSafetyMode] = useState(true);

    const [filters, setFilters] = useState({
        category: '',
        city: '',
        condition: '',
        search: '',
        minPrice: '',
        maxPrice: '',
        sort: 'newest',
        page: 1,
    });

    const fetchListings = useCallback(async () => {
        setLoading(true);
        try {
            const data = await listingApi.getListings(filters);
            setListings(data.listings || []);
            setPagination(data.pagination || { page: 1, pages: 1, total: 0 });
        } catch (error) {
            console.error('Failed to fetch listings:', error);
        } finally {
            setLoading(false);
        }
    }, [filters]);

    useEffect(() => {
        fetchListings();
    }, [fetchListings]);

    const fetchHotspots = useCallback(async () => {
        setHotspotsLoading(true);
        setHotspotsError('');
        try {
            const data = await listingApi.getHotspots({
                category: filters.category || undefined,
                city: filters.city || gpsContext?.city || undefined,
                state: gpsContext?.state || undefined,
                limit: 8,
                windowDays: 21,
            });
            setHotspots(Array.isArray(data?.hotspots) ? data.hotspots : []);
        } catch (error) {
            setHotspotsError(error?.message || 'Hotspot telemetry is unavailable right now.');
            setHotspots([]);
        } finally {
            setHotspotsLoading(false);
        }
    }, [filters.category, filters.city, gpsContext?.city, gpsContext?.state]);

    useEffect(() => {
        fetchHotspots();
    }, [fetchHotspots]);

    const updateFilter = (key, value) => {
        if (key === 'city') {
            setLocationHint('');
            setLocationError('');
            setGpsContext(null);
        }
        setFilters((prev) => ({ ...prev, [key]: value, page: 1 }));
    };

    const clearFilters = () => {
        setFilters({
            category: '',
            city: '',
            condition: '',
            search: '',
            minPrice: '',
            maxPrice: '',
            sort: 'newest',
            page: 1,
        });
        setGpsContext(null);
        setLocationHint('');
        setLocationError('');
    };

    const activeFilterCount = [
        filters.category,
        filters.city,
        filters.condition,
        filters.search,
        filters.minPrice,
        filters.maxPrice,
    ].filter(Boolean).length;

    const useCurrentCity = async () => {
        setLocatingCity(true);
        setLocationHint('');
        setLocationError('');

        try {
            const detected = await detectLocationFromGps();
            const detectedCity = detected.city || detected.state;
            if (!detectedCity) {
                throw new Error('Could not detect city from your location.');
            }

            setGpsContext({
                city: detected.city || '',
                state: detected.state || '',
                latitude: detected.latitude,
                longitude: detected.longitude,
                accuracy: detected.accuracy,
                confidence: detected.confidence,
                source: `${detected.positionSource || 'gps'}:${detected.geocodeSource || 'unknown'}`,
            });
            setFilters((prev) => ({ ...prev, city: detectedCity, page: 1 }));
            const qualityBits = [
                Number.isFinite(detected.confidence) ? `confidence ${detected.confidence}%` : '',
                Number.isFinite(detected.accuracy) && detected.accuracy > 0 ? `${Math.round(detected.accuracy)}m accuracy` : '',
            ].filter(Boolean);
            setLocationHint(
                `Using GPS city: ${detectedCity}${detected.state ? `, ${detected.state}` : ''}${qualityBits.length ? ` (${qualityBits.join(', ')})` : ''}`
            );
        } catch (error) {
            setLocationError(error?.message || 'Unable to detect your city right now.');
        } finally {
            setLocatingCity(false);
        }
    };

    const getCategoryLabel = (categoryValue) =>
        CATEGORIES.find((item) => item.value === categoryValue)?.label || 'All Categories';

    const prefetchListingDetails = (listingId) => {
        if (!listingId) return;
        listingApi.prefetchListingById(listingId);
    };

    const hotspotMap = useMemo(() => new Map(
        hotspots.map((hotspot) => [
            `${String(hotspot?.city || '').toLowerCase()}::${String(hotspot?.category || '').toLowerCase()}`,
            hotspot,
        ])
    ), [hotspots]);

    const enhancedListings = useMemo(() => listings.map((listing) => {
        const hotspot = hotspotMap.get(
            `${String(listing?.location?.city || '').toLowerCase()}::${String(listing?.category || '').toLowerCase()}`
        ) || null;
        return {
            listing,
            safety: buildListingSafetyLens({ listing, hotspot }),
        };
    }), [hotspotMap, listings]);

    const safetySummary = useMemo(() => buildMarketplaceSafetySummary({
        listings,
        hotspots,
        city: filters.city || gpsContext?.city || '',
    }), [filters.city, gpsContext?.city, hotspots, listings]);

    const isWhiteMode = colorMode === 'white';
    const modePalette = FIGMA_COLOR_MODE_OPTIONS.find((mode) => mode.value === colorMode) || FIGMA_COLOR_MODE_OPTIONS[0];
    const accentPrimary = modePalette.primary;
    const accentSecondary = modePalette.secondary;

    const shellClass = isWhiteMode ? 'bg-[#eef4ff] text-slate-900' : 'bg-[#050816] text-slate-100';
    const panelClass = isWhiteMode
        ? 'border-slate-200 bg-white/96 shadow-[0_24px_70px_rgba(15,23,42,0.08)]'
        : 'border-white/10 bg-[#07101f]/80 shadow-[0_24px_80px_rgba(2,8,23,0.45)]';
    const mutedTextClass = isWhiteMode ? 'text-slate-600' : 'text-slate-400';
    const subtleTextClass = isWhiteMode ? 'text-slate-500' : 'text-slate-500';
    const labelClass = isWhiteMode ? 'text-slate-700' : 'text-slate-200';
    const fieldClass = isWhiteMode
        ? 'border-slate-200 bg-white text-slate-900 placeholder:text-slate-400'
        : 'border-white/10 bg-[#091224]/90 text-white placeholder:text-slate-500';
    const chipClass = isWhiteMode ? 'border-slate-200 bg-white text-slate-700' : 'border-white/10 bg-white/[0.04] text-slate-200';

    const heroStyle = isWhiteMode
        ? {
            background: `radial-gradient(circle at top left, ${toRgba(accentPrimary, 0.12)}, transparent 30%), radial-gradient(circle at top right, ${toRgba(accentSecondary, 0.14)}, transparent 26%), linear-gradient(180deg, rgba(255,255,255,0.96), rgba(244,247,255,0.98))`,
            borderColor: toRgba(accentPrimary, 0.18),
        }
        : {
            background: `radial-gradient(circle at top left, ${toRgba(accentPrimary, 0.18)}, transparent 28%), radial-gradient(circle at top right, ${toRgba(accentSecondary, 0.18)}, transparent 26%), linear-gradient(135deg, rgba(5,10,22,0.96), rgba(8,17,34,0.94))`,
            borderColor: toRgba(accentPrimary, 0.18),
        };

    const sectionStyle = { borderColor: toRgba(accentPrimary, 0.14) };

    const accentFillStyle = {
        backgroundImage: `linear-gradient(90deg, ${accentPrimary}, ${accentSecondary})`,
        color: isWhiteMode ? '#ffffff' : '#020617',
    };

    const accentOutlineStyle = {
        borderColor: toRgba(accentPrimary, isWhiteMode ? 0.28 : 0.32),
        background: isWhiteMode ? toRgba(accentPrimary, 0.08) : toRgba(accentPrimary, 0.12),
        color: isWhiteMode ? accentPrimary : '#f8fafc',
    };

    const selectedCategory = CATEGORIES.find((item) => item.value === filters.category) || CATEGORIES[0];
    const activeEntries = safetyMode ? enhancedListings : listings.map((listing) => ({ listing, safety: null }));
    const activeFilterLabels = [
        filters.category ? getCategoryLabel(filters.category) : '',
        filters.city ? `City: ${filters.city}` : '',
        filters.condition ? `Condition: ${CONDITIONS.find((item) => item.value === filters.condition)?.label || filters.condition}` : '',
        filters.minPrice ? `Min ${formatPrice(Number(filters.minPrice || 0))}` : '',
        filters.maxPrice ? `Max ${formatPrice(Number(filters.maxPrice || 0))}` : '',
    ].filter(Boolean);

    const renderFilterPanel = (extraClassName = '') => (
        <section className={cn('rounded-[1.75rem] border p-5', panelClass, extraClassName)} style={sectionStyle}>
            <div className="flex items-start justify-between gap-3">
                <div>
                    <p className={cn('text-[11px] font-black uppercase tracking-[0.22em]', subtleTextClass)}>
                        Filter deck
                    </p>
                    <h2 className={cn('mt-2 text-xl font-black tracking-tight', isWhiteMode ? 'text-slate-950' : 'text-white')}>
                        Refine the market view.
                    </h2>
                </div>
                <span className={cn('rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em]', chipClass)} style={sectionStyle}>
                    {activeFilterCount} active
                </span>
            </div>

            <div className="mt-5 space-y-4">
                <div>
                    <label className={cn('mb-2 block text-xs font-black uppercase tracking-[0.18em]', labelClass)}>Condition</label>
                    <PremiumSelect
                        value={filters.condition}
                        onChange={(event) => updateFilter('condition', event.target.value)}
                        className={cn('h-12 w-full rounded-[1rem] border px-3 text-sm outline-none transition-all', fieldClass)}
                    >
                        {CONDITIONS.map((condition) => (
                            <option key={condition.value} value={condition.value} className={isWhiteMode ? 'bg-white' : 'bg-slate-900'}>
                                {condition.label}
                            </option>
                        ))}
                    </PremiumSelect>
                </div>

                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
                    <div>
                        <label className={cn('mb-2 block text-xs font-black uppercase tracking-[0.18em]', labelClass)}>Min price</label>
                        <input
                            type="number"
                            value={filters.minPrice}
                            onChange={(event) => updateFilter('minPrice', event.target.value)}
                            placeholder="0"
                            className={cn('h-12 w-full rounded-[1rem] border px-3 text-sm outline-none transition-all', fieldClass)}
                        />
                    </div>
                    <div>
                        <label className={cn('mb-2 block text-xs font-black uppercase tracking-[0.18em]', labelClass)}>Max price</label>
                        <input
                            type="number"
                            value={filters.maxPrice}
                            onChange={(event) => updateFilter('maxPrice', event.target.value)}
                            placeholder="No limit"
                            className={cn('h-12 w-full rounded-[1rem] border px-3 text-sm outline-none transition-all', fieldClass)}
                        />
                    </div>
                </div>

                <div>
                    <label className={cn('mb-2 block text-xs font-black uppercase tracking-[0.18em]', labelClass)}>City</label>
                    <input
                        type="text"
                        value={filters.city}
                        onChange={(event) => updateFilter('city', event.target.value)}
                        placeholder="Any city"
                        className={cn('h-12 w-full rounded-[1rem] border px-3 text-sm outline-none transition-all', fieldClass)}
                    />
                </div>
            </div>

            {activeFilterLabels.length > 0 ? (
                <div className="mt-5 flex flex-wrap gap-2">
                    {activeFilterLabels.map((label) => (
                        <span key={label} className={cn('rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em]', chipClass)} style={sectionStyle}>
                            {label}
                        </span>
                    ))}
                </div>
            ) : null}

            <button
                type="button"
                onClick={clearFilters}
                className={cn(
                    'mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full border px-5 py-3 text-sm font-black uppercase tracking-[0.18em] transition-all',
                    isWhiteMode
                        ? 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                        : 'border-white/10 bg-white/[0.04] text-slate-100 hover:bg-white/[0.07]'
                )}
                style={sectionStyle}
            >
                <X className="h-4 w-4" />
                Reset filters
            </button>
        </section>
    );

    return (
        <div className={cn('premium-page-shell min-h-screen pb-20', shellClass)}>
            <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
                <div
                    className="absolute inset-0"
                    style={{
                        background: isWhiteMode
                            ? `radial-gradient(circle at top left, ${toRgba(accentPrimary, 0.12)}, transparent 26%), radial-gradient(circle at top right, ${toRgba(accentSecondary, 0.14)}, transparent 24%), linear-gradient(180deg, #f5f8ff 0%, #eef4ff 48%, #f8fbff 100%)`
                            : `radial-gradient(circle at top left, ${toRgba(accentPrimary, 0.16)}, transparent 24%), radial-gradient(circle at top right, ${toRgba(accentSecondary, 0.14)}, transparent 22%), linear-gradient(180deg, #040611 0%, #050816 42%, #070d1d 100%)`,
                    }}
                />
                <div className={cn('absolute inset-0 opacity-40 [background-size:52px_52px]', isWhiteMode ? 'bg-[linear-gradient(rgba(148,163,184,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.08)_1px,transparent_1px)]' : 'bg-[linear-gradient(rgba(148,163,184,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.05)_1px,transparent_1px)]')} />
            </div>

            <div className="premium-page-frame pt-6">
                <RevealOnScroll anchorId="marketplace-hero" anchorLabel="Marketplace Hero">
                    <section className={cn('premium-hero-panel premium-grid-backdrop overflow-hidden rounded-[2.2rem] border px-6 py-7 sm:px-8 sm:py-8', panelClass)} style={heroStyle}>
                        <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_320px]">
                            <div>
                                <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-[0.24em]" style={accentOutlineStyle}>
                                    <Sparkles className="h-4 w-4" />
                                    Marketplace command deck
                                </div>
                                <h1 className={cn('mt-5 max-w-3xl text-4xl font-black leading-[0.95] tracking-tight sm:text-5xl', isWhiteMode ? 'text-slate-950' : 'text-white')}>
                                    Browse the local market with trust signals built in.
                                </h1>
                                <p className={cn('mt-4 max-w-3xl text-sm leading-7 sm:text-base', mutedTextClass)}>
                                    Aura Marketplace now behaves like a premium acquisition desk: sharper search, location-aware discovery, live demand hotspots, and seller safety cues that stay visible while you browse.
                                </p>

                                <div className="mt-6 grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px_auto_auto]">
                                    <div className="relative">
                                        <Search className={cn('pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2', subtleTextClass)} />
                                        <input
                                            type="text"
                                            value={filters.search}
                                            onChange={(event) => updateFilter('search', event.target.value)}
                                            placeholder="Search by title, category, brand, or keyword"
                                            className={cn('h-12 w-full rounded-[1rem] border pl-12 pr-4 text-sm outline-none transition-all', fieldClass)}
                                        />
                                    </div>
                                    <div className="relative">
                                        <MapPin className={cn('pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2', subtleTextClass)} />
                                        <input
                                            type="text"
                                            value={filters.city}
                                            onChange={(event) => updateFilter('city', event.target.value)}
                                            placeholder="City"
                                            className={cn('h-12 w-full rounded-[1rem] border pl-12 pr-4 text-sm outline-none transition-all', fieldClass)}
                                        />
                                    </div>
                                    <button
                                        type="button"
                                        onClick={useCurrentCity}
                                        disabled={locatingCity}
                                        className="inline-flex h-12 items-center justify-center gap-2 rounded-[1rem] px-4 text-sm font-black uppercase tracking-[0.16em] transition-all disabled:cursor-not-allowed disabled:opacity-60"
                                        style={accentFillStyle}
                                    >
                                        {locatingCity ? <Loader2 className="h-4 w-4 animate-spin" /> : <LocateFixed className="h-4 w-4" />}
                                        {locatingCity ? 'Detecting' : 'Near me'}
                                    </button>
                                    <Link
                                        to="/sell"
                                        className={cn(
                                            'inline-flex h-12 items-center justify-center gap-2 rounded-[1rem] border px-4 text-sm font-black uppercase tracking-[0.16em] transition-all',
                                            chipClass
                                        )}
                                        style={sectionStyle}
                                    >
                                        <Store className="h-4 w-4" />
                                        Sell now
                                    </Link>
                                </div>

                                {(locationHint || locationError) && (
                                    <p className={cn('mt-3 text-sm font-medium', locationError ? 'text-rose-300' : (isWhiteMode ? 'text-emerald-600' : 'text-emerald-200'))}>
                                        {locationError || locationHint}
                                    </p>
                                )}

                                <div className="mt-6 flex flex-wrap gap-2">
                                    {CATEGORIES.map((category) => {
                                        const Icon = category.icon;
                                        const active = filters.category === category.value;
                                        return (
                                            <button
                                                key={category.value || 'all'}
                                                type="button"
                                                onClick={() => updateFilter('category', category.value)}
                                                className={cn(
                                                    'inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition-all',
                                                    active ? 'translate-y-[-1px]' : chipClass
                                                )}
                                                style={active ? {
                                                    borderColor: toRgba(category.color, 0.34),
                                                    background: isWhiteMode ? toRgba(category.color, 0.08) : toRgba(category.color, 0.14),
                                                    color: isWhiteMode ? category.color : '#f8fafc',
                                                    boxShadow: `0 14px 34px ${toRgba(category.color, 0.16)}`,
                                                } : sectionStyle}
                                            >
                                                <Icon className="h-4 w-4" style={active ? { color: isWhiteMode ? category.color : '#f8fafc' } : { color: category.color }} />
                                                {category.label}
                                            </button>
                                        );
                                    })}
                                </div>

                                <div className="mt-6 flex flex-wrap items-center gap-3">
                                    <button
                                        type="button"
                                        onClick={() => setSafetyMode((value) => !value)}
                                        className={cn(
                                            'rounded-full border px-4 py-2 text-xs font-black uppercase tracking-[0.16em] transition-all',
                                            safetyMode ? '' : chipClass
                                        )}
                                        style={safetyMode ? accentOutlineStyle : sectionStyle}
                                    >
                                        Safety mode {safetyMode ? 'on' : 'off'}
                                    </button>
                                    <span className={cn('rounded-full border px-4 py-2 text-xs font-semibold', chipClass)} style={sectionStyle}>
                                        {selectedCategory.label} lane
                                    </span>
                                    <span className={cn('rounded-full border px-4 py-2 text-xs font-semibold', chipClass)} style={sectionStyle}>
                                        {(pagination.total || 0).toLocaleString('en-IN')} live listings
                                    </span>
                                </div>
                            </div>

                            <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-1">
                                <StatCard
                                    label="Average safety"
                                    value={safetySummary.averageSafety || 0}
                                    detail="Composite marketplace trust score"
                                    style={sectionStyle}
                                    isWhiteMode={isWhiteMode}
                                />
                                <StatCard
                                    label="Escrow coverage"
                                    value={`${safetySummary.escrowCoverage || 0}%`}
                                    detail="Listings with payment protection enabled"
                                    style={sectionStyle}
                                    isWhiteMode={isWhiteMode}
                                />
                                <StatCard
                                    label="Verified sellers"
                                    value={`${safetySummary.verifiedSellerRate || 0}%`}
                                    detail="Identity-cleared sellers in the current result set"
                                    style={sectionStyle}
                                    isWhiteMode={isWhiteMode}
                                />
                            </div>
                        </div>
                    </section>
                </RevealOnScroll>

                <div className="mt-8 grid gap-8 xl:grid-cols-[310px_minmax(0,1fr)]">
                    <aside className={cn('space-y-6', showFilters ? 'block' : 'hidden xl:block')}>
                        {renderFilterPanel()}

                        <section className={cn('rounded-[1.75rem] border p-5', panelClass)} style={sectionStyle}>
                            <p className={cn('text-[11px] font-black uppercase tracking-[0.22em]', subtleTextClass)}>
                                Trust notes
                            </p>
                            <h2 className={cn('mt-2 text-xl font-black tracking-tight', isWhiteMode ? 'text-slate-950' : 'text-white')}>
                                Buyer discipline stays premium.
                            </h2>
                            <p className={cn('mt-3 text-sm leading-6', mutedTextClass)}>
                                {safetySummary.meetupBrief}
                            </p>
                            <div className="mt-4 space-y-3">
                                {TRUST_NOTES.map((note) => (
                                    <div key={note} className={cn('rounded-[1.1rem] border px-4 py-3 text-sm leading-6', chipClass)} style={sectionStyle}>
                                        {note}
                                    </div>
                                ))}
                            </div>
                        </section>
                    </aside>

                    <div className="min-w-0 space-y-6">
                        <RevealOnScroll anchorId="marketplace-pulse" anchorLabel="Market Pulse">
                            <section className={cn('rounded-[2rem] border p-5 sm:p-6', panelClass)} style={sectionStyle}>
                                <div className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-end sm:justify-between" style={{ borderColor: toRgba(accentPrimary, 0.14) }}>
                                    <div>
                                        <p className={cn('text-[11px] font-black uppercase tracking-[0.22em]', subtleTextClass)}>
                                            Market pulse
                                        </p>
                                        <h2 className={cn('mt-2 text-2xl font-black tracking-tight', isWhiteMode ? 'text-slate-950' : 'text-white')}>
                                            Live demand and supply hotspots
                                        </h2>
                                    </div>
                                    <div className={cn('rounded-full border px-4 py-2 text-xs font-semibold', chipClass)} style={sectionStyle}>
                                        {filters.city || gpsContext?.city || 'All cities'} | {selectedCategory.label}
                                    </div>
                                </div>

                                <p className={cn('mt-4 text-sm leading-6', mutedTextClass)}>
                                    GPS-aware hotspot signals show where listings are moving, where demand is climbing, and which categories feel hottest in the current market window.
                                </p>

                                {hotspotsLoading ? (
                                    <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                                        {[...Array(4)].map((_, index) => (
                                            <div key={index} className={cn('rounded-[1.45rem] border p-4 animate-pulse', chipClass)} style={sectionStyle}>
                                                <div className="h-4 w-2/3 rounded bg-slate-700/50" />
                                                <div className="mt-4 h-8 w-20 rounded bg-slate-700/50" />
                                                <div className="mt-4 h-2 w-full rounded bg-slate-700/50" />
                                                <div className="mt-2 h-2 w-4/5 rounded bg-slate-700/50" />
                                            </div>
                                        ))}
                                    </div>
                                ) : hotspotsError ? (
                                    <div className={cn('mt-5 rounded-[1.35rem] border px-4 py-3 text-sm', isWhiteMode ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-rose-400/25 bg-rose-500/10 text-rose-100')}>
                                        {hotspotsError}
                                    </div>
                                ) : hotspots.length === 0 ? (
                                    <div className={cn('mt-5 rounded-[1.35rem] border px-4 py-5 text-sm', chipClass)} style={sectionStyle}>
                                        Not enough live marketplace signals for this filter yet. Try another city or broaden the lane.
                                    </div>
                                ) : (
                                    <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                                        {hotspots.map((hotspot) => (
                                            <HotspotCard key={`${hotspot.city}-${hotspot.state}-${hotspot.category}`} hotspot={hotspot} getCategoryLabel={getCategoryLabel} />
                                        ))}
                                    </div>
                                )}
                            </section>
                        </RevealOnScroll>

                        <section className={cn('rounded-[2rem] border p-5 sm:p-6', panelClass)} style={sectionStyle}>
                            <div className="flex flex-col gap-4 border-b pb-5 lg:flex-row lg:items-center lg:justify-between" style={{ borderColor: toRgba(accentPrimary, 0.14) }}>
                                <div className="flex flex-wrap items-center gap-3">
                                    <div className={cn('rounded-full border px-4 py-2 text-xs font-semibold', chipClass)} style={sectionStyle}>
                                        {(pagination.total || 0).toLocaleString('en-IN')} listings
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setShowFilters((value) => !value)}
                                        className={cn(
                                            'inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-black uppercase tracking-[0.16em] transition-all xl:hidden',
                                            chipClass
                                        )}
                                        style={sectionStyle}
                                    >
                                        <SlidersHorizontal className="h-4 w-4" />
                                        {showFilters ? 'Hide filters' : 'Show filters'}
                                    </button>
                                    {activeFilterLabels.length > 0 ? (
                                        <div className="flex flex-wrap gap-2">
                                            {activeFilterLabels.map((label) => (
                                                <span key={label} className={cn('rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em]', chipClass)} style={sectionStyle}>
                                                    {label}
                                                </span>
                                            ))}
                                        </div>
                                    ) : null}
                                </div>

                                <div className="flex flex-wrap items-center gap-3">
                                    <div className={cn('flex items-center rounded-full border p-1', chipClass)} style={sectionStyle}>
                                        <button
                                            type="button"
                                            onClick={() => setViewMode('grid')}
                                            className={cn(
                                                'rounded-full p-2 transition-all',
                                                viewMode === 'grid' ? 'shadow-sm' : ''
                                            )}
                                            style={viewMode === 'grid' ? accentOutlineStyle : undefined}
                                        >
                                            <Grid3X3 className="h-4 w-4" />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setViewMode('list')}
                                            className={cn(
                                                'rounded-full p-2 transition-all',
                                                viewMode === 'list' ? 'shadow-sm' : ''
                                            )}
                                            style={viewMode === 'list' ? accentOutlineStyle : undefined}
                                        >
                                            <List className="h-4 w-4" />
                                        </button>
                                    </div>
                                    <PremiumSelect
                                        value={filters.sort}
                                        onChange={(event) => updateFilter('sort', event.target.value)}
                                        className={cn('h-11 rounded-full border px-4 text-sm font-medium outline-none transition-all', fieldClass)}
                                    >
                                        {SORTS.map((sort) => (
                                            <option key={sort.value} value={sort.value} className={isWhiteMode ? 'bg-white' : 'bg-slate-900'}>
                                                {sort.label}
                                            </option>
                                        ))}
                                    </PremiumSelect>
                                    {activeFilterCount > 0 ? (
                                        <button
                                            type="button"
                                            onClick={clearFilters}
                                            className={cn(
                                                'inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-black uppercase tracking-[0.16em] transition-all',
                                                isWhiteMode
                                                    ? 'border-rose-200 bg-rose-50 text-rose-700'
                                                    : 'border-rose-400/25 bg-rose-500/10 text-rose-100'
                                            )}
                                        >
                                            <X className="h-4 w-4" />
                                            Clear all
                                        </button>
                                    ) : null}
                                </div>
                            </div>

                            {showFilters ? (
                                <div className="mt-5 xl:hidden">
                                    {renderFilterPanel()}
                                </div>
                            ) : null}

                            <RevealOnScroll anchorId="marketplace-safety" anchorLabel="Safety Mode" className="mt-5 rounded-[1.6rem] border p-5" style={{
                                borderColor: toRgba(accentSecondary, 0.16),
                                background: isWhiteMode
                                    ? `linear-gradient(135deg, ${toRgba(accentSecondary, 0.08)}, rgba(255,255,255,0.98))`
                                    : `linear-gradient(135deg, ${toRgba(accentSecondary, 0.12)}, rgba(255,255,255,0.02))`,
                            }}>
                                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                                    <div className="max-w-3xl">
                                        <p className={cn('text-[11px] font-black uppercase tracking-[0.22em]', subtleTextClass)}>
                                            Local commerce safety mode
                                        </p>
                                        <h2 className={cn('mt-2 text-xl font-black tracking-tight', isWhiteMode ? 'text-slate-950' : 'text-white')}>
                                            Meetup, escrow, and seller-risk cues stay visible while browsing.
                                        </h2>
                                        <p className={cn('mt-2 text-sm leading-6', mutedTextClass)}>
                                            {safetySummary.meetupBrief}
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setSafetyMode((value) => !value)}
                                        className="inline-flex items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-black uppercase tracking-[0.16em] transition-all"
                                        style={safetyMode ? accentFillStyle : accentOutlineStyle}
                                    >
                                        <ShieldCheck className="h-4 w-4" />
                                        {safetyMode ? 'Safety mode on' : 'Enable safety mode'}
                                    </button>
                                </div>

                                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                                    <StatCard
                                        label="Average safety"
                                        value={safetySummary.averageSafety || 0}
                                        detail="Composite trust score for visible listings"
                                        style={sectionStyle}
                                        isWhiteMode={isWhiteMode}
                                    />
                                    <StatCard
                                        label="High safety"
                                        value={safetySummary.highSafetyCount || 0}
                                        detail="Listings currently above the strong-trust threshold"
                                        style={sectionStyle}
                                        isWhiteMode={isWhiteMode}
                                    />
                                    <StatCard
                                        label="Escrow"
                                        value={`${safetySummary.escrowCoverage || 0}%`}
                                        detail="Coverage across the current result page"
                                        style={sectionStyle}
                                        isWhiteMode={isWhiteMode}
                                    />
                                </div>
                            </RevealOnScroll>

                            <div className="mt-6">
                                {loading ? (
                                    <div className={cn(viewMode === 'grid' ? 'grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3' : 'space-y-4')}>
                                        {[...Array(6)].map((_, index) => (
                                            <div key={index} className={cn('overflow-hidden rounded-[1.7rem] border animate-pulse', chipClass)} style={sectionStyle}>
                                                <div className="aspect-[4/3] bg-slate-700/40" />
                                                <div className="space-y-3 p-4">
                                                    <div className="h-5 w-2/3 rounded bg-slate-700/40" />
                                                    <div className="h-4 w-1/3 rounded bg-slate-700/40" />
                                                    <div className="h-4 w-full rounded bg-slate-700/40" />
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : listings.length === 0 ? (
                                    <div className={cn('rounded-[1.75rem] border px-6 py-16 text-center', panelClass)} style={sectionStyle}>
                                        <div
                                            className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border"
                                            style={{
                                                borderColor: toRgba(accentPrimary, 0.24),
                                                background: toRgba(accentPrimary, 0.08),
                                                color: accentPrimary,
                                            }}
                                        >
                                            <Search className="h-9 w-9" />
                                        </div>
                                        <h3 className={cn('mt-5 text-2xl font-black tracking-tight', isWhiteMode ? 'text-slate-950' : 'text-white')}>
                                            No listings match this market view.
                                        </h3>
                                        <p className={cn('mx-auto mt-3 max-w-xl text-sm leading-6', mutedTextClass)}>
                                            Try relaxing filters, switching to another city, or be the first seller to publish inventory in this lane.
                                        </p>
                                        <Link
                                            to="/sell"
                                            className="mt-6 inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-black uppercase tracking-[0.16em] transition-all"
                                            style={accentFillStyle}
                                        >
                                            Create listing
                                            <ArrowRight className="h-4 w-4" />
                                        </Link>
                                    </div>
                                ) : (
                                    <div
                                        id="marketplace-results"
                                        data-scroll-anchor="true"
                                        data-scroll-anchor-label="Marketplace Listings"
                                        className={viewMode === 'grid' ? 'grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3' : 'space-y-4'}
                                    >
                                        {activeEntries.map(({ listing, safety }, index) => (
                                            <RevealOnScroll
                                                key={listing._id}
                                                delay={Math.min((index % 7) * 45, 260)}
                                                distance={12}
                                                className="h-full"
                                            >
                                                <ListingCard
                                                    listing={listing}
                                                    safety={safety}
                                                    safetyMode={safetyMode}
                                                    viewMode={viewMode}
                                                    prefetchListingDetails={prefetchListingDetails}
                                                    isWhiteMode={isWhiteMode}
                                                    accentPrimary={accentPrimary}
                                                    accentSecondary={accentSecondary}
                                                />
                                            </RevealOnScroll>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {pagination.pages > 1 ? (
                                <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
                                    {[...Array(pagination.pages)].map((_, index) => (
                                        <button
                                            key={index}
                                            type="button"
                                            onClick={() => setFilters((prev) => ({ ...prev, page: index + 1 }))}
                                            className={cn(
                                                'h-10 min-w-10 rounded-full border px-3 text-sm font-black transition-all',
                                                pagination.page === index + 1 ? '' : chipClass
                                            )}
                                            style={pagination.page === index + 1 ? accentOutlineStyle : sectionStyle}
                                        >
                                            {index + 1}
                                        </button>
                                    ))}
                                </div>
                            ) : null}
                        </section>
                    </div>
                </div>
            </div>
        </div>
    );
}
