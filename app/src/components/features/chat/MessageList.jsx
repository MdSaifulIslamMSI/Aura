import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import MessageItem from './MessageItem';

const SCROLL_LOCK_THRESHOLD = 120;

const isNearBottom = (element) => {
    if (!element) return true;
    return (element.scrollHeight - element.scrollTop - element.clientHeight) < SCROLL_LOCK_THRESHOLD;
};

const scrollContainerToBottom = (element, behavior = 'smooth') => {
    if (!element) {
        return;
    }

    if (typeof element.scrollTo === 'function') {
        element.scrollTo({
            top: element.scrollHeight,
            behavior,
        });
        return;
    }

    element.scrollTop = element.scrollHeight;
};

const MessageList = ({
    messages = [],
    isLoading = false,
    isWhiteMode = false,
    className = '',
    onSelectProduct,
    onAddToCart,
    onViewDetails,
    onOpenSupport,
    onConfirmPending,
    onCancelPending,
    onModifyPending,
}) => {
    const containerRef = useRef(null);
    const shouldStickToBottomRef = useRef(true);
    const latestAssistantMessageId = [...messages]
        .reverse()
        .find((message) => message?.role === 'assistant')
        ?.id || null;
    const hasStreamingAssistantMessage = Array.isArray(messages)
        && messages.some((message) => message?.role === 'assistant' && message?.isStreaming);

    useEffect(() => {
        if (!shouldStickToBottomRef.current) {
            return;
        }

        scrollContainerToBottom(containerRef.current, hasStreamingAssistantMessage ? 'auto' : 'smooth');
    }, [hasStreamingAssistantMessage, isLoading, messages]);

    const handleScroll = () => {
        shouldStickToBottomRef.current = isNearBottom(containerRef.current);
    };

    useEffect(() => {
        shouldStickToBottomRef.current = isNearBottom(containerRef.current);
    }, [isLoading, messages]);

    const loadingBubbleClass = isWhiteMode
        ? 'border-slate-200 bg-white'
        : 'border-white/10 bg-white/[0.03]';

    return (
        <div
            ref={containerRef}
            onScroll={handleScroll}
            className={cn('flex-1 overflow-y-auto overscroll-contain px-4 py-6 sm:px-8 sm:py-8', className)}
        >
            <div className="mx-auto w-full max-w-4xl space-y-8">
                {messages.map((message) => (
                    <MessageItem
                        key={message.id}
                        message={message}
                        isWhiteMode={isWhiteMode}
                        showProductCards={message.id === latestAssistantMessageId}
                        onSelectProduct={onSelectProduct}
                        onAddToCart={onAddToCart}
                        onViewDetails={onViewDetails}
                        onOpenSupport={onOpenSupport}
                        onConfirmPending={onConfirmPending}
                        onCancelPending={onCancelPending}
                        onModifyPending={onModifyPending}
                    />
                ))}

                {isLoading && !hasStreamingAssistantMessage ? (
                    <div className="flex items-start">
                        <div className={cn('rounded-full border px-4 py-3 shadow-sm', loadingBubbleClass)}>
                            <div className="flex items-center gap-2">
                                <span className="h-2 w-2 animate-bounce rounded-full bg-cyan-400" />
                                <span className="h-2 w-2 animate-bounce rounded-full bg-emerald-400 [animation-delay:100ms]" />
                                <span className="h-2 w-2 animate-bounce rounded-full bg-amber-400 [animation-delay:200ms]" />
                            </div>
                        </div>
                    </div>
                ) : null}
            </div>
        </div>
    );
};

export default MessageList;
