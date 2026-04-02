import { ShoppingCart } from 'lucide-react';
import { useMarket } from '@/context/MarketContext';
import { cn } from '@/lib/utils';
import { formatPrice } from '@/utils/format';
import ConfirmationCard from './ConfirmationCard';
import ProductCardInline from './ProductCardInline';
import SupportHandoffCard from './SupportHandoffCard';

const PRODUCT_SURFACES = new Set(['product_results', 'product_focus']);

const renderParagraphs = (text = '') => {
    const paragraphs = String(text || '')
        .split(/\n{2,}/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean);

    return (paragraphs.length > 0 ? paragraphs : [String(text || '')]).map((paragraph, index) => (
        <p key={`${paragraph}-${index}`} className="whitespace-pre-wrap break-words">
            {paragraph}
        </p>
    ));
};

const renderCartSummary = (cartSummary, isWhiteMode, t) => {
    if (!cartSummary) return null;

    const cardClassName = isWhiteMode
        ? 'border-slate-200 bg-slate-50 text-slate-950'
        : 'border-white/10 bg-white/[0.04] text-slate-100';
    const mutedTextClass = isWhiteMode ? 'text-slate-500' : 'text-slate-400';

    return (
        <div className={cn('rounded-[1.25rem] border p-4', cardClassName)}>
            <div className="flex items-center gap-2">
                <ShoppingCart className="h-4 w-4" />
                <p className="text-sm font-bold">{t('product.cartSummary', {}, 'Cart summary')}</p>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-3 text-xs">
                <div>
                    <span className={mutedTextClass}>{t('product.items', {}, 'Items')}</span>
                    <p className="mt-1 text-sm font-bold">{cartSummary.totalItems || 0}</p>
                </div>
                <div>
                    <span className={mutedTextClass}>{t('product.total', {}, 'Total')}</span>
                    <p className="mt-1 text-sm font-bold">{formatPrice(cartSummary.totalPrice, cartSummary.currency)}</p>
                </div>
                <div>
                    <span className={mutedTextClass}>{t('product.saved', {}, 'Saved')}</span>
                    <p className="mt-1 text-sm font-bold">{formatPrice(cartSummary.totalDiscount, cartSummary.currency)}</p>
                </div>
            </div>
        </div>
    );
};

const renderSearchSignal = (searchMeta, isWhiteMode, t) => {
    if (!searchMeta?.matchType || searchMeta.matchType === 'exact') {
        return null;
    }

    const noteClassName = isWhiteMode
        ? 'border-amber-200 bg-amber-50 text-amber-900'
        : 'border-amber-300/20 bg-amber-500/10 text-amber-100';
    const confidence = Math.round(Math.max(0, Number(searchMeta?.confidence || 0)) * 100);

    return (
        <div className={cn('rounded-[1rem] border px-3 py-2 text-[11px] font-medium', noteClassName)}>
            {t('product.closestMatches', {
                query: searchMeta.query || 'your search',
                confidence: confidence > 0 ? ` (${confidence}% confidence).` : '.',
            }, `No exact match for "${searchMeta.query || 'your search'}". Showing closest matches${confidence > 0 ? ` (${confidence}% confidence).` : '.'}`)}
        </div>
    );
};

const MessageItem = ({
    message,
    isWhiteMode = false,
    showProductCards = true,
    onSelectProduct,
    onAddToCart,
    onViewDetails,
    onOpenSupport,
    onConfirmPending,
    onCancelPending,
    onModifyPending,
}) => {
    const { t } = useMarket();
    const isUser = message?.role === 'user';
    const bubbleClassName = isUser
        ? (isWhiteMode
            ? 'border-slate-950 bg-slate-950 text-white'
            : 'border-cyan-400/20 bg-cyan-400/10 text-slate-50')
        : (isWhiteMode
            ? 'border-slate-200 bg-white text-slate-950'
            : 'border-white/8 bg-white/[0.045] text-slate-100');

    const messageMode = message?.mode || (Array.isArray(message?.products) && message.products.length === 1 ? 'product' : 'explore');
    const shouldRenderProducts = !isUser
        && showProductCards
        && PRODUCT_SURFACES.has(String(message?.uiSurface || ''))
        && Array.isArray(message?.products)
        && message.products.length > 0;
    const searchMeta = message?.assistantTurn?.ui?.search || null;

    return (
        <div className={cn('flex flex-col gap-3', isUser ? 'items-end' : 'items-start')}>
            <div className={cn('max-w-[92%] rounded-[1.55rem] border px-4 py-3 text-sm leading-6 shadow-sm sm:max-w-[82%]', bubbleClassName)}>
                <div className="space-y-3">
                    {renderParagraphs(message?.text)}
                </div>
            </div>

            {!isUser && message?.cartSummary ? renderCartSummary(message.cartSummary, isWhiteMode, t) : null}
            {!isUser ? renderSearchSignal(searchMeta, isWhiteMode, t) : null}

            {shouldRenderProducts ? (
                <div className="grid w-full gap-3">
                    {message.products.map((product) => (
                        <ProductCardInline
                            key={product.id}
                            product={product}
                            mode={messageMode}
                            isWhiteMode={isWhiteMode}
                            onSelect={onSelectProduct}
                            onAddToCart={onAddToCart}
                            onViewDetails={onViewDetails}
                        />
                    ))}
                </div>
            ) : null}

            {!isUser && message?.confirmation ? (
                <ConfirmationCard
                    confirmation={message.confirmation}
                    isWhiteMode={isWhiteMode}
                    onConfirm={onConfirmPending}
                    onCancel={onCancelPending}
                    onModify={onModifyPending}
                />
            ) : null}

            {!isUser && (message?.supportPrefill || message?.assistantTurn?.ui?.support?.orderId) ? (
                <SupportHandoffCard
                    prefill={message.supportPrefill}
                    orderId={message?.assistantTurn?.ui?.support?.orderId || ''}
                    isWhiteMode={isWhiteMode}
                    onOpenSupport={onOpenSupport}
                />
            ) : null}
        </div>
    );
};

export default MessageItem;
