import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import MessageItem from './MessageItem';

const MessageList = ({
    messages = [],
    isLoading = false,
    isWhiteMode = false,
    onSelectProduct,
    onAddToCart,
    onViewDetails,
    onOpenSupport,
    onConfirmPending,
    onCancelPending,
    onModifyPending,
}) => {
    const endRef = useRef(null);
    const latestAssistantMessageId = [...messages]
        .reverse()
        .find((message) => message?.role === 'assistant')
        ?.id || null;

    useEffect(() => {
        endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, [isLoading, messages]);

    const loadingBubbleClass = isWhiteMode
        ? 'border-slate-200 bg-white'
        : 'border-white/10 bg-white/[0.04]';

    return (
        <div className="flex-1 overflow-y-auto px-5 py-4 sm:px-8 sm:py-6">
            <div className="mx-auto w-full max-w-4xl space-y-6">
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

                {isLoading ? (
                    <div className="flex items-start">
                        <div className={cn('rounded-[1.4rem] border px-4 py-3 shadow-sm', loadingBubbleClass)}>
                            <div className="flex items-center gap-2">
                                <span className="h-2 w-2 animate-bounce rounded-full bg-cyan-400" />
                                <span className="h-2 w-2 animate-bounce rounded-full bg-emerald-400 [animation-delay:100ms]" />
                                <span className="h-2 w-2 animate-bounce rounded-full bg-amber-400 [animation-delay:200ms]" />
                            </div>
                        </div>
                    </div>
                ) : null}

                <div ref={endRef} />
            </div>
        </div>
    );
};

export default MessageList;
