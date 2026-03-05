import { useState, useRef, useEffect, useContext, useCallback } from 'react';
import { MessageCircle, X, Send, Star, ShoppingCart, ChevronRight, Sparkles, TrendingUp, Percent, Package, ArrowRight } from 'lucide-react';
import { chatApi } from '@/services/chatApi';
import { useNavigate } from 'react-router-dom';
import { CartContext } from '@/context/CartContext';
import { createPortal } from 'react-dom';

const ChatBot = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState([
        {
            role: 'bot',
            text: "Hey! I'm AuraBot. I can help with shopping, writing, planning, learning, and technical questions. What do you want to do?",
            products: [],
            suggestions: ['Best deals today', 'Write a formal email', 'Create a study plan', 'Explain React hooks'],
            actionType: 'greeting'
        }
    ]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [conversationHistory, setConversationHistory] = useState([]);
    const [hasNewMessage, setHasNewMessage] = useState(false);
    const messagesEndRef = useRef(null);
    const inputRef = useRef(null);
    const navigate = useNavigate();
    const { addToCart } = useContext(CartContext);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, isOpen]);

    useEffect(() => {
        if (isOpen && inputRef.current) {
            inputRef.current.focus();
        }
        if (isOpen) setHasNewMessage(false);
    }, [isOpen]);

    const handleSend = useCallback(async (text) => {
        const messageText = typeof text === 'string' ? text : input;
        if (!messageText.trim()) return;

        const userMsg = { role: 'user', text: messageText };
        setMessages(prev => [...prev, userMsg]);
        setInput('');
        setIsLoading(true);

        // Update conversation history for context
        const newHistory = [...conversationHistory, { role: 'user', content: messageText }];

        const response = await chatApi.sendMessage(messageText, newHistory.slice(-8));

        const botMsg = {
            role: 'bot',
            text: response.text,
            products: response.products || [],
            suggestions: response.suggestions || [],
            actionType: response.actionType || 'search',
            isAI: response.isAI
        };

        setMessages(prev => [...prev, botMsg]);
        setConversationHistory([...newHistory, { role: 'assistant', content: response.text }]);
        setIsLoading(false);

        if (!isOpen) setHasNewMessage(true);
    }, [input, conversationHistory, isOpen]);

    const handleSuggestionClick = (suggestion) => {
        // Remove emoji prefix for cleaner search
        const cleanText = suggestion.replace(/^[^\w]*/, '').trim();
        handleSend(cleanText || suggestion);
    };

    const handleAddToCart = (product, e) => {
        e.stopPropagation();
        addToCart({
            id: product.id,
            title: product.title,
            price: product.price,
            originalPrice: product.originalPrice,
            discountPercentage: product.discountPercentage,
            image: product.image,
            stock: product.stock || 10,
            brand: product.brand
        });
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        handleSend(input);
    };

    const getActionIcon = (type) => {
        switch (type) {
            case 'deals': return <Percent size={14} className="text-red-400" />;
            case 'trending': return <TrendingUp size={14} className="text-green-400" />;
            case 'compare': return <Package size={14} className="text-purple-400" />;
            default: return <Sparkles size={14} className="text-blue-400" />;
        }
    };

    const getActionLabel = (type) => {
        switch (type) {
            case 'deals': return 'DEALS';
            case 'trending': return 'TRENDING';
            case 'compare': return 'COMPARISON';
            case 'assistant': return 'ASSISTANT';
            case 'greeting': return 'WELCOME';
            default: return 'RESULTS';
        }
    };

    const portalTarget = typeof document !== 'undefined' ? document.body : null;
    if (!portalTarget) return null;

    return createPortal(
        <div
            className="flex flex-col items-end pointer-events-auto"
            style={{
                position: 'fixed',
                right: '16px',
                bottom: '16px',
                zIndex: 2147483600
            }}
            data-aura-chatbot-launcher="true"
        >
            {/* ═══ Chat Window ═══ */}
            {isOpen && (
                <div className="w-[calc(100vw-1.5rem)] sm:w-[400px] h-[min(72vh,600px)] sm:h-[600px] max-h-[calc(100dvh-7rem)] shadow-2xl rounded-2xl flex flex-col overflow-hidden mb-3 sm:mb-4"
                    style={{
                        background: 'linear-gradient(135deg, #0f0c29 0%, #1a1a2e 50%, #16213e 100%)',
                        border: '1px solid rgba(255,255,255,0.08)',
                        animation: 'slideUp 0.3s ease-out'
                    }}>

                    {/* ═══ Header ═══ */}
                    <div className="p-4 flex justify-between items-center"
                        style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}>
                        <div className="flex items-center gap-3">
                            <div className="relative">
                                <div className="bg-white/20 backdrop-blur p-2.5 rounded-xl">
                                    <Sparkles size={20} className="text-white" />
                                </div>
                                <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-400 rounded-full border-2 border-purple-600"></span>
                            </div>
                            <div>
                                <h3 className="font-bold text-white text-sm tracking-wide">AuraBot</h3>
                                <p className="text-[10px] text-purple-200 font-medium">AI Shopping Assistant • Online</p>
                            </div>
                        </div>
                        <button onClick={() => setIsOpen(false)}
                            className="hover:bg-white/20 p-1.5 rounded-lg transition-colors">
                            <X size={18} className="text-white" />
                        </button>
                    </div>

                    {/* ═══ Messages Area ═══ */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-4" style={{ scrollbarWidth: 'thin' }}>
                        {messages.map((msg, idx) => (
                            <div key={idx} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>

                                {/* Message Bubble */}
                                <div className={`max-w-[90%] p-3 text-sm leading-relaxed ${msg.role === 'user'
                                    ? 'rounded-2xl rounded-br-sm text-white'
                                    : 'rounded-2xl rounded-bl-sm text-gray-200'}`}
                                    style={msg.role === 'user'
                                        ? { background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }
                                        : { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }
                                    }>
                                    {msg.role === 'bot' && msg.actionType && msg.actionType !== 'greeting' && msg.actionType !== 'farewell' && msg.products?.length > 0 && (
                                        <div className="flex items-center gap-1.5 mb-2">
                                            {getActionIcon(msg.actionType)}
                                            <span className="text-[10px] font-bold tracking-wider opacity-60">{getActionLabel(msg.actionType)}</span>
                                        </div>
                                    )}
                                    {msg.text}
                                </div>

                                {/* Product Cards */}
                                {msg.products && msg.products.length > 0 && (
                                    <div className="mt-3 space-y-2 w-full">
                                        {msg.actionType === 'compare' && msg.products.length >= 2 ? (
                                            /* ═══ Comparison View ═══ */
                                            <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.1)' }}>
                                                <div className="text-center py-1.5 text-[10px] font-bold tracking-wider text-purple-300"
                                                    style={{ background: 'rgba(118,75,162,0.2)' }}>
                                                    ⚖️ SIDE-BY-SIDE COMPARISON
                                                </div>
                                                <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-white/10">
                                                    {msg.products.slice(0, 2).map((product, i) => (
                                                        <div key={product._id || product.id || i}
                                                            onClick={() => { setIsOpen(false); navigate(`/product/${product.id || product._id}`); }}
                                                            className="p-3 cursor-pointer hover:bg-white/5 transition-colors">
                                                            <img src={product.image} alt={product.title}
                                                                className="w-full h-20 object-contain mb-2 rounded" />
                                                            <p className="text-[11px] font-medium text-white truncate">{product.title}</p>
                                                            <p className="text-xs font-bold text-green-400 mt-1">₹{product.price?.toLocaleString()}</p>
                                                            {product.rating && (
                                                                <div className="flex items-center gap-1 mt-1">
                                                                    <Star size={10} className="text-yellow-400 fill-yellow-400" />
                                                                    <span className="text-[10px] text-gray-400">{product.rating}</span>
                                                                </div>
                                                            )}
                                                            {product.discountPercentage > 0 && (
                                                                <span className="inline-block mt-1 text-[9px] px-1.5 py-0.5 bg-red-500/20 text-red-400 rounded-full font-bold">
                                                                    {product.discountPercentage}% OFF
                                                                </span>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        ) : (
                                            /* ═══ Product List View ═══ */
                                            msg.products.slice(0, 6).map((product, i) => (
                                                <div key={product._id || product.id || i}
                                                    className="flex gap-3 p-2.5 rounded-xl cursor-pointer transition-all hover:scale-[1.01]"
                                                    style={{
                                                        background: 'rgba(255,255,255,0.04)',
                                                        border: '1px solid rgba(255,255,255,0.06)'
                                                    }}
                                                    onClick={() => { setIsOpen(false); navigate(`/product/${product.id || product._id}`); }}>
                                                    <img src={product.image} alt={product.title}
                                                        className="w-14 h-14 object-contain rounded-lg flex-shrink-0"
                                                        style={{ background: 'rgba(255,255,255,0.06)' }} />
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-[11px] font-medium text-gray-200 truncate">{product.title}</p>
                                                        <div className="flex items-center gap-2 mt-1">
                                                            <span className="text-sm font-bold text-green-400">₹{product.price?.toLocaleString()}</span>
                                                            {product.originalPrice > product.price && (
                                                                <span className="text-[10px] text-gray-500 line-through">₹{product.originalPrice?.toLocaleString()}</span>
                                                            )}
                                                            {product.discountPercentage > 0 && (
                                                                <span className="text-[10px] font-bold text-red-400">{product.discountPercentage}% off</span>
                                                            )}
                                                        </div>
                                                        <div className="flex items-center gap-2 mt-1">
                                                            {product.rating && (
                                                                <div className="flex items-center gap-0.5">
                                                                    <Star size={9} className="text-yellow-400 fill-yellow-400" />
                                                                    <span className="text-[10px] text-gray-400">{product.rating}</span>
                                                                </div>
                                                            )}
                                                            {product.brand && (
                                                                <span className="text-[10px] text-gray-500">{product.brand}</span>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <button
                                                        onClick={(e) => handleAddToCart(product, e)}
                                                        className="self-center p-2 rounded-lg transition-colors flex-shrink-0"
                                                        style={{ background: 'rgba(102,126,234,0.2)' }}
                                                        title="Add to Cart">
                                                        <ShoppingCart size={14} className="text-purple-300" />
                                                    </button>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                )}

                                {/* Quick Suggestions */}
                                {msg.role === 'bot' && msg.suggestions && msg.suggestions.length > 0 && idx === messages.length - 1 && (
                                    <div className="flex flex-wrap gap-1.5 mt-3">
                                        {msg.suggestions.map((s, i) => (
                                            <button key={i}
                                                onClick={() => handleSuggestionClick(s)}
                                                className="text-[11px] px-3 py-1.5 rounded-full font-medium transition-all hover:scale-105"
                                                style={{
                                                    background: 'rgba(102,126,234,0.15)',
                                                    border: '1px solid rgba(102,126,234,0.3)',
                                                    color: '#a5b4fc'
                                                }}>
                                                {s}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))}

                        {/* Typing Indicator */}
                        {isLoading && (
                            <div className="flex items-start">
                                <div className="p-3 rounded-2xl rounded-bl-sm flex items-center gap-1.5"
                                    style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}>
                                    <div className="flex gap-1">
                                        <span className="w-2 h-2 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: '0ms' }}></span>
                                        <span className="w-2 h-2 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: '150ms' }}></span>
                                        <span className="w-2 h-2 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: '300ms' }}></span>
                                    </div>
                                    <span className="text-xs text-gray-500 ml-1">AuraBot is thinking...</span>
                                </div>
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </div>

                    {/* ═══ Input Area ═══ */}
                    <form onSubmit={handleSubmit} className="p-3 flex gap-2"
                        style={{ background: 'rgba(255,255,255,0.03)', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                        <input
                            ref={inputRef}
                            type="text"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            placeholder="Ask anything: shopping, writing, planning, coding..."
                            className="flex-1 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/40"
                            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}
                            disabled={isLoading}
                        />
                        <button
                            type="submit"
                            disabled={!input.trim() || isLoading}
                            className="p-2.5 rounded-xl text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all hover:scale-105"
                            style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}>
                            <Send size={16} />
                        </button>
                    </form>
                </div>
            )}

            {/* ═══ Toggle Button ═══ */}
            {!isOpen && (
                <button
                    onClick={() => setIsOpen(true)}
                    className="relative p-3.5 sm:p-4 rounded-2xl shadow-lg hover:shadow-2xl transition-all transform hover:scale-110 group"
                    style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}>
                    <Sparkles size={26} className="text-white group-hover:animate-pulse" />
                    {hasNewMessage && (
                        <span className="absolute -top-1 -right-1 flex h-4 w-4">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-4 w-4 bg-red-500 text-[8px] text-white items-center justify-center font-bold">!</span>
                        </span>
                    )}
                    <div className="hidden sm:block absolute -top-10 right-0 bg-gray-900 text-white text-xs px-3 py-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap"
                        style={{ border: '1px solid rgba(255,255,255,0.1)' }}>
                        Chat with AuraBot ✨
                    </div>
                </button>
            )}

            {/* ═══ CSS Animation ═══ */}
            <style>{`
                @keyframes slideUp {
                    from { opacity: 0; transform: translateY(20px) scale(0.95); }
                    to { opacity: 1; transform: translateY(0) scale(1); }
                }
            `}</style>
        </div>,
        portalTarget
    );
};

export default ChatBot;

