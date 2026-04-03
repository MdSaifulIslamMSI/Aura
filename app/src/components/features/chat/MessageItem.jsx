import { ShoppingCart } from 'lucide-react';
import { useMarket } from '@/context/MarketContext';
import { cn } from '@/lib/utils';
import { formatPrice } from '@/utils/format';
import ConfirmationCard from './ConfirmationCard';
import ProductCardInline from './ProductCardInline';
import SupportHandoffCard from './SupportHandoffCard';

const PRODUCT_SURFACES = new Set(['product_results', 'product_focus']);
const VERIFICATION_LABELS = {
    app_grounded: 'App-grounded',
    runtime_grounded: 'Runtime-grounded',
    model_knowledge: 'Model knowledge',
    cannot_verify: 'Cannot verify',
};

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

const getVerificationClassName = (label = '', isWhiteMode = false) => {
    switch (String(label || '').trim()) {
        case 'app_grounded':
            return isWhiteMode
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : 'border-emerald-400/20 bg-emerald-500/10 text-emerald-100';
        case 'runtime_grounded':
            return isWhiteMode
                ? 'border-cyan-200 bg-cyan-50 text-cyan-800'
                : 'border-cyan-400/20 bg-cyan-500/10 text-cyan-100';
        case 'model_knowledge':
            return isWhiteMode
                ? 'border-violet-200 bg-violet-50 text-violet-800'
                : 'border-violet-400/20 bg-violet-500/10 text-violet-100';
        default:
            return isWhiteMode
                ? 'border-amber-200 bg-amber-50 text-amber-900'
                : 'border-amber-300/20 bg-amber-500/10 text-amber-100';
    }
};

