import { ShoppingCart } from 'lucide-react';
import { cn } from '@/lib/utils';
import ConfirmationCard from './ConfirmationCard';
import ProductCardInline from './ProductCardInline';
import SupportHandoffCard from './SupportHandoffCard';

const formatInr = (value = 0) => `Rs ${Number(value || 0).toLocaleString('en-IN')}`;
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

const renderCartSummary = (cartSummary, isWhiteMode) => {
    if (!cartSummary) return null;

    const cardClassName = isWhiteMode
        ? 'border-slate-200 bg-slate-50 text-slate-950'
        : 'border-white/10 bg-white/[0.04] text-slate-100';
    const mutedTextClass = isWhiteMode ? 'text-slate-500' : 'text-slate-400';

    return (
        <div className={cn('rounded-[1.25rem] border p-4', cardClassName)}>
            <div className="flex items-center gap-2">
                <ShoppingCart className="h-4 w-4" />
                <p className="text-sm font-bold">Cart summary</p>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-3 text-xs">
                <div>
                    <span className={mutedTextClass}>Items</span>
                    <p className="mt-1 text-sm font-bold">{cartSummary.totalItems || 0}</p>
                </div>
                <div>
                    <span className={mutedTextClass}>Total</span>
                    <p className="mt-1 text-sm font-bold">{formatInr(cartSummary.totalPrice)}</p>
                </div>
                <div>
                    <span className={mutedTextClass}>Saved</span>
                    <p className="mt-1 text-sm font-bold">{formatInr(cartSummary.totalDiscount)}</p>
                </div>
            </div>
        </div>
    );
};

const MessageItem = ({
    message,
    isWhiteMode = false,
    onSelectProduct,
    onAddToCart,
    onViewDetails,
    onOpenSupport,
    onConfirmPending,
    onCancelPending,
}) => {
    const isUser = message?.role === 'user';
    const bubbleClassName = isUser
        ? (isWhiteMode
            ? 'border-slate-950 bg-slate-950 text-white'
            : 'border-cyan-400/20 bg-cyan-400/10 text-slate-50')
        : (isWhiteMode
            ? 'border-slate-200 bg-white text-slate-950'
            : 'border-white/10 bg-white/[0.04] text-slate-100');

    const messageMode = message?.mode || (Array.isArray(message?.products) && message.products.length === 1 ? 'product' : 'explore');
    const shouldRenderProducts = !isUser
        && PRODUCT_SURFACES.has(String(message?.uiSurface || ''))
        && Array.isArray(message?.products)
        && message.products.length > 0;

    return (
        <div className={cn('flex flex-col gap-3', isUser ? 'items-end' : 'items-start')}>
            <div className={cn('max-w-[92%] rounded-[1.4rem] border px-4 py-3 text-sm leading-6 shadow-sm', bubbleClassName)}>
                <div className="space-y-3">
                    {renderParagraphs(message?.text)}
                </div>
            </div>

            {!isUser && message?.cartSummary ? renderCartSummary(message.cartSummary, isWhiteMode) : null}

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
