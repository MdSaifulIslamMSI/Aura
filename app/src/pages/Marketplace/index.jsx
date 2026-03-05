import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
    Search,
    MapPin,
    Loader2,
    SlidersHorizontal,
    Eye,
    Clock,
    X,
    Smartphone,
    Laptop,
    Car,
    Sofa,
    Shirt,
    BookOpen,
    Dumbbell,
    Gamepad2,
    Home as HomeIcon,
    Package,
    Tag,
    Grid3X3,
    List,
    ShieldCheck,
    Flame,
    TrendingUp,
} from 'lucide-react';
import { listingApi } from '@/services/api';
import RevealOnScroll from '@/components/shared/RevealOnScroll';
import { detectLocationFromGps } from '@/utils/geolocation';

const CATEGORIES = [
    { value: '', label: 'All', icon: Grid3X3 },
    { value: 'mobiles', label: 'Mobiles', icon: Smartphone },
    { value: 'laptops', label: 'Laptops', icon: Laptop },
    { value: 'electronics', label: 'Electronics', icon: Package },
    { value: 'vehicles', label: 'Vehicles', icon: Car },
    { value: 'furniture', label: 'Furniture', icon: Sofa },
    { value: 'fashion', label: 'Fashion', icon: Shirt },
    { value: 'books', label: 'Books', icon: BookOpen },
    { value: 'sports', label: 'Sports', icon: Dumbbell },
    { value: 'home-appliances', label: 'Home', icon: HomeIcon },
    { value: 'gaming', label: 'Gaming', icon: Gamepad2 },
    { value: 'other', label: 'Other', icon: Tag },
];

const SORTS = [
    { value: 'newest', label: 'Newest First' },
    { value: 'price-low', label: 'Price: Low to High' },
    { value: 'price-high', label: 'Price: High to Low' },
    { value: 'most-viewed', label: 'Most Viewed' },
];

const CONDITIONS = [
    { value: '', label: 'Any' },
    { value: 'new', label: 'New' },
    { value: 'like-new', label: 'Like New' },
    { value: 'good', label: 'Good' },
    { value: 'fair', label: 'Fair' },
];

const HEAT_STYLE = {
    blazing: {
        ring: 'border-rose-400/40 bg-rose-500/10',
        badge: 'bg-rose-500/25 text-rose-100 border-rose-300/40',
        demandBar: 'from-rose-400 to-fuchsia-400',
    },
    rising: {
        ring: 'border-amber-300/40 bg-amber-500/10',
        badge: 'bg-amber-500/25 text-amber-100 border-amber-300/40',
        demandBar: 'from-amber-300 to-orange-300',
    },
    balanced: {
        ring: 'border-cyan-300/35 bg-cyan-500/10',
        badge: 'bg-cyan-500/20 text-cyan-100 border-cyan-300/30',
        demandBar: 'from-cyan-300 to-sky-300',
    },
    cooling: {
        ring: 'border-slate-500/35 bg-slate-600/10',
        badge: 'bg-slate-600/25 text-slate-200 border-slate-500/35',
        demandBar: 'from-slate-300 to-slate-400',
    },
};

const PROXIMITY_LABELS = {
    local: 'Local GPS zone',
    regional: 'Regional signal',
    national: 'National signal',
};

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

