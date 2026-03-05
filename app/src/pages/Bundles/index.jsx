import { useContext, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2, Sparkles, Zap, ShoppingCart, ShieldCheck } from 'lucide-react';
import { productApi } from '@/services/api';
import { CartContext } from '@/context/CartContext';
import { formatPrice } from '@/utils/format';

const THEME_PRESETS = [
    { value: 'home gym starter kit', label: 'Home Gym Starter Kit' },
    { value: 'creator studio stack', label: 'Creator Studio Stack' },
    { value: 'gaming command kit', label: 'Gaming Command Kit' },
    { value: 'smart essentials', label: 'Smart Essentials' },
];

const clampBudget = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 25000;
    return Math.max(5000, Math.min(200000, parsed));
};

export default function Bundles() {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const { addToCart } = useContext(CartContext);

    const [theme, setTheme] = useState(searchParams.get('theme') || 'home gym starter kit');
    const [budget, setBudget] = useState(clampBudget(searchParams.get('budget')));
    const [maxItems, setMaxItems] = useState(6);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [bundle, setBundle] = useState(null);

    useEffect(() => {
        const nextParams = new URLSearchParams();
        nextParams.set('theme', theme);
        nextParams.set('budget', String(budget));
        setSearchParams(nextParams, { replace: true });
    }, [theme, budget, setSearchParams]);

    const buildBundle = async () => {
        setLoading(true);
        setError('');
        try {
            const response = await productApi.buildSmartBundle({
                theme,
                budget,
                maxItems,
            });
            setBundle(response);
        } catch (buildError) {
            setError(buildError.message || 'Failed to build smart bundle');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        buildBundle();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const canCheckout = useMemo(() => Array.isArray(bundle?.items) && bundle.items.length > 0, [bundle?.items]);

    const handleAddAllToCart = () => {
        if (!canCheckout) return;
        bundle.items.forEach((item) => {
            addToCart({
                ...item,
                stock: Number(item.stock || 50),
                discountPercentage: Number(item.discountPercentage || 0),
            }, Number(item.quantity || 1));
        });
    };

    const handleOneClickCheckout = () => {
        if (!canCheckout) return;
        handleAddAllToCart();
        navigate('/checkout');
    };

    return (
        <div className="min-h-screen pb-16">
            <div className="container-custom max-w-7xl mx-auto px-4 py-8">
                <div className="rounded-3xl border border-cyan-300/25 bg-gradient-to-r from-cyan-500/12 via-violet-500/10 to-emerald-500/12 p-6 md:p-8">
                    <p className="text-[11px] font-black uppercase tracking-[0.2em] text-cyan-100">Smart Bundle Builder</p>
                    <h1 className="mt-2 text-3xl md:text-5xl font-black text-white tracking-tight">
                        AI Bundles With One-Click Checkout
                    </h1>
                    <p className="mt-3 text-sm md:text-base text-slate-300 max-w-2xl">
                        Generate budget-bound curated bundles from live catalog intelligence and send everything to checkout in one action.
                    </p>
                </div>

                <div className="mt-6 grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-6">
                    <aside className="rounded-2xl border border-white/10 bg-white/5 p-5 h-fit">
                        <h2 className="text-sm font-black uppercase tracking-[0.16em] text-white mb-4 flex items-center gap-2">
                            <Sparkles className="w-4 h-4 text-cyan-300" />
                            Bundle Controls
                        </h2>

                        <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                            Theme
                        </label>
                        <select
                            value={theme}
                            onChange={(e) => setTheme(e.target.value)}
                            className="w-full rounded-xl border border-white/15 bg-zinc-950/80 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400"
                        >
                            {THEME_PRESETS.map((preset) => (
                                <option key={preset.value} value={preset.value}>
                                    {preset.label}
                                </option>
                            ))}
                        </select>

                        <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mt-4 mb-2">
                            Budget ({formatPrice(budget)})
                        </label>
                        <input
                            type="range"
                            min={5000}
                            max={200000}
                            step={1000}
                            value={budget}
                            onChange={(e) => setBudget(clampBudget(e.target.value))}
                            className="w-full accent-cyan-400"
                        />

                        <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mt-4 mb-2">
                            Max Items
                        </label>
                        <input
                            type="number"
                            min={2}
                            max={12}
                            value={maxItems}
                            onChange={(e) => setMaxItems(Math.max(2, Math.min(12, Number(e.target.value) || 6)))}
                            className="w-full rounded-xl border border-white/15 bg-zinc-950/80 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400"
                        />

                        <button
                            type="button"
                            onClick={buildBundle}
                            disabled={loading}
                            className="mt-5 w-full rounded-xl border border-cyan-300/40 bg-cyan-500/20 px-4 py-3 text-sm font-black uppercase tracking-wider text-cyan-100 disabled:opacity-60 inline-flex items-center justify-center gap-2"
                        >
                            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                            {loading ? 'Building...' : 'Rebuild Bundle'}
                        </button>
                    </aside>

                    <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
                        {error && (
                            <div className="mb-4 rounded-xl border border-rose-300/35 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                                {error}
                            </div>
                        )}

                        {!loading && bundle && (
                            <div>
                                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                                    <div>
                                        <h2 className="text-2xl font-black text-white">{bundle.bundleName || 'Smart Bundle'}</h2>
                                        <p className="text-sm text-slate-400">
                                            {bundle.items?.length || 0} items • Budget use {bundle.budgetUtilization || 0}%
                                        </p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-sm text-slate-400">Bundle Total</p>
                                        <p className="text-2xl font-black text-cyan-100">{formatPrice(bundle.totalPrice || 0)}</p>
                                        <p className="text-xs text-emerald-300">Savings {formatPrice(bundle.savings || 0)}</p>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                                    {(bundle.items || []).map((item) => (
                                        <Link
                                            key={item.id || item._id}
                                            to={`/product/${item.id || item._id}`}
                                            className="rounded-xl border border-white/10 bg-zinc-950/45 p-3 hover:border-cyan-300/40 transition-colors"
                                        >
                                            <img src={item.image} alt={item.title} className="w-full h-36 object-cover rounded-lg bg-zinc-900/70" />
                                            <p className="mt-2 text-sm font-bold text-white line-clamp-2">{item.title}</p>
                                            <p className="text-xs text-slate-400">{item.brand} • {item.category}</p>
                                            <p className="mt-1 text-sm font-black text-cyan-100">{formatPrice(item.price)}</p>
                                        </Link>
                                    ))}
                                </div>

                                <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <button
                                        type="button"
                                        onClick={handleAddAllToCart}
                                        disabled={!canCheckout}
                                        className="rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-sm font-black uppercase tracking-wider text-white disabled:opacity-60 inline-flex items-center justify-center gap-2"
                                    >
                                        <ShoppingCart className="w-4 h-4" />
                                        Add All To Cart
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleOneClickCheckout}
                                        disabled={!canCheckout}
                                        className="rounded-xl border border-emerald-300/40 bg-emerald-500/20 px-4 py-3 text-sm font-black uppercase tracking-wider text-emerald-100 disabled:opacity-60 inline-flex items-center justify-center gap-2"
                                    >
                                        <ShieldCheck className="w-4 h-4" />
                                        One-Click Checkout
                                    </button>
                                </div>
                            </div>
                        )}
                    </section>
                </div>
            </div>
        </div>
    );
}