const renderGroundingMeta = (message, isWhiteMode) => {
    const verification = message?.assistantTurn?.verification || null;
    const citations = Array.isArray(message?.assistantTurn?.citations) ? message.assistantTurn.citations.slice(0, 4) : [];
    const toolRuns = Array.isArray(message?.assistantTurn?.toolRuns) ? message.assistantTurn.toolRuns.slice(0, 6) : [];
    const grounding = message?.grounding || null;
    const providerInfo = message?.providerInfo || null;
    const guardReason = String(grounding?.reason || '').trim();

    if (!verification && citations.length === 0 && toolRuns.length === 0 && !grounding && !providerInfo) {
        return null;
    }

    const panelClassName = isWhiteMode
        ? 'border-slate-200 bg-slate-50 text-slate-900'
        : 'border-white/10 bg-white/[0.04] text-slate-100';
    const subtleTextClass = isWhiteMode ? 'text-slate-500' : 'text-slate-400';
    const chipClassName = isWhiteMode
        ? 'border-slate-200 bg-white text-slate-700'
        : 'border-white/10 bg-white/[0.05] text-slate-200';

    return (
        <div className={cn('w-full rounded-[1.1rem] border px-3 py-3 text-xs', panelClassName)}>
            {verification ? (
                <div className="flex flex-wrap items-center gap-2">
                    <span className={cn('rounded-full border px-2.5 py-1 font-semibold', getVerificationClassName(verification.label, isWhiteMode))}>
                        {VERIFICATION_LABELS[verification.label] || 'Verified'}
                    </span>
                    {verification.summary ? (
                        <p className={cn('text-[11px]', subtleTextClass)}>{verification.summary}</p>
                    ) : null}
                </div>
            ) : null}

            {citations.length > 0 ? (
                <div className="mt-3">
                    <p className={cn('mb-2 text-[10px] font-black uppercase tracking-[0.18em]', subtleTextClass)}>Sources</p>
                    <div className="flex flex-wrap gap-2">
                        {citations.map((citation) => (
                            <span key={citation.id || `${citation.path}-${citation.startLine}`} className={cn('rounded-full border px-2.5 py-1', chipClassName)}>
                                {citation.label || citation.path}
                            </span>
                        ))}
                    </div>
                </div>
            ) : null}

            {toolRuns.length > 0 ? (
                <div className="mt-3">
                    <p className={cn('mb-2 text-[10px] font-black uppercase tracking-[0.18em]', subtleTextClass)}>Tool timeline</p>
                    <div className="space-y-2">
                        {toolRuns.map((toolRun) => (
                            <div key={toolRun.id || toolRun.toolName} className="flex items-start justify-between gap-3">
                                <div>
                                    <p className="font-semibold">{toolRun.toolName}</p>
                                    {toolRun.summary ? (
                                        <p className={cn('mt-0.5 text-[11px]', subtleTextClass)}>{toolRun.summary}</p>
                                    ) : null}
                                </div>
                                <span className={cn('whitespace-nowrap text-[11px]', subtleTextClass)}>
                                    {toolRun.latencyMs ? `${toolRun.latencyMs} ms` : toolRun.status || 'done'}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            ) : null}

            {(grounding?.traceId || grounding?.bundleVersion || providerInfo?.model) ? (
                <details className="mt-3">
                    <summary className={cn('cursor-pointer text-[10px] font-black uppercase tracking-[0.18em]', subtleTextClass)}>
                        Trace details
                    </summary>
                    <div className={cn('mt-2 space-y-1 text-[11px]', subtleTextClass)}>
                        {grounding?.status ? <p>Status: {grounding.status}</p> : null}
                        {guardReason ? <p>Guard: {guardReason.replace(/_/g, ' ')}</p> : null}
                        {grounding?.staleBundle ? <p>Bundle state: stale</p> : null}
                        {grounding?.missingEvidence ? <p>Evidence state: missing</p> : null}
                        {grounding?.bundleVersion ? <p>Index version: {grounding.bundleVersion}</p> : null}
                        {grounding?.traceId ? <p>Trace id: {grounding.traceId}</p> : null}
                        {providerInfo?.model ? <p>Model: {providerInfo.model}</p> : null}
                    </div>
                </details>
            ) : null}
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
    const messageColumnClass = isUser
        ? 'w-full max-w-[78%] sm:max-w-[72%]'
        : 'w-full max-w-[88%] sm:max-w-[82%]';
    const bubbleClassName = isUser
        ? (isWhiteMode
            ? 'border-slate-950 bg-slate-950 text-white'
            : 'border-cyan-400/25 bg-[linear-gradient(135deg,rgba(6,182,212,0.18),rgba(14,165,233,0.1))] text-slate-50 shadow-[0_12px_32px_rgba(8,145,178,0.08)]')
        : (isWhiteMode
            ? 'border-slate-200 bg-white text-slate-950'
            : 'border-white/8 bg-[#151922]/92 text-slate-100 shadow-[0_10px_30px_rgba(2,6,23,0.45)]');

    const messageMode = message?.mode || (Array.isArray(message?.products) && message.products.length === 1 ? 'product' : 'explore');
    const shouldRenderProducts = !isUser
        && showProductCards
        && PRODUCT_SURFACES.has(String(message?.uiSurface || ''))
        && Array.isArray(message?.products)
        && message.products.length > 0;
    const searchMeta = message?.assistantTurn?.ui?.search || null;
    const displayText = !isUser && message?.isStreaming && !String(message?.text || '').trim()
        ? 'Working through live evidence...'
        : message?.text;

    return (
        <div className={cn('flex w-full flex-col gap-2.5', isUser ? 'items-end' : 'items-start')}>
            <div className={cn(messageColumnClass, 'rounded-[1.45rem] border px-4 py-3 text-sm leading-6', bubbleClassName)}>
                <div className="space-y-3">
                    {renderParagraphs(displayText)}
                </div>
            </div>

            {!isUser && message?.cartSummary ? (
                <div className={messageColumnClass}>
                    {renderCartSummary(message.cartSummary, isWhiteMode, t)}
                </div>
            ) : null}
            {!isUser ? (
                <div className={messageColumnClass}>
                    {renderSearchSignal(searchMeta, isWhiteMode, t)}
                </div>
            ) : null}
            {!isUser ? (
                <div className={messageColumnClass}>
                    {renderGroundingMeta(message, isWhiteMode)}
                </div>
            ) : null}

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
                <div className={messageColumnClass}>
                    <ConfirmationCard
                        confirmation={message.confirmation}
                        isWhiteMode={isWhiteMode}
                        onConfirm={onConfirmPending}
                        onCancel={onCancelPending}
                        onModify={onModifyPending}
                    />
                </div>
            ) : null}

            {!isUser && (message?.supportPrefill || message?.assistantTurn?.ui?.support?.orderId) ? (
                <div className={messageColumnClass}>
                    <SupportHandoffCard
                        prefill={message.supportPrefill}
                        orderId={message?.assistantTurn?.ui?.support?.orderId || ''}
                        isWhiteMode={isWhiteMode}
                        onOpenSupport={onOpenSupport}
                    />
                </div>
            ) : null}
        </div>
    );
};

export default MessageItem;