export default function Marketplace() {
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
        } catch (err) {
            console.error('Failed to fetch listings:', err);
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
        } catch (err) {
            setHotspotsError(err?.message || 'Hotspot telemetry is unavailable right now.');
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

    const activeFilterCount = [filters.category, filters.city, filters.condition, filters.minPrice, filters.maxPrice].filter(Boolean).length;

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

    return (
        <div className="min-h-screen bg-[#04060f] text-slate-100">
            <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
                <div className="absolute -top-24 left-[-15%] h-[420px] w-[420px] rounded-full bg-cyan-500/15 blur-3xl" />
                <div className="absolute top-[10%] right-[-10%] h-[460px] w-[460px] rounded-full bg-fuchsia-500/15 blur-3xl" />
                <div className="absolute bottom-[-15%] left-[25%] h-[380px] w-[380px] rounded-full bg-emerald-500/15 blur-3xl" />
            </div>

            <div className="relative border-b border-cyan-400/20 bg-[#050817]/80 backdrop-blur-xl">
                <RevealOnScroll anchorId="marketplace-hero" anchorLabel="Marketplace Hero" className="mx-auto max-w-7xl px-4 py-8 md:py-10">
                    <div className="rounded-3xl border border-cyan-400/25 bg-gradient-to-r from-cyan-500/12 via-indigo-500/10 to-fuchsia-500/12 p-6 shadow-[0_0_60px_rgba(34,211,238,0.12)] md:p-8">
                        <h1 className="text-3xl font-black tracking-tight md:text-4xl">Marketplace</h1>
                        <p className="mt-2 text-sm text-cyan-100/80 md:text-base">Buy and sell near you with verified listings and trusted sellers.</p>

                        <div className="mt-6 grid gap-3 md:grid-cols-[1fr_220px_auto]">
                            <div className="relative">
                                <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-cyan-200/70" />
                                <input
                                    type="text"
                                    value={filters.search}
                                    onChange={(e) => updateFilter('search', e.target.value)}
                                    placeholder="Search by title, category, brand, or keyword"
                                    className="h-12 w-full rounded-2xl border border-cyan-300/25 bg-slate-900/70 pl-12 pr-4 text-sm text-slate-100 outline-none transition placeholder:text-slate-400 focus:border-cyan-300/50 focus:ring-2 focus:ring-cyan-300/30"
                                />
                            </div>
                            <div className="relative">
                                <MapPin className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-cyan-200/70" />
                                <input
                                    type="text"
                                    value={filters.city}
                                    onChange={(e) => updateFilter('city', e.target.value)}
                                    placeholder="City"
                                    className="h-12 w-full rounded-2xl border border-cyan-300/25 bg-slate-900/70 pl-12 pr-4 text-sm text-slate-100 outline-none transition placeholder:text-slate-400 focus:border-cyan-300/50 focus:ring-2 focus:ring-cyan-300/30"
                                />
                            </div>
                            <button
                                type="button"
                                onClick={useCurrentCity}
                                disabled={locatingCity}
                                className="h-12 rounded-2xl border border-cyan-300/35 bg-cyan-500/15 px-4 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-60 inline-flex items-center gap-2 justify-center"
                            >
                                {locatingCity ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
                                {locatingCity ? 'Detecting...' : 'Near me'}
                            </button>
                        </div>
                        {(locationHint || locationError) && (
                            <p className={`mt-3 text-xs font-semibold ${locationError ? 'text-rose-300' : 'text-emerald-200'}`}>
                                {locationError || locationHint}
                            </p>
                        )}
                    </div>
                </RevealOnScroll>
            </div>

            <div className="sticky top-20 z-10 border-b border-cyan-400/20 bg-[#050817]/85 backdrop-blur-xl md:top-24">
                <div className="mx-auto max-w-7xl overflow-x-auto px-4 py-3">
                    <div className="flex min-w-max items-center gap-2">
                        {CATEGORIES.map((cat) => {
                            const Icon = cat.icon;
                            const active = filters.category === cat.value;
                            return (
                                <button
                                    key={cat.value}
                                    onClick={() => updateFilter('category', cat.value)}
                                    className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition ${
                                        active
                                            ? 'border-cyan-300/50 bg-cyan-400/20 text-cyan-100 shadow-[0_0_24px_rgba(34,211,238,0.25)]'
                                            : 'border-slate-700/70 bg-slate-900/70 text-slate-300 hover:border-cyan-300/30 hover:text-cyan-100'
                                    }`}
                                >
                                    <Icon className="h-4 w-4" />
                                    {cat.label}
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>

            <div className="mx-auto max-w-7xl px-4 py-6">
                <RevealOnScroll
                    anchorId="marketplace-heatmap"
                    anchorLabel="City Heatmap"
                    className="mb-6 rounded-2xl border border-fuchsia-400/25 bg-gradient-to-br from-fuchsia-500/12 via-cyan-500/10 to-slate-900/70 p-4 shadow-[0_0_32px_rgba(168,85,247,0.18)] md:p-5"
                >
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <p className="text-xs font-black uppercase tracking-[0.18em] text-fuchsia-200/80">City Heatmap Commerce</p>
                            <h2 className="mt-1 text-lg font-black text-slate-100 md:text-xl">Live Demand vs Supply Hotspots</h2>
                            <p className="mt-1 text-xs text-slate-300/90 md:text-sm">
                                GPS-aware hotspot signals by city and category. Demand is inferred from sold velocity and listing engagement.
                            </p>
                        </div>
                        <div className="rounded-xl border border-cyan-300/30 bg-slate-950/65 px-3 py-2 text-xs font-semibold text-cyan-100">
                            {filters.category ? getCategoryLabel(filters.category) : 'All categories'}
                            {' • '}
                            {filters.city || gpsContext?.city || 'All cities'}
                        </div>
                    </div>

                    {hotspotsLoading ? (
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                            {[...Array(4)].map((_, index) => (
                                <div key={index} className="rounded-xl border border-slate-700/70 bg-slate-900/60 p-4 animate-pulse">
                                    <div className="h-4 w-2/3 rounded bg-slate-700/70" />
                                    <div className="mt-3 h-7 w-16 rounded bg-slate-700/70" />
                                    <div className="mt-4 h-2 w-full rounded bg-slate-700/70" />
                                    <div className="mt-2 h-2 w-5/6 rounded bg-slate-700/70" />
                                </div>
                            ))}
                        </div>
                    ) : hotspotsError ? (
                        <div className="rounded-xl border border-rose-400/35 bg-rose-500/10 px-4 py-3 text-sm font-semibold text-rose-100">
                            {hotspotsError}
                        </div>
                    ) : hotspots.length === 0 ? (
                        <div className="rounded-xl border border-slate-700 bg-slate-900/65 px-4 py-5 text-sm text-slate-300">
                            Not enough live marketplace signals for this filter yet. Try another city or broader category.
                        </div>
                    ) : (
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                            {hotspots.map((hotspot) => {
                                const heatStyle = HEAT_STYLE[hotspot.heatLabel] || HEAT_STYLE.balanced;
                                const demandBarWidth = `${Math.max(4, Number(hotspot.demandScore || 0))}%`;
                                const supplyBarWidth = `${Math.max(4, Number(hotspot.supplyScore || 0))}%`;
                                return (
                                    <article
                                        key={`${hotspot.city}-${hotspot.state}-${hotspot.category}`}
                                        className={`rounded-xl border p-4 transition hover:-translate-y-0.5 ${heatStyle.ring}`}
                                    >
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
                                                    <span className="inline-flex items-center gap-1"><TrendingUp className="h-3.5 w-3.5 text-emerald-300" />Demand</span>
                                                    <span>{hotspot.demandLevel}</span>
                                                </div>
                                                <div className="h-2 rounded-full bg-slate-950/60">
                                                    <div className={`h-2 rounded-full bg-gradient-to-r ${heatStyle.demandBar}`} style={{ width: demandBarWidth }} />
                                                </div>
                                            </div>
                                            <div>
                                                <div className="mb-1 flex items-center justify-between text-[11px] font-semibold text-slate-300/90">
                                                    <span className="inline-flex items-center gap-1"><Package className="h-3.5 w-3.5 text-cyan-300" />Supply</span>
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
                            })}
                        </div>
                    )}
                </RevealOnScroll>

                <div className="mb-6 rounded-2xl border border-cyan-400/20 bg-slate-900/65 p-3 shadow-[0_0_40px_rgba(15,23,42,0.6)] md:flex md:items-center md:justify-between">
                    <div className="mb-3 flex flex-wrap items-center gap-2 md:mb-0">
                        <span className="rounded-full border border-slate-700 bg-slate-950/70 px-3 py-1 text-xs font-semibold text-slate-300">
                            {pagination.total} listings
                        </span>
                        <button
                            onClick={() => setShowFilters((v) => !v)}
                            className="relative inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950/70 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-cyan-300/30 hover:text-cyan-100"
                        >
                            <SlidersHorizontal className="h-4 w-4" />
                            Filters
                            {activeFilterCount > 0 && (
                                <span className="absolute -right-2 -top-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-fuchsia-500 text-[10px] font-black text-white">
                                    {activeFilterCount}
                                </span>
                            )}
                        </button>
                        {activeFilterCount > 0 && (
                            <button
                                onClick={clearFilters}
                                className="inline-flex items-center gap-1 rounded-xl border border-red-400/35 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-200 transition hover:bg-red-500/20"
                            >
                                <X className="h-3.5 w-3.5" />
                                Clear all
                            </button>
                        )}
                    </div>

                    <div className="flex items-center gap-2">
                        <div className="flex items-center rounded-xl border border-slate-700 bg-slate-950/70 p-1">
                            <button
                                onClick={() => setViewMode('grid')}
                                className={`rounded-lg p-2 transition ${
                                    viewMode === 'grid' ? 'bg-cyan-400/20 text-cyan-100' : 'text-slate-400 hover:text-cyan-100'
                                }`}
                            >
                                <Grid3X3 className="h-4 w-4" />
                            </button>
                            <button
                                onClick={() => setViewMode('list')}
                                className={`rounded-lg p-2 transition ${
                                    viewMode === 'list' ? 'bg-cyan-400/20 text-cyan-100' : 'text-slate-400 hover:text-cyan-100'
                                }`}
                            >
                                <List className="h-4 w-4" />
                            </button>
                        </div>
                        <select
                            value={filters.sort}
                            onChange={(e) => updateFilter('sort', e.target.value)}
                            className="h-10 rounded-xl border border-slate-700 bg-slate-950/70 px-3 text-sm font-medium text-slate-200 outline-none transition focus:border-cyan-300/40"
                        >
                            {SORTS.map((s) => (
                                <option key={s.value} value={s.value} className="bg-slate-900">
                                    {s.label}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>

                {showFilters && (
                    <div className="mb-6 rounded-2xl border border-cyan-400/20 bg-slate-900/65 p-4 shadow-[0_0_30px_rgba(34,211,238,0.08)] md:p-6">
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                            <div>
                                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-cyan-100/70">Condition</label>
                                <select
                                    value={filters.condition}
                                    onChange={(e) => updateFilter('condition', e.target.value)}
                                    className="h-11 w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 text-sm text-slate-200 outline-none focus:border-cyan-300/40"
                                >
                                    {CONDITIONS.map((c) => (
                                        <option key={c.value} value={c.value} className="bg-slate-900">
                                            {c.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-cyan-100/70">Min Price (Rs.)</label>
                                <input
                                    type="number"
                                    value={filters.minPrice}
                                    onChange={(e) => updateFilter('minPrice', e.target.value)}
                                    placeholder="0"
                                    className="h-11 w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 text-sm text-slate-200 outline-none placeholder:text-slate-500 focus:border-cyan-300/40"
                                />
                            </div>
                            <div>
                                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-cyan-100/70">Max Price (Rs.)</label>
                                <input
                                    type="number"
                                    value={filters.maxPrice}
                                    onChange={(e) => updateFilter('maxPrice', e.target.value)}
                                    placeholder="No limit"
                                    className="h-11 w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 text-sm text-slate-200 outline-none placeholder:text-slate-500 focus:border-cyan-300/40"
                                />
                            </div>
                            <div>
                                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-cyan-100/70">City</label>
                                <input
                                    type="text"
                                    value={filters.city}
                                    onChange={(e) => updateFilter('city', e.target.value)}
                                    placeholder="Any city"
                                    className="h-11 w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 text-sm text-slate-200 outline-none placeholder:text-slate-500 focus:border-cyan-300/40"
                                />
                            </div>
                        </div>
                    </div>
                )}

                {loading ? (
                    <div className={`grid gap-4 ${viewMode === 'grid' ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4' : 'grid-cols-1'}`}>
                        {[...Array(8)].map((_, i) => (
                            <div key={i} className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70 animate-pulse">
                                <div className="h-48 bg-slate-800/70" />
                                <div className="space-y-3 p-4">
                                    <div className="h-5 w-2/3 rounded bg-slate-700/70" />
                                    <div className="h-4 w-1/3 rounded bg-slate-700/70" />
                                </div>
                            </div>
                        ))}
                    </div>
                ) : listings.length === 0 ? (
                    <div className="rounded-3xl border border-slate-800 bg-slate-900/60 py-20 text-center">
                        <div className="mx-auto mb-4 flex h-24 w-24 items-center justify-center rounded-full border border-cyan-400/20 bg-cyan-400/10">
                            <Search className="h-10 w-10 text-cyan-200/60" />
                        </div>
                        <h3 className="text-xl font-black text-slate-100">No listings match current filters</h3>
                        <p className="mx-auto mt-2 max-w-md text-sm text-slate-400">Try relaxing filters or create the first listing in this category and city.</p>
                        <Link
                            to="/sell"
                            className="mt-5 inline-flex items-center gap-2 rounded-xl border border-emerald-300/40 bg-emerald-500/20 px-5 py-2.5 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-500/30"
                        >
                            Create listing
                        </Link>
                    </div>
                ) : (
                    <div
                        id="marketplace-results"
                        data-scroll-anchor="true"
                        data-scroll-anchor-label="Marketplace Listings"
                        className={viewMode === 'grid' ? 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4' : 'space-y-4'}
                    >
                        {listings.map((listing, index) => (
                            <RevealOnScroll
                                key={listing._id}
                                delay={Math.min((index % 7) * 55, 320)}
                                distance={14}
                                className="h-full"
                            >
                                <Link
                                    to={`/listing/${listing._id}`}
                                    onMouseEnter={() => prefetchListingDetails(listing._id)}
                                    onFocus={() => prefetchListingDetails(listing._id)}
                                    className={`group overflow-hidden rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-900/85 to-slate-950/95 transition hover:border-cyan-300/40 hover:shadow-[0_0_30px_rgba(34,211,238,0.14)] ${
                                        viewMode === 'list' ? 'flex flex-col sm:flex-row' : ''
                                    }`}
                                >
                                    <div className={`relative overflow-hidden bg-slate-800/70 ${viewMode === 'list' ? 'aspect-[16/10] sm:w-56 sm:flex-shrink-0' : 'aspect-[4/3]'}`}>
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
                                        {listing.escrowOptIn && (
                                            <span className="absolute left-2 bottom-2 rounded-full border border-cyan-200/40 bg-cyan-500/25 px-2 py-0.5 text-[10px] font-black tracking-wide text-cyan-100 inline-flex items-center gap-1">
                                                <ShieldCheck className="h-3 w-3" />
                                                ESCROW
                                            </span>
                                        )}
                                        <span
                                            className={`absolute right-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-white ${
                                                listing.condition === 'new'
                                                    ? 'bg-sky-500/90'
                                                    : listing.condition === 'like-new'
                                                        ? 'bg-indigo-500/90'
                                                        : listing.condition === 'good'
                                                            ? 'bg-amber-500/90'
                                                            : 'bg-slate-600/90'
                                            }`}
                                        >
                                            {listing.condition}
                                        </span>
                                    </div>
                                    <div className="flex flex-1 flex-col p-4">
                                        <p className="text-xl font-black text-slate-100">Rs. {listing.price?.toLocaleString('en-IN')}</p>
                                        <h3 className="mt-1 line-clamp-1 text-sm font-semibold text-slate-200">{listing.title}</h3>
                                        <div className="mt-3 grid gap-1.5 text-xs text-slate-400">
                                            <span className="flex items-center gap-1.5">
                                                <MapPin className="h-3.5 w-3.5 text-cyan-300/80" />
                                                {listing.location?.city || 'Unknown city'}
                                            </span>
                                            <span className="flex items-center gap-1.5">
                                                <Clock className="h-3.5 w-3.5 text-cyan-300/80" />
                                                {timeAgo(listing.createdAt)}
                                            </span>
                                            <span className="flex items-center gap-1.5">
                                                <Eye className="h-3.5 w-3.5 text-cyan-300/80" />
                                                {listing.views || 0} views
                                            </span>
                                        </div>
                                        {listing.seller?.name && <span className="mt-3 text-xs font-medium text-cyan-100/70">Seller: {listing.seller.name}</span>}
                                        {listing.seller?.isVerified && (
                                            <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-[0.12em] text-emerald-200">
                                                <ShieldCheck className="h-3 w-3" />
                                                Verified Seller
                                            </span>
                                        )}
                                    </div>
                                </Link>
                            </RevealOnScroll>
                        ))}
                    </div>
                )}

                {pagination.pages > 1 && (
                    <div className="mt-10 flex flex-wrap items-center justify-center gap-2">
                        {[...Array(pagination.pages)].map((_, i) => (
                            <button
                                key={i}
                                onClick={() => setFilters((prev) => ({ ...prev, page: i + 1 }))}
                                className={`h-10 min-w-10 rounded-xl border px-3 text-sm font-bold transition ${
                                    pagination.page === i + 1
                                        ? 'border-cyan-300/50 bg-cyan-400/20 text-cyan-100'
                                        : 'border-slate-700 bg-slate-900/60 text-slate-300 hover:border-cyan-300/30 hover:text-cyan-100'
                                }`}
                            >
                                {i + 1}
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
