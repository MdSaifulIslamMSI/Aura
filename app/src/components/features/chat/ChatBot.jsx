import { useContext, useEffect, useState } from 'react';
import { MessageCircle, Sparkles } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { AuthContext } from '@/context/AuthContext';
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
    const { currentUser } = useContext(AuthContext);
    const [workspaceVariant, setWorkspaceVariant] = useState('large');
    const hasMobileStickyCommerceBar = location.pathname.startsWith('/product/');

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
    const resetConversation = useChatStore((state) => state.resetConversation);

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
    const currentUserLabel = currentUser?.displayName
        || currentUser?.email?.split('@')?.[0]
        || 'there';
    const launcherClassName = isWhiteMode
        ? 'border-slate-200 bg-white text-slate-900 shadow-[0_0_0_1px_rgba(255,255,255,0.65),0_18px_50px_rgba(15,23,42,0.16)] hover:scale-[1.03]'
        : 'border-white/10 bg-[#031019] text-white shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_0_42px_rgba(255,255,255,0.14),0_24px_80px_rgba(0,0,0,0.62)] hover:scale-[1.03]';
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
                    ? 'items-center justify-center p-3 sm:p-5 lg:p-6'
                    : 'items-end justify-end p-4 sm:p-6',
                !isOpen && hasMobileStickyCommerceBar
                    ? 'pb-[calc(7.25rem+env(safe-area-inset-bottom))] sm:pb-6'
                    : null
            )}
        >
            {isOpen ? (
                <>
                    <div
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-0 bg-slate-950/42 backdrop-blur-[2px]"
                    />
                    <div
                        className={cn(
                            'pointer-events-none relative flex w-full items-stretch',
                            'justify-center',
                        )}
                    >
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
                            currentUserLabel={currentUserLabel}
                            workspaceVariant={workspaceVariant}
                            onClose={() => {
                                stopListening();
                                close();
                            }}
                            onSetWorkspaceVariant={setWorkspaceVariant}
                            onStartFresh={() => {
                                stopListening();
                                resetConversation();
                                setInputValue('');
                                window.requestAnimationFrame(() => inputRef.current?.focus());
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
                            onStarterPrompt={(prompt) => void handleUserInput(prompt)}
                        />
                    </div>
                </>
            ) : (
                <button
                    type="button"
                    onClick={open}
                    className={cn('group pointer-events-auto flex h-24 w-24 items-center justify-center rounded-[30px] border backdrop-blur-3xl transition-all duration-300', launcherClassName)}
                    aria-label="Open chat"
                >
                    <div className={cn(
                        'relative flex h-[72px] w-[72px] items-center justify-center rounded-[24px] border transition-transform duration-300 group-hover:scale-105',
                        isWhiteMode
                            ? 'border-slate-200 bg-slate-950 text-white'
                            : 'border-white/10 bg-[#04131d] text-white'
                    )}>
                        <Sparkles className="absolute h-5 w-5 translate-x-2 -translate-y-2 opacity-80" />
                        <MessageCircle className="h-8 w-8" />
                    </div>
                </button>
            )}
        </div>,
        portalTarget
    );
};

export default ChatBot;
