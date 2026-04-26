import { useMemo } from 'react';
import { ArrowUpRight, ShoppingCart, Star } from 'lucide-react';
import { useMarket } from '@/context/MarketContext';
import { useDynamicTranslations } from '@/hooks/useDynamicTranslations';
import { cn } from '@/lib/utils';
import { getBaseAmount, getBaseCurrency, getOriginalBaseAmount } from '@/utils/pricing';

const ProductCardInline = ({
    product,
    mode = 'explore',
    isWhiteMode = false,
    onSelect,
    onAddToCart,
    onViewDetails,
}) => {
    const { t, formatPrice } = useMarket();
    const cardClassName = isWhiteMode
        ? 'assistant-inline-product border-slate-200 bg-white text-slate-950'
        : 'assistant-inline-product border-white/10 bg-white/[0.04] text-slate-100';
    const mutedTextClass = isWhiteMode ? 'text-slate-500' : 'text-slate-400';
    const outlineButtonClass = isWhiteMode
        ? 'border-slate-200 bg-white text-slate-950 hover:bg-slate-100'
        : 'border-white/10 bg-white/[0.04] text-slate-100 hover:bg-white/[0.08]';
    const primaryButtonClass = isWhiteMode
        ? 'border-slate-950 bg-slate-950 text-white hover:bg-slate-800'
        : 'assistant-inline-product__primary border-white/10 bg-white/[0.04] text-slate-100 hover:bg-white/[0.08]';
    const priceAmount = getBaseAmount(product);
    const priceCurrency = getBaseCurrency(product);
    const originalPriceAmount = getOriginalBaseAmount(product);
    const productTitle = product?.displayTitle || product?.title || '';
    const dynamicTexts = useMemo(() => [productTitle], [productTitle]);
    const { translateText } = useDynamicTranslations(dynamicTexts);
    const translatedProductTitle = translateText(productTitle) || productTitle;
    const discountPercentage = Math.max(0, Number(product?.discountPercentage || 0));
    const inStock = Number(product?.stock || 0) > 0;

    const isDecisionMode = mode === 'product';

    return (
        <article className={cn('rounded-[1.35rem] border p-3 shadow-[0_18px_55px_rgba(0,0,0,0.12)]', cardClassName)}>
            <div className="flex gap-3">
                <div className={cn('flex h-20 w-20 flex-shrink-0 items-center justify-center rounded-[1.4rem] border p-2', outlineButtonClass)}>
                    {product?.image ? (
                        <img
                            src={product.image}
                            alt={translatedProductTitle}
                            className="h-full w-full object-contain"
                        />
                    ) : null}
                </div>

                <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <h4 className="truncate text-sm font-bold">{translatedProductTitle}</h4>
                            <div className={cn('mt-1 flex flex-wrap items-center gap-1.5 text-[11px]', mutedTextClass)}>
                                <span className="truncate">{product?.brand || 'Aura catalog'}</span>
                                {product?.category ? <span className="rounded-full border border-current/10 px-2 py-0.5">{product.category}</span> : null}
                            </div>
                        </div>

                        {Number(product?.rating || 0) > 0 ? (
                            <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-semibold', outlineButtonClass)}>
                                <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                                {Number(product.rating).toFixed(1)}
                            </span>
                        ) : null}
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                        <span className="text-sm font-black text-emerald-500">
                            {formatPrice(priceAmount, undefined, undefined, { baseCurrency: priceCurrency })}
                        </span>
                        {originalPriceAmount > priceAmount ? (
                            <span className={cn('text-xs line-through', mutedTextClass)}>
                                {formatPrice(originalPriceAmount, undefined, undefined, { baseCurrency: priceCurrency })}
                            </span>
                        ) : null}
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                        {discountPercentage > 0 ? (
                            <span className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-2.5 py-1 font-semibold text-emerald-500">
                                Save {discountPercentage}%
                            </span>
                        ) : null}
                        <span className={cn(
                            'rounded-full border px-2.5 py-1 font-semibold',
                            inStock
                                ? 'border-cyan-400/20 bg-cyan-400/10 text-cyan-400'
                                : 'border-rose-400/20 bg-rose-500/10 text-rose-400'
                        )}>
                            {inStock ? `${product?.stock || 0} in stock` : 'Out of stock'}
                        </span>
                    </div>
                </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
                {isDecisionMode ? (
                    <>
                        <button
                            type="button"
                            onClick={() => onAddToCart?.(product?.id)}
                            className={cn('inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold transition-colors', primaryButtonClass)}
                        >
                            <ShoppingCart className="h-3.5 w-3.5" />
                            {t('product.addToCart', {}, 'Add to cart')}
                        </button>
                        <button
                            type="button"
                            onClick={() => onViewDetails?.(product?.id)}
                            className={cn('inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold transition-colors', outlineButtonClass)}
                        >
                            {t('product.viewDetails', {}, 'View details')}
                            <ArrowUpRight className="h-3.5 w-3.5" />
                        </button>
                    </>
                ) : (
                    <button
                        type="button"
                        onClick={() => onSelect?.(product?.id)}
                        className={cn('inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold transition-colors', outlineButtonClass)}
                    >
                        {t('product.select', {}, 'Select')}
                        <ArrowUpRight className="h-3.5 w-3.5" />
                    </button>
                )}
            </div>
        </article>
    );
};

export default ProductCardInline;
