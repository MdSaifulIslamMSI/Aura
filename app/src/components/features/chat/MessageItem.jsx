import { AudioLines, Image as ImageIcon, ShoppingCart } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useMarket } from '@/context/MarketContext';
import { cn } from '@/lib/utils';
import { formatPrice } from '@/utils/format';
import ConfirmationCard from './ConfirmationCard';
import ProductCardInline from './ProductCardInline';
import SupportHandoffCard from './SupportHandoffCard';

const PRODUCT_SURFACES = new Set(['product_results', 'product_focus']);
const STATUS_BADGES = {
    thinking: {
        label: 'Analyzing',
        darkClassName: 'border-cyan-400/20 bg-cyan-500/10 text-cyan-100',
        lightClassName: 'border-cyan-200 bg-cyan-50 text-cyan-800',
    },
    provisional: {
        label: 'Fast',
        darkClassName: 'border-amber-400/20 bg-amber-500/10 text-amber-100',
        lightClassName: 'border-amber-200 bg-amber-50 text-amber-900',
    },
    upgraded: {
        label: 'Refined',
        darkClassName: 'border-emerald-400/20 bg-emerald-500/10 text-emerald-100',
        lightClassName: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    },
    error: {
        label: 'Error',
        darkClassName: 'border-rose-400/20 bg-rose-500/10 text-rose-100',
        lightClassName: 'border-rose-200 bg-rose-50 text-rose-800',
    },
};
const VERIFICATION_LABELS = {
    app_grounded: 'App-grounded',
    runtime_grounded: 'Runtime-grounded',
    model_knowledge: 'Model knowledge',
    cannot_verify: 'Cannot verify',
};

const buildCapabilityEntries = (capabilities = null) => {
    if (!capabilities || typeof capabilities !== 'object') {
        return [];
    }

    return [
        {
            key: 'text',
            label: 'Text',
            enabled: capabilities.textInput !== false,
        },
        {
            key: 'image',
            label: 'Image',
            enabled: Boolean(capabilities.imageInput),
        },
        {
            key: 'audio',
            label: 'Audio',
            enabled: Boolean(capabilities.audioInput),
        },
    ];
};

const renderMarkdown = (text = '', isWhiteMode = false) => {
    if (!String(text || '').trim()) {
        return null;
    }

    return (
        <div className={cn(
            'prose max-w-none text-[15px] leading-7',
            'prose-p:my-0 prose-pre:my-0 prose-pre:overflow-x-auto prose-pre:rounded-[1.2rem] prose-pre:border prose-pre:px-4 prose-pre:py-3',
            'prose-code:rounded prose-code:px-1 prose-code:py-0.5 prose-code:before:content-none prose-code:after:content-none',
            'prose-ul:my-2 prose-ol:my-2 prose-li:my-1 prose-strong:font-semibold',
            isWhiteMode
                ? 'prose-slate prose-code:bg-slate-100 prose-pre:border-slate-200 prose-pre:bg-slate-950 prose-pre:text-slate-100'
                : 'prose-invert prose-code:bg-white/10 prose-pre:border-white/10 prose-pre:bg-[#02060a]',
        )}>
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                    a: ({ node: _node, ...props }) => (
                        <a {...props} target="_blank" rel="noreferrer" />
                    ),
                }}
            >
                {String(text || '')}
            </ReactMarkdown>
        </div>
    );
};

