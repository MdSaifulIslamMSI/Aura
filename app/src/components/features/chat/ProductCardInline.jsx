import { useMemo } from 'react';
import { useIntl } from 'react-intl';
import { ArrowUpRight, ShieldCheck, ShoppingCart, Star, Truck } from 'lucide-react';
import { useMarket } from '@/context/MarketContext';
import { useDynamicTranslations } from '@/hooks/useDynamicTranslations';
import { criticalMessages } from '@/i18n/messages/criticalMessages';
import { cn } from '@/lib/utils';
import { getBaseAmount, getBaseCurrency, getOriginalBaseAmount } from '@/utils/pricing';
import { useStableIcuMessages } from '@/i18n/useStableIcuMessages';

import { StableText } from '@/i18n/StableText';
const ProductCardInline = ({
    product,
    mode = 'explore',
    isWhiteMode = false,
    onSelect,
    onAddToCart,
    onViewDetails,
}) => {
    const { t: legacyT, formatPrice } = useMarket();
    const t = useStableIcuMessages(legacyT);
    const intl = useIntl();
    const cardClassName = isWhiteMode
        ? 'assistant-inline-product border-slate-200 bg-white text-slate-950'
        : 'assistant-inline-product border-white/10 bg-white/[0.04] text-slate-100';
    const mutedTextClass = isWhiteMode ? 'text-slate-500' : 'text-slate-400';
    const outlineButtonClass = isWhiteMode
        ? 'border-slate-200 bg-white text-slate-950 hover:bg-slate-100'
        : 'border-white/10 bg-white/[0.04] text-slate-100 hover:bg-white/[0.08]';
    const primaryButtonClass = isWhiteMode
        ? 'assistant-inline-product__primary border-slate-950 bg-slate-950 text-white hover:bg-slate-800'
        : 'assistant-inline-product__primary border-cyan-300/30 bg-cyan-400 text-slate-950 hover:bg-cyan-300';
    const priceAmount = getBaseAmount(product);
    const priceCurrency = getBaseCurrency(product);
    const originalPriceAmount = getOriginalBaseAmount(product);
    const productTitle = product?.displayTitle || product?.title || '';
    const dynamicTexts = useMemo(() => [productTitle], [productTitle]);
    const { translateText } = useDynamicTranslations(dynamicTexts);
    const translatedProductTitle = translateText(productTitle) || productTitle;
    const discountPercentage = Math.max(0, Number(product?.discountPercentage || 0));
    const stockCount = Math.max(0, Number(product?.stock || 0));
    const inStock = stockCount > 0;
    const rating = Math.max(0, Number(product?.rating || 0));
    const ratingCount = Math.max(0, Number(product?.ratingCount || 0));
    const deliveryTime = String(product?.deliveryTime || '').trim();
    const warranty = String(product?.warranty || '').trim();
    const missingCommerceDetailLabels = [
        !deliveryTime ? t('assistant.product.delivery', {}, 'delivery') : '',
        !warranty ? t('assistant.product.warranty', {}, 'warranty') : '',
    ].filter(Boolean);
    const missingCommerceDetails = missingCommerceDetailLabels.length > 0
        ? intl.formatList(missingCommerceDetailLabels, { type: 'conjunction' })
        : '';
    const assistantReason = String(product?.assistantReason || '').trim();
    const assistantWatchout = String(product?.assistantWatchout || '').trim();

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
                            loading="lazy"
                            decoding="async"
                        />
                    ) : null}
                </div>

                <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <h4 className="line-clamp-2 text-sm font-bold leading-5">{translatedProductTitle}</h4>
                            <div className={cn('mt-1 flex flex-wrap items-center gap-1.5 text-[11px]', mutedTextClass)}>
                                <span className="truncate">{product?.brand || t('product.brand.auraCatalog', {}, 'Aura catalog')}</span>
                                {product?.category ? <span className="rounded-full border border-current/10 px-2 py-0.5">{product.category}</span> : null}
                            </div>
                        </div>

                        {rating > 0 ? (
                            <span
                                aria-label={intl.formatMessage(
                                    {
                                        id: 'assistant.product.ratingSummary',
                                        defaultMessage: '{rating} out of 5 from {count, number} reviews',
                                    },
                                    { rating: rating.toFixed(1), count: ratingCount },
                                )}
                                className={cn('inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-semibold', outlineButtonClass)}
                            >
                                <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                                {rating.toFixed(1)}
                                {ratingCount > 0 ? (
                                    <span className={mutedTextClass}>({intl.formatNumber(ratingCount)})</span>
                                ) : null}
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
                                {t('product.discount.savePercent', { value: discountPercentage }, 'Save {{value}}%')}
                            </span>
                        ) : null}
                        <span className={cn(
                            'rounded-full border px-2.5 py-1 font-semibold',
                            inStock
                                ? 'border-cyan-400/20 bg-cyan-400/10 text-cyan-400'
                                : 'border-rose-400/20 bg-rose-500/10 text-rose-400'
                        )}>
                            {inStock
                                ? t('product.stock.inStockCount', { count: stockCount }, '{{count}} in stock')
                                : t('product.stock.outOfStock', {}, 'Out of stock')}
                        </span>
                    </div>

                    {deliveryTime || warranty ? (
                        <div className={cn('mt-3 grid gap-1.5 text-[11px] leading-5', mutedTextClass)}>
                            {deliveryTime ? (
                                <p className="flex items-start gap-2">
                                    <Truck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                    <span><strong className="font-bold text-current">{t('assistant.product.deliveryLabel', {}, 'Delivery:')}</strong> {deliveryTime}</span>
                                </p>
                            ) : null}
                            {warranty ? (
                                <p className="flex items-start gap-2">
                                    <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                    <span><strong className="font-bold text-current">{t('assistant.product.warrantyLabel', {}, 'Warranty:')}</strong> {warranty}</span>
                                </p>
                            ) : null}
                        </div>
                    ) : null}

                    {isDecisionMode && missingCommerceDetails ? (
                        <p className={cn('mt-2 text-[11px] leading-5', mutedTextClass)}>
                            {t(
                                'assistant.product.confirmMissingDetails',
                                { details: missingCommerceDetails },
                                'Open details to confirm {{details}}.',
                            )}
                        </p>
                    ) : null}

                    {assistantReason || assistantWatchout ? (
                        <div className={cn('mt-3 space-y-1.5 text-[11px] leading-5', mutedTextClass)}>
                            {assistantReason ? (
                                <p>
                                    <span className="font-bold text-current">{t('assistant.product.whyItFits', {}, 'Why it fits:')}</span>{' '}
                                    {assistantReason}
                                </p>
                            ) : null}
                            {assistantWatchout ? <p><StableText id={"product.jsx.text.watch.3139f8c4"} defaultMessage={"Watch:"} /> {assistantWatchout}</p> : null}
                        </div>
                    ) : null}
                </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
                {isDecisionMode ? (
                    <>
                        <button
                            type="button"
                            onClick={() => onAddToCart?.(product?.id)}
                            disabled={!inStock}
                            className={cn(
                                'inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-full border px-4 py-2 text-xs font-bold transition-colors sm:flex-none',
                                primaryButtonClass,
                                !inStock && 'cursor-not-allowed border-slate-300/10 bg-slate-500/10 text-slate-400 opacity-70',
                            )}
                        >
                            <ShoppingCart className="h-3.5 w-3.5" />
                            {inStock
                                ? intl.formatMessage(criticalMessages.addToCart)
                                : t('product.stock.outOfStock', {}, 'Out of stock')}
                        </button>
                        <button
                            type="button"
                            onClick={() => onViewDetails?.(product?.id)}
                            className={cn('inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold transition-colors sm:flex-none', outlineButtonClass)}
                        >
                            {t('product.viewDetails', {}, 'View details')}
                            <ArrowUpRight className="h-3.5 w-3.5" />
                        </button>
                    </>
                ) : (
                    <button
                        type="button"
                        onClick={() => onSelect?.(product?.id)}
                        className={cn('inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold transition-colors sm:w-auto', outlineButtonClass)}
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
