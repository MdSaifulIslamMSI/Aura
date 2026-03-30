import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageCircle } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { useColorMode } from '@/context/ColorModeContext';
import { cn } from '@/lib/utils';
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
        subtitle: 'Order-specific help routes into the order surface. Everything else goes to the support desk.',
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

    const recognitionRef = useRef(null);
    const [isListening, setIsListening] = useState(false);
    const [supportsDictation, setSupportsDictation] = useState(false);

    const isWhiteMode = colorMode === 'white';
    const routeLabel = getAssistantRouteLabel(location.pathname);
    const modeCopy = MODE_COPY[mode] || MODE_COPY.explore;
    const launcherClassName = isWhiteMode
        ? 'border-slate-200/90 bg-white/95 text-slate-950 shadow-[0_18px_48px_rgba(15,23,42,0.14)]'
        : 'border-white/10 bg-[linear-gradient(135deg,rgba(6,10,24,0.96),rgba(10,18,34,0.96))] text-slate-50 shadow-[0_22px_60px_rgba(2,6,23,0.56)]';

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

    useEffect(() => {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            setSupportsDictation(false);
            return undefined;
        }

        setSupportsDictation(true);
        const recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = true;
        recognition.lang = 'en-IN';

        recognition.onresult = (event) => {
            const transcript = Array.from(event.results)
                .map((result) => result[0]?.transcript || '')
                .join('');
            setInputValue(transcript);
        };

        recognition.onerror = () => {
            setIsListening(false);
        };

        recognition.onend = () => {
            setIsListening(false);
        };

        recognitionRef.current = recognition;
        return () => {
            recognition.stop();
        };
    }, [recognitionRef, setInputValue]);

    const toggleDictation = useCallback(() => {
        if (!recognitionRef.current) return;

        if (isListening) {
            recognitionRef.current.stop();
            setIsListening(false);
            return;
        }

        setInputValue('');
        recognitionRef.current.start();
        setIsListening(true);
    }, [isListening, recognitionRef, setInputValue]);

    const portalTarget = typeof document !== 'undefined' ? document.body : null;
    if (!portalTarget) return null;

    return createPortal(
        <div className="pointer-events-none fixed inset-0 z-[2147483600] flex items-end justify-end p-4 sm:p-6">
            {isOpen ? (
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
                        recognitionRef.current?.stop();
                        setIsListening(false);
                        close();
                    }}
                    onInputChange={setInputValue}
                    onSubmit={(event) => {
                        event?.preventDefault?.();
                        if (isListening) {
                            recognitionRef.current?.stop();
                            setIsListening(false);
                        }
                        void handleUserInput(inputValue);
                    }}
                    onToggleDictation={toggleDictation}
                    onAction={handleAction}
                    onSelectProduct={(productId) => void selectProduct(productId)}
                    onAddToCart={(productId) => void addProductToCart(productId)}
                    onViewDetails={(productId) => void selectProduct(productId)}
                    onOpenSupport={(prefill, orderId) => void openSupport(prefill, orderId)}
                    onConfirmPending={(token) => void confirmPendingAction(token)}
                    onCancelPending={cancelPendingAction}
                    onModifyPending={modifyPendingAction}
                />
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