const getMessageBadge = (message = {}) => {
    if (message?.status === 'error') return STATUS_BADGES.error;
    if (message?.upgraded) return STATUS_BADGES.upgraded;
    if (message?.provisional) return STATUS_BADGES.provisional;
    if (message?.status === 'thinking' || message?.isStreaming) return STATUS_BADGES.thinking;
    return null;
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
    const capabilityEntries = buildCapabilityEntries(message?.providerCapabilities || null);
    const guardReason = String(grounding?.reason || '').trim();

    if (!verification && citations.length === 0 && toolRuns.length === 0 && !grounding && !providerInfo && capabilityEntries.length === 0) {
        return null;
    }

    const panelClassName = isWhiteMode
        ? 'border-slate-200 bg-slate-50 text-slate-900'
        : 'border-white/10 bg-white/[0.04] text-slate-100';
    const subtleTextClass = isWhiteMode ? 'text-slate-500' : 'text-slate-400';
    const chipClassName = isWhiteMode
        ? 'border-slate-200 bg-white text-slate-700'
        : 'border-white/10 bg-white/[0.05] text-slate-200';
    const route = String(grounding?.route || '').trim();
    const retrievalHitCount = Math.max(0, Number(grounding?.retrievalHitCount || 0));
    const providerName = String(grounding?.provider || providerInfo?.name || '').trim();
    const providerModel = String(grounding?.providerModel || providerInfo?.model || '').trim();

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

            {(route || providerName || retrievalHitCount > 0) ? (
                <div className="mt-3 flex flex-wrap gap-2">
                    {route ? (
                        <span className={cn('rounded-full border px-2.5 py-1', chipClassName)}>
                            Route: {route.replace(/_/g, ' ')}
                        </span>
                    ) : null}
                    {retrievalHitCount > 0 ? (
                        <span className={cn('rounded-full border px-2.5 py-1', chipClassName)}>
                            Hits: {retrievalHitCount}
                        </span>
                    ) : null}
                    {providerName ? (
                        <span className={cn('rounded-full border px-2.5 py-1', chipClassName)}>
                            {providerModel ? `${providerName} \u00b7 ${providerModel}` : providerName}
                        </span>
                    ) : null}
                </div>
            ) : null}

            {capabilityEntries.length > 0 ? (
                <div className="mt-3">
                    <p className={cn('mb-2 text-[10px] font-black uppercase tracking-[0.18em]', subtleTextClass)}>Input surface</p>
                    <div className="flex flex-wrap gap-2">
                        {capabilityEntries.map((entry) => (
                            <span
                                key={entry.key}
                                className={cn(
                                    'rounded-full border px-2.5 py-1 font-semibold',
                                    entry.enabled
                                        ? chipClassName
                                        : (isWhiteMode
                                            ? 'border-amber-200 bg-amber-50 text-amber-900'
                                            : 'border-amber-300/20 bg-amber-500/10 text-amber-100')
                                )}
                            >
                                {entry.enabled ? `${entry.label} ready` : `${entry.label} gated`}
                            </span>
                        ))}
                    </div>
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

const renderUserMediaAttachments = (message = {}, isWhiteMode = false) => {
    const images = Array.isArray(message?.images) ? message.images.filter((entry) => String(entry?.dataUrl || entry?.url || '').trim()) : [];
    const audio = Array.isArray(message?.audio) ? message.audio.filter((entry) => String(entry?.fileName || entry?.mimeType || '').trim()) : [];

    if (images.length === 0 && audio.length === 0) {
        return null;
    }

    const surfaceClassName = isWhiteMode
        ? 'border-slate-200/90 bg-slate-100/80'
        : 'border-white/10 bg-white/[0.08]';
    const subtleTextClass = isWhiteMode ? 'text-slate-500' : 'text-white/65';

    return (
        <div className="space-y-3">
            {images.length > 0 ? (
                <div className={cn('grid gap-2', images.length > 1 ? 'grid-cols-2' : 'grid-cols-1')}>
                    {images.slice(0, 3).map((image, index) => (
                        <div key={image.id || image.fileName || index} className={cn('overflow-hidden rounded-[1.15rem] border', surfaceClassName)}>
                            <div className="flex items-center gap-2 border-b border-black/5 px-3 py-2 text-[11px] font-semibold">
                                <ImageIcon className="h-3.5 w-3.5" />
                                <span className="truncate">{image.fileName || `Image ${index + 1}`}</span>
                            </div>
                            <img
                                src={image.dataUrl || image.url}
                                alt={image.fileName || `Attachment ${index + 1}`}
                                className="h-28 w-full object-cover"
                            />
                        </div>
                    ))}
                </div>
            ) : null}

            {audio.length > 0 ? (
                <div className="flex flex-col gap-2">
                    {audio.slice(0, 3).map((entry, index) => (
                        <div
                            key={entry.id || entry.fileName || index}
                            className={cn('flex items-center gap-3 rounded-[1rem] border px-3 py-2.5', surfaceClassName)}
                        >
                            <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-current/15 bg-white/10">
                                <AudioLines className="h-4 w-4" />
                            </span>
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-semibold">{entry.fileName || 'Audio note'}</p>
                                <p className={cn('text-[11px]', subtleTextClass)}>{entry.mimeType || 'audio upload'}</p>
                            </div>
                        </div>
                    ))}
                </div>
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
    const laneClass = 'w-full max-w-4xl';
    const userBubbleClassName = isWhiteMode
        ? 'border-slate-200 bg-slate-950 text-white'
        : 'border-white/10 bg-white/[0.06] text-white shadow-[0_12px_40px_rgba(0,0,0,0.28)]';
    const assistantTextClassName = isWhiteMode
        ? 'text-slate-950'
        : 'text-white';
    const assistantBubbleClassName = isWhiteMode
        ? 'border-slate-200/80 bg-white/90 text-slate-950 shadow-[0_10px_40px_rgba(15,23,42,0.08)]'
        : 'border-white/10 bg-white/[0.03] text-white shadow-[0_12px_40px_rgba(0,0,0,0.22)]';

    const messageMode = message?.mode || (Array.isArray(message?.products) && message.products.length === 1 ? 'product' : 'explore');
    const shouldRenderProducts = !isUser
        && showProductCards
        && PRODUCT_SURFACES.has(String(message?.uiSurface || ''))
        && Array.isArray(message?.products)
        && message.products.length > 0;
    const searchMeta = message?.assistantTurn?.ui?.search || null;
    const displayText = !isUser && message?.isStreaming && !String(message?.text || '').trim()
        ? ''
        : message?.text;
    const messageBadge = getMessageBadge(message);
    const userMedia = renderUserMediaAttachments(message, isWhiteMode);

    return (
        <div className={cn('flex w-full flex-col gap-3.5', isUser ? 'items-end' : 'items-start')}>
            <div className={laneClass}>
                <div className={cn('flex w-full', isUser ? 'justify-end' : 'justify-start')}>
                    <div
                        className={cn(
                            isUser
                                ? cn(
                                    'max-w-[70%] border px-5 py-3 text-[15px] leading-7 sm:max-w-[58%]',
                                    userMedia ? 'rounded-[1.5rem]' : 'rounded-full'
                                )
                                : 'max-w-[88%] rounded-[1.5rem] border px-4 py-3 transition-all duration-200 sm:max-w-[78%] sm:px-5',
                            isUser ? userBubbleClassName : assistantBubbleClassName,
                        )}
                    >
                        {isUser ? (
                            <div className="space-y-3 whitespace-pre-wrap break-words">
                                {displayText ? <div>{displayText}</div> : null}
                                {userMedia}
                            </div>
                        ) : (
                            <div className={cn('space-y-3', assistantTextClassName)}>
                                {messageBadge ? (
                                    <span className={cn(
                                        'inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em]',
                                        isWhiteMode ? messageBadge.lightClassName : messageBadge.darkClassName,
                                    )}>
                                        {messageBadge.label}
                                    </span>
                                ) : null}

                                {displayText ? (
                                    renderMarkdown(displayText, isWhiteMode)
                                ) : (
                                    <div className="flex items-center gap-2 text-sm text-slate-400">
                                        <span className="h-2 w-2 animate-pulse rounded-full bg-cyan-400" />
                                        <span>Working through live evidence...</span>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {!isUser && message?.cartSummary ? (
                <div className={cn(laneClass, 'max-w-[88%] sm:max-w-[78%]')}>
                    {renderCartSummary(message.cartSummary, isWhiteMode, t)}
                </div>
            ) : null}
            {!isUser ? (
                <div className={cn(laneClass, 'max-w-[88%] sm:max-w-[78%]')}>
                    {renderSearchSignal(searchMeta, isWhiteMode, t)}
                </div>
            ) : null}
            {!isUser ? (
                <div className={cn(laneClass, 'max-w-[88%] sm:max-w-[78%]')}>
                    {renderGroundingMeta(message, isWhiteMode)}
                </div>
            ) : null}

            {shouldRenderProducts ? (
                <div className="grid w-full max-w-[88%] gap-3 sm:max-w-[78%]">
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
                <div className={cn(laneClass, 'max-w-[88%] sm:max-w-[78%]')}>
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
                <div className={cn(laneClass, 'max-w-[88%] sm:max-w-[78%]')}>
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
