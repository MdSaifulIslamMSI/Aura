import { useEffect } from 'react';
import { MessageCircle } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { useColorMode } from '@/context/ColorModeContext';
import { cn } from '@/lib/utils';
import { useSpeechInput } from '@/hooks/useSpeechInput';
import { useChatStore } from '@/store/chatStore';
import { getAssistantRouteLabel } from '@/utils/assistantCommands';
import ChatContainer from './ChatContainer';
import { useAssistantController } from './useAssistantController';

const MODE_COPY = {
    explore: {
        label: 'Explore',
        subtitle: 'Describe what you want. The assistant keeps the result set tight and focused.',
    },
    product: {
        label: 'Decide',
        subtitle: 'One product is in focus. The only next moves are detail or purchase.',
    },
    cart: {
        label: 'Cart',
        subtitle: 'Review the purchase without mixing in browsing or support noise.',
    },
    checkout: {
        label: 'Checkout',
        subtitle: 'Confirm critical purchase steps before the assistant executes them.',
    },
    support: {
        label: 'Support',
        subtitle: 'Order help routes into the right thread, and the support desk can accelerate into voice or video without losing context.',
    },
};

const ChatBot = () => {
    const location = useLocation();
    const { colorMode } = useColorMode();

    const isOpen = useChatStore((state) => state.isOpen);
    const mode = useChatStore((state) => state.mode);
    const isLoading = useChatStore((state) => state.isLoading);
    const inputValue = useChatStore((state) => state.inputValue);
    const messages = useChatStore((state) => state.messages);
    const primaryAction = useChatStore((state) => state.primaryAction);
    const secondaryActions = useChatStore((state) => state.secondaryActions);
    const open = useChatStore((state) => state.open);
    const close = useChatStore((state) => state.close);
    const setInputValue = useChatStore((state) => state.setInputValue);

    const {
        inputRef,
        addProductToCart,
        cancelPendingAction,
        confirmPendingAction,
        handleAction,
        handleUserInput,
        modifyPendingAction,
        openSupport,
        selectProduct,
    } = useAssistantController();

    const isWhiteMode = colorMode === 'white';
    const routeLabel = getAssistantRouteLabel(location.pathname);
    const modeCopy = MODE_COPY[mode] || MODE_COPY.explore;
    const launcherClassName = isWhiteMode
        ? 'border-slate-200/90 bg-white/95 text-slate-950 shadow-[0_18px_48px_rgba(15,23,42,0.14)]'
        : 'border-white/10 bg-[linear-gradient(135deg,rgba(6,10,24,0.96),rgba(10,18,34,0.96))] text-slate-50 shadow-[0_22px_60px_rgba(2,6,23,0.56)]';
    const {
        isListening,
        supportsSpeechInput: supportsDictation,
        stopListening,
        toggleListening,
    } = useSpeechInput({
        value: inputValue,
        onChange: setInputValue,
        clearOnStart: true,
        lang: 'en-IN',
    });

    useEffect(() => {
        if (!isOpen) return;
        window.requestAnimationFrame(() => inputRef.current?.focus());
    }, [inputRef, isOpen]);

    useEffect(() => {
        const handleKeyDown = (event) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
                event.preventDefault();
                open();
            }

            if (event.key === 'Escape' && isOpen) {
                close();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [close, isOpen, open]);

    const portalTarget = typeof document !== 'undefined' ? document.body : null;
    if (!portalTarget) return null;

    return createPortal(
        <div
            className={cn(
                'pointer-events-none fixed inset-0 z-[2147483600] flex',
                isOpen
                    ? 'items-stretch justify-stretch p-2 sm:p-4 lg:p-6'
                    : 'items-end justify-end p-4 sm:p-6'
            )}
        >
            {isOpen ? (
                <>
                    <div
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-0 bg-slate-950/42 backdrop-blur-[2px]"
                    />
                    <div className="pointer-events-none relative flex w-full items-stretch justify-end">
                        <ChatContainer
                            isWhiteMode={isWhiteMode}
                            modeLabel={modeCopy.label}
                            subtitle={modeCopy.subtitle}
                            routeLabel={routeLabel}
                            messages={messages}
                            isLoading={isLoading}
                            inputValue={inputValue}
                            isListening={isListening}
                            supportsDictation={supportsDictation}
                            primaryAction={primaryAction}
                            secondaryActions={secondaryActions}
                            inputRef={inputRef}
                            onClose={() => {
                                stopListening();
                                close();
                            }}
                            onInputChange={setInputValue}
                            onSubmit={(event) => {
                                event?.preventDefault?.();
                                if (isListening) {
                                    stopListening();
                                }
                                void handleUserInput(inputValue);
                            }}
                            onToggleDictation={toggleListening}
                            onAction={handleAction}
                            onSelectProduct={(productId) => void selectProduct(productId)}
                            onAddToCart={(productId) => void addProductToCart(productId)}
                            onViewDetails={(productId) => void selectProduct(productId)}
                            onOpenSupport={(prefill, orderId) => void openSupport(prefill, orderId)}
                            onConfirmPending={(token) => void confirmPendingAction(token)}
                            onCancelPending={cancelPendingAction}
                            onModifyPending={modifyPendingAction}
                        />
                    </div>
                </>
            ) : (
                <button
                    type="button"
                    onClick={open}
                    className={cn('pointer-events-auto flex items-center gap-3 rounded-full border px-4 py-3 backdrop-blur-xl transition-transform duration-300 hover:-translate-y-0.5', launcherClassName)}
                >
                    <div className={cn(
                        'flex h-11 w-11 items-center justify-center rounded-full border',
                        isWhiteMode
                            ? 'border-cyan-200 bg-cyan-500/10 text-cyan-700'
                            : 'border-cyan-400/20 bg-cyan-400/10 text-cyan-100'
                    )}>
                        <MessageCircle className="h-5 w-5" />
                    </div>
                    <div className="hidden text-left sm:block">
                        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan-300">Multimodal Assistant</p>
                        <p className="text-sm font-semibold">Chat, voice, live inspect</p>
                    </div>
                </button>
            )}
        </div>,
        portalTarget
    );
};

export default ChatBot;
