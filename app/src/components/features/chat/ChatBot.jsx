import React, { useState, useRef, useEffect, useContext, useCallback } from 'react';
import { 
    MessageCircle, X, Send, Star, ShoppingCart, ChevronRight, Sparkles, 
    TrendingUp, Percent, Package, ArrowRight, Mic, MicOff, Maximize2, 
    Minimize2, Trash2, GripHorizontal 
} from 'lucide-react';
import { chatApi } from '@/services/chatApi';
import { useNavigate } from 'react-router-dom';
import { CartContext } from '@/context/CartContext';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';

const ChatBot = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);
    const [messages, setMessages] = useState([
        {
            role: 'bot',
            text: "Hey! I'm AuraBot ✨. I can help with shopping, writing, planning, learning, and technical questions. What do you want to explore today?",
            products: [],
            suggestions: ['Best deals today', 'Smartphones under ₹20000', 'Write a formal email'],
            actionType: 'greeting'
        }
    ]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [conversationHistory, setConversationHistory] = useState([]);
    const [hasNewMessage, setHasNewMessage] = useState(false);
    const [isListening, setIsListening] = useState(false);
    
    const messagesEndRef = useRef(null);
    const inputRef = useRef(null);
    const navigate = useNavigate();
    const { addToCart } = useContext(CartContext);
    const recognitionRef = useRef(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, isOpen, isExpanded]);

    useEffect(() => {
        if (isOpen && inputRef.current) {
            inputRef.current.focus();
        }
        if (isOpen) setHasNewMessage(false);
    }, [isOpen]);

    // Initialize Speech Recognition
    useEffect(() => {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SpeechRecognition) {
            recognitionRef.current = new SpeechRecognition();
            recognitionRef.current.continuous = false;
            recognitionRef.current.interimResults = true;
            recognitionRef.current.lang = 'en-US';

            recognitionRef.current.onresult = (event) => {
                const transcript = Array.from(event.results)
                    .map(result => result[0])
                    .map(result => result.transcript)
                    .join('');
                setInput(transcript);
            };

            recognitionRef.current.onerror = (event) => {
                console.error('Speech recognition error', event.error);
                setIsListening(false);
            };

            recognitionRef.current.onend = () => {
                setIsListening(false);
                // Optionally auto-send when speech ends if input context makes sense
            };
        }
    }, []);

    const toggleListening = () => {
        if (isListening) {
            recognitionRef.current?.stop();
            setIsListening(false);
        } else {
            setInput(''); // Clear input when starting new recording
            recognitionRef.current?.start();
            setIsListening(true);
        }
    };

    const handleClearChat = () => {
        setMessages([{
            role: 'bot',
            text: "Chat cleared! Let's start a fresh conversation. How can I assist you?",
            actionType: 'greeting'
        }]);
        setConversationHistory([]);
    };

    const handleSend = useCallback(async (text) => {
        const messageText = typeof text === 'string' ? text : input;
        if (!messageText.trim()) return;

        // Stop listening if user hits send manually
        if (isListening) {
            recognitionRef.current?.stop();
            setIsListening(false);
        }

        const userMsg = { role: 'user', text: messageText };
        setMessages(prev => [...prev, userMsg]);
        setInput('');
        setIsLoading(true);

        const newHistory = [...conversationHistory, { role: 'user', content: messageText }];

        try {
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
        } catch (error) {
            setMessages(prev => [...prev, { role: 'bot', text: 'Sorry, I ran into a bit of trouble connecting to my neural core. Please try again! 🚨' }]);
        } finally {
            setIsLoading(false);
        }

        if (!isOpen) setHasNewMessage(true);
    }, [input, conversationHistory, isOpen, isListening]);

    const handleSuggestionClick = (suggestion) => {
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
            className="pointer-events-none fixed inset-0 z-[2147483600] flex justify-end items-end p-4 sm:p-6"
            style={{ fontFamily: "'Inter', sans-serif" }}
        >
            {isOpen && (
                <div
                    className={`pointer-events-auto flex flex-col overflow-hidden rounded-[1.5rem] shadow-[0_20px_50px_rgba(0,0,0,0.5)] mb-4 transition-all duration-300 ease-in-out ${isExpanded ? 'fixed inset-6 w-[calc(100vw-3rem)] h-[calc(100vh-3rem)]' : 'relative w-[min(90vw,420px)] h-[min(75vh,650px)]'}`}
                    style={{
                        background: 'linear-gradient(135deg, rgba(15, 12, 41, 0.95) 0%, rgba(26, 26, 46, 0.95) 50%, rgba(22, 33, 62, 0.95) 100%)',
                        border: '1px solid rgba(255,255,255,0.15)',
                        boxShadow: '0 0 40px rgba(102, 126, 234, 0.2), inset 0 0 20px rgba(255,255,255,0.05)'
                    }}
                >
                        {/* ═══ Header ═══ */}
                        <div 
                            className="p-4 flex justify-between items-center cursor-move border-b border-white/10"
                            style={{ background: 'linear-gradient(90deg, rgba(102, 126, 234, 0.2) 0%, rgba(118, 75, 162, 0.2) 100%)' }}
                        >
                            <div className="flex items-center gap-3">
                                <div className="relative group">
                                    <div className="bg-white/10 p-2.5 rounded-xl border border-white/20 group-hover:scale-105 transition-transform duration-300">
                                        <Sparkles size={20} className="text-purple-300" />
                                    </div>
                                    <span className="absolute -bottom-1 -right-1 w-3.5 h-3.5 bg-green-400 rounded-full border-2 border-[#16213e] shadow-[0_0_10px_rgba(74,222,128,0.5)] animate-pulse"></span>
                                </div>
                                <div>
                                    <h3 className="font-bold text-white text-base tracking-wide flex items-center gap-2">
                                        AuraBot <span className="text-[10px] font-bold px-2 py-0.5 bg-gradient-to-r from-purple-500 to-indigo-500 rounded-full">BETA</span>
                                    </h3>
                                    <p className="text-[11px] text-purple-200/80 font-medium">Your Premium AI Shopping Assistant</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <button onClick={handleClearChat} title="Clear Chat" className="p-2 hover:bg-white/10 rounded-xl transition-colors text-white/70 hover:text-red-400">
                                    <Trash2 size={16} />
                                </button>
                                <button onClick={() => setIsExpanded(!isExpanded)} title={isExpanded ? "Minimize" : "Expand"} className="p-2 hover:bg-white/10 rounded-xl transition-colors text-white/70 hover:text-white hidden sm:block">
                                    {isExpanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                                </button>
                                <button onClick={() => setIsOpen(false)} title="Close" className="p-2 hover:bg-white/10 rounded-xl transition-colors text-white/70 hover:text-white">
                                    <X size={18} />
                                </button>
                            </div>
                        </div>

                    {/* ═══ Messages Area ═══ */}
                    <div className="flex-1 overflow-y-auto p-5 space-y-5 custom-scrollbar" style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.2) transparent' }}>
                        {messages.map((msg, idx) => (
                            <div 
                                key={idx} 
                                className={`flex flex-col animate-fade-in-up ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
                            >
                                        <div className={`max-w-[85%] p-3.5 text-sm leading-relaxed shadow-lg ${
                                            msg.role === 'user'
                                            ? 'rounded-2xl rounded-tr-sm text-white'
                                            : 'rounded-2xl rounded-tl-sm text-gray-100'}`}
                                            style={msg.role === 'user'
                                                ? { 
                                                    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                                                    boxShadow: '0 4px 15px rgba(102, 126, 234, 0.4)'
                                                  }
                                                : { 
                                                    background: 'rgba(255, 255, 255, 0.05)', 
                                                    border: '1px solid rgba(255, 255, 255, 0.1)' 
                                                  }
                                            }>
                                            {msg.role === 'bot' && msg.actionType && !['greeting', 'farewell'].includes(msg.actionType) && (
                                                <div className="flex items-center gap-2 mb-2 pb-2 border-b border-white/10">
                                                    {getActionIcon(msg.actionType)}
                                                    <span className="text-[10px] font-bold tracking-widest text-purple-300 uppercase">{getActionLabel(msg.actionType)}</span>
                                                </div>
                                            )}
                                            
                                            {/* Render Markdown for Bot, standard text for User */}
                                            {msg.role === 'bot' ? (
                                                <div className="prose prose-invert prose-sm max-w-none text-gray-200 
                                                        prose-a:text-blue-400 prose-a:no-underline hover:prose-a:underline
                                                        prose-p:leading-relaxed prose-p:mb-2 prose-ul:my-2 prose-li:my-0.5">
                                                    <ReactMarkdown>{msg.text}</ReactMarkdown>
                                                </div>
                                            ) : (
                                                <div>{msg.text}</div>
                                            )}
                                        </div>

                                    {/* Product Cards Area */}
                                    {msg.products && msg.products.length > 0 && (
                                        <div className="mt-4 space-y-3 w-full animate-fade-in-up">
                                                {msg.actionType === 'compare' && msg.products.length >= 2 ? (
                                                    <div className="rounded-[1rem] overflow-hidden bg-white/5 border border-white/10 shadow-2xl">
                                                        <div className="text-center py-2 text-[10px] font-bold tracking-widest text-purple-300 bg-purple-500/10 border-b border-white/5">
                                                            ⚖️ SIDE-BY-SIDE COMPARISON
                                                        </div>
                                                        <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-white/10">
                                                            {msg.products.slice(0, 2).map((product, i) => (
                                                                <div key={product._id || product.id || i}
                                                                    onClick={() => { setIsOpen(false); navigate(`/product/${product.id || product._id}`); }}
                                                                    className="p-4 cursor-pointer hover:bg-white/10 transition-all duration-300 group">
                                                                    <div className="relative rounded-xl overflow-hidden bg-white/5 p-2 mb-3">
                                                                        <img src={product.image} alt={product.title} className="w-full h-24 object-contain group-hover:scale-110 transition-transform duration-500" />
                                                                    </div>
                                                                    <p className="text-xs font-semibold text-white truncate group-hover:text-purple-300 transition-colors">{product.title}</p>
                                                                    <p className="text-sm font-bold text-green-400 mt-1.5 flex items-baseline gap-2">
                                                                        ₹{product.price?.toLocaleString()}
                                                                        {product.originalPrice > product.price && <span className="text-[10px] text-gray-500 line-through">₹{product.originalPrice?.toLocaleString()}</span>}
                                                                    </p>
                                                                    <div className="flex items-center justify-between mt-2">
                                                                        {product.rating && (
                                                                            <div className="flex items-center gap-1 bg-yellow-400/10 px-1.5 py-0.5 rounded-md">
                                                                                <Star size={10} className="text-yellow-400 fill-yellow-400" />
                                                                                <span className="text-[10px] font-bold text-yellow-500">{product.rating}</span>
                                                                            </div>
                                                                        )}
                                                                        <button onClick={(e) => handleAddToCart(product, e)} className="p-1.5 rounded-lg bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/40 hover:scale-110 transition-all">
                                                                            <ShoppingCart size={14} />
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                            ) : (
                                                msg.products.slice(0, isExpanded ? 8 : 4).map((product, i) => (
                                                    <div 
                                                        key={product._id || product.id || i}
                                                        className="flex gap-4 p-3 rounded-2xl cursor-pointer transition-all border border-white/5 bg-white/5 shadow-lg group relative overflow-hidden hover:bg-white/10 hover:scale-[1.02]"
                                                        onClick={() => { setIsOpen(false); navigate(`/product/${product.id || product._id}`); }}>
                                                            
                                                            {/* Shimmer Effect */}
                                                            <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/5 to-transparent group-hover:animate-[shimmer_1.5s_infinite]"></div>

                                                            <div className="relative w-16 h-16 rounded-xl flex-shrink-0 bg-white/5 border border-white/10 p-1 flex items-center justify-center">
                                                                <img src={product.image} alt={product.title} className="w-full h-full object-contain group-hover:scale-110 transition-transform duration-300" />
                                                                {product.discountPercentage > 0 && (
                                                                    <span className="absolute -top-2 -right-2 bg-red-500 text-white text-[8px] font-bold px-1.5 py-0.5 rounded-full shadow-[0_0_10px_rgba(239,68,68,0.5)]">
                                                                        {product.discountPercentage}%
                                                                    </span>
                                                                )}
                                                            </div>

                                                            <div className="flex-1 min-w-0 py-0.5 flex flex-col justify-between">
                                                                <p className="text-xs font-semibold text-gray-100 truncate group-hover:text-purple-300 transition-colors z-10">{product.title}</p>
                                                                
                                                                <div className="flex items-center gap-2 mt-0.5 z-10">
                                                                    <span className="text-sm font-bold text-transparent bg-clip-text bg-gradient-to-r from-green-400 to-emerald-300">₹{product.price?.toLocaleString()}</span>
                                                                    {product.originalPrice > product.price && (
                                                                        <span className="text-[10px] text-gray-500 line-through">₹{product.originalPrice?.toLocaleString()}</span>
                                                                    )}
                                                                </div>
                                                                
                                                                <div className="flex items-center justify-between mt-1 z-10">
                                                                    {product.brand && <span className="text-[10px] font-medium text-gray-400 bg-white/5 px-2 py-0.5 rounded-md">{product.brand}</span>}
                                                                </div>
                                                            </div>

                                                            <button
                                                                onClick={(e) => handleAddToCart(product, e)}
                                                                className="self-center p-2.5 rounded-xl transition-all flex-shrink-0 border border-indigo-500/30 bg-indigo-500/10 hover:bg-indigo-500 hover:text-white text-indigo-300 shadow-[0_0_15px_rgba(99,102,241,0.1)] group-hover:shadow-[0_0_15px_rgba(99,102,241,0.4)] z-10"
                                                                title="Add to Cart">
                                                                <ShoppingCart size={16} />
                                                            </button>
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    )}

                                    {/* Quick Suggestions Bubbles */}
                                    {msg.role === 'bot' && msg.suggestions && msg.suggestions.length > 0 && idx === messages.length - 1 && (
                                        <div className="flex flex-wrap gap-2 mt-4 animate-fade-in-up">
                                                {msg.suggestions.map((s, i) => (
                                                    <button key={i}
                                                        onClick={() => handleSuggestionClick(s)}
                                                        className="text-xs px-4 py-2 rounded-full font-medium transition-all duration-300 text-indigo-200 bg-indigo-500/10 border border-indigo-500/20 hover:bg-indigo-500/20 hover:border-indigo-400/50 hover:-translate-y-0.5 shadow-lg shadow-indigo-500/5">
                                                        {s}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))}

                        {/* Refined Typing Indicator */}
                        {isLoading && (
                            <div className="flex items-start animate-fade-in-up">
                                <div className="px-4 py-3 rounded-2xl rounded-tl-sm flex items-center gap-2 bg-white/5 border border-white/10 shadow-lg">
                                    <div className="flex gap-1.5">
                                        <span className="w-2 h-2 rounded-full bg-gradient-to-t from-purple-500 to-indigo-400 animate-bounce"></span>
                                        <span className="w-2 h-2 rounded-full bg-gradient-to-t from-purple-500 to-indigo-400 animate-bounce" style={{ animationDelay: '0.1s' }}></span>
                                        <span className="w-2 h-2 rounded-full bg-gradient-to-t from-purple-500 to-indigo-400 animate-bounce" style={{ animationDelay: '0.2s' }}></span>
                                    </div>
                                </div>
                            </div>
                        )}
                            <div ref={messagesEndRef} className="h-2" />
                        </div>

                        {/* ═══ Chat Input Area ═══ */}
                        <div className="p-4 bg-gradient-to-b from-transparent to-black/40 border-t border-white/10">
                            <form onSubmit={handleSubmit} className="relative flex items-end gap-2">
                                <div className="relative flex-1 group">
                                    <div className="absolute inset-0 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-2xl blur-lg opacity-20 group-hover:opacity-40 transition-opacity duration-500"></div>
                                    <textarea
                                        ref={inputRef}
                                        value={input}
                                        onChange={(e) => setInput(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' && !e.shiftKey) {
                                                e.preventDefault();
                                                handleSubmit(e);
                                            }
                                        }}
                                        placeholder={isListening ? "Listening..." : "Ask AuraBot anything..."}
                                        className="w-full relative bg-[#111827]/80 border border-white/20 rounded-2xl pl-4 pr-12 py-3 text-sm text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-transparent transition-all shadow-[inset_0_2px_4px_rgba(0,0,0,0.6)] resize-none"
                                        rows={input.split('\n').length > 1 ? Math.min(input.split('\n').length, 4) : 1}
                                        style={{ minHeight: '46px', scrollbarWidth: 'none' }}
                                        disabled={isLoading}
                                    />
                                    {/* Microphone Button inside input box */}
                                    <button 
                                        type="button"
                                        onClick={toggleListening}
                                        className={`absolute right-2 bottom-1.5 p-2 rounded-xl transition-all duration-300 ${
                                            isListening 
                                            ? 'text-red-400 bg-red-400/10 animate-pulse border border-red-400/30' 
                                            : 'text-gray-400 hover:text-purple-300 hover:bg-white/5'
                                        }`}
                                    >
                                        {isListening ? <Mic size={18} /> : <MicOff size={18} />}
                                    </button>
                                </div>
                                <button
                                    type="submit"
                                    disabled={!input.trim() || isLoading}
                                    className="relative flex-shrink-0 h-[46px] w-[46px] flex items-center justify-center rounded-2xl text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-300 hover:scale-105 active:scale-95 shadow-lg group overflow-hidden"
                                >
                                    <div className="absolute inset-0 bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 group-hover:scale-110 transition-transform duration-500"></div>
                                    <Send size={18} className="relative z-10 translate-x-[-1px] translate-y-[1px]" />
                                </button>
                            </form>
                            <p className="text-[10px] text-center text-gray-500 mt-3 font-medium">AuraBot can make mistakes. Consider verifying critical information.</p>
                        </div>
                    </div>
                )}

            {/* ═══ Floating Launcher Button ═══ */}
            {!isOpen && (
                <button
                    onClick={() => setIsOpen(true)}
                    className="pointer-events-auto relative flex items-center justify-center w-14 h-14 sm:w-16 sm:h-16 rounded-full shadow-[0_10px_40px_rgba(102,126,234,0.5)] group overflow-hidden z-[2147483600] transition-all duration-300 hover:scale-105 active:scale-95 animate-fade-in-up"
                >
                        <div className="absolute inset-0 bg-gradient-to-br from-indigo-500 via-purple-600 to-pink-600"></div>
                        <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-20 mix-blend-overlay"></div>
                        <Sparkles size={28} className="text-white relative z-10 group-hover:animate-pulse filter drop-shadow-md" />
                        
                        {hasNewMessage && (
                            <span className="absolute -top-1 -right-1 flex h-4 w-4 z-20">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-4 w-4 bg-red-500 border-2 border-[#1a1a2e] text-[8px] text-white items-center justify-center font-bold">1</span>
                            </span>
                        )}

                    {/* Interactive Tooltip Ring */}
                    <div className="absolute inset-0 rounded-full border border-white/20 scale-150 group-hover:scale-100 opacity-0 group-hover:opacity-100 transition-all duration-500 ease-out"></div>
                </button>
            )}

            {/* ═══ Global Keyframes ═══ */}
            <style>{`
                @keyframes shimmer {
                    100% { transform: translateX(100%); }
                }
            `}</style>
        </div>,
        portalTarget
    );
};

export default ChatBot;
