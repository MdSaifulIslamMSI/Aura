import { useState, useEffect, useRef } from 'react';
import { MessageSquare, Send, AlertCircle, CheckCircle, Clock, Plus, X, ShieldAlert } from 'lucide-react';
import { supportApi } from '@/services/api';
import { cn } from '@/lib/utils';
import { io } from 'socket.io-client';

export default function SupportSection({ profile }) {
    const [tickets, setTickets] = useState([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [activeTicketId, setActiveTicketId] = useState(null);
    const [messages, setMessages] = useState([]);
    const [messagesLoading, setMessagesLoading] = useState(false);
    const [newMessage, setNewMessage] = useState('');
    const [sending, setSending] = useState(false);
    const [error, setError] = useState('');
    const messagesEndRef = useRef(null);
    const socketRef = useRef(null);

    // New Ticket Form
    const [form, setForm] = useState({ subject: '', category: 'general_support', message: '' });

    const fetchTickets = async () => {
        try {
            setLoading(true);
            const res = await supportApi.getTickets();
            setTickets(res.data);
        } catch (err) {
            setError(err.message || 'Failed to load tickets');
        } finally {
            setLoading(false);
        }
    };

    const fetchMessages = async (ticketId) => {
        try {
            setMessagesLoading(true);
            const res = await supportApi.getMessages(ticketId);
            setMessages(res.data);
            
            // Clear unread locally
            setTickets(prev => prev.map(t => t._id === ticketId ? { ...t, unreadByUser: 0 } : t));
        } catch (err) {
            setError(err.message || 'Failed to load messages');
        } finally {
            setMessagesLoading(false);
        }
    };

    useEffect(() => {
        fetchTickets();
        
        // Setup socket
        const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
        const token = localStorage.getItem('token');
        if (token) {
            socketRef.current = io(API_BASE_URL, {
                auth: { token },
                transports: ['websocket', 'polling']
            });
            
            socketRef.current.on('support:message:new', (data) => {
                const { ticketId, message } = data;
                
                // Update messages if we are viewing this ticket
                setMessages(prev => {
                    // Check if we already have it
                    if (prev.some(m => m._id === message._id)) return prev;
                    if (activeTicketId === ticketId) {
                        return [...prev, message];
                    }
                    return prev;
                });
                
                // Update ticket list preview
                setTickets(prev => prev.map(t => {
                    if (t._id === ticketId) {
                        return {
                            ...t,
                            lastMessagePreview: message.text,
                            lastMessageAt: message.sentAt,
                            unreadByUser: activeTicketId === ticketId ? 0 : (t.unreadByUser || 0) + 1
                        };
                    }
                    return t;
                }).sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt)));
                
                // Keep scrolled to bottom if active
                if (activeTicketId === ticketId) {
                    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
                }
            });
        }
        
        return () => {
            if (socketRef.current) socketRef.current.disconnect();
        };
    }, [activeTicketId]);

    useEffect(() => {
        if (activeTicketId) {
            fetchMessages(activeTicketId);
        }
    }, [activeTicketId]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const handleCreateTicket = async (e) => {
        e.preventDefault();
        try {
            const res = await supportApi.createTicket(form);
            setTickets([res.data, ...tickets]);
            setCreating(false);
            setForm({ subject: '', category: 'general_support', message: '' });
            setActiveTicketId(res.data._id);
        } catch (err) {
            setError(err.message || 'Failed to create ticket');
        }
    };

    const handleSendMessage = async (e) => {
        e.preventDefault();
        if (!newMessage.trim() || sending) return;
        
        const tempText = newMessage;
        setNewMessage('');
        try {
            setSending(true);
            const res = await supportApi.sendMessage(activeTicketId, tempText);
            setMessages(prev => [...prev.filter(m => m._id !== res.data._id), res.data]);
        } catch (err) {
            setError(err.message || 'Failed to send message');
            setNewMessage(tempText);
        } finally {
            setSending(false);
            setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
        }
    };

    const activeTicket = tickets.find(t => t._id === activeTicketId);

    if (loading) return <div className="text-white">Loading support...</div>;

    const getStatusBadge = (status) => {
        switch (status) {
            case 'open': return <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded border border-amber-500/30 bg-amber-500/10 text-amber-400"><Clock className="w-3 h-3"/> Open</span>
            case 'resolved': return <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-400"><CheckCircle className="w-3 h-3"/> Resolved</span>
            case 'closed': return <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded border border-zinc-500/30 bg-zinc-500/10 text-zinc-400"><X className="w-3 h-3"/> Closed</span>
            default: return null;
        }
    };

    return (
        <div className="flex flex-col md:flex-row gap-6 h-[700px]">
            {/* Left: Ticket List */}
            <div className={cn("w-full md:w-1/3 flex flex-col border border-white/10 rounded-2xl bg-black/40 overflow-hidden", activeTicketId && "hidden md:flex")}>
                <div className="p-4 border-b border-white/10 flex items-center justify-between">
                    <h3 className="text-xl font-bold text-white flex items-center gap-2">
                        <MessageSquare className="w-5 h-5" /> Support
                    </h3>
                    <button onClick={() => { setActiveTicketId(null); setCreating(true); }} className="p-2 hover:bg-white/10 rounded-lg text-white transition-colors">
                        <Plus className="w-5 h-5" />
                    </button>
                </div>
                
                {error && <div className="p-3 m-3 bg-red-500/20 border border-red-500/50 text-red-100 rounded text-sm">{error}</div>}

                <div className="flex-1 overflow-y-auto p-3 space-y-2 relative scrollbar-hide">
                    {tickets.length === 0 ? (
                        <div className="text-center p-6 text-zinc-500 text-sm">No support tickets found</div>
                    ) : (
                        tickets.map(ticket => (
                            <button
                                key={ticket._id}
                                onClick={() => { setActiveTicketId(ticket._id); setCreating(false); }}
                                className={cn("w-full text-left p-4 rounded-xl border transition-all hover:bg-white/5",
                                    activeTicketId === ticket._id ? "bg-white/5 border-white/20" : "border-transparent bg-transparent")}
                            >
                                <div className="flex justify-between items-start mb-1">
                                    <div className="font-semibold text-white truncate pr-2">{ticket.subject}</div>
                                    {getStatusBadge(ticket.status)}
                                </div>
                                <div className="text-xs text-zinc-400 truncate mt-1">
                                    {ticket.lastMessagePreview || 'No messages'}
                                </div>
                                <div className="flex justify-between items-center mt-3">
                                    <div className="text-[10px] text-zinc-500 font-mono">ID: {ticket._id.slice(-6)}</div>
                                    {ticket.unreadByUser > 0 && (
                                        <div className="bg-rose-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                                            {ticket.unreadByUser} NEW
                                        </div>
                                    )}
                                </div>
                            </button>
                        ))
                    )}
                </div>
            </div>

            {/* Right: Ticket Content or New Form */}
            <div className={cn("flex-1 flex flex-col border border-white/10 rounded-2xl bg-[#090909]", !activeTicketId && !creating && "hidden md:flex items-center justify-center")}>
                {!activeTicketId && !creating && (
                    <div className="text-center text-zinc-500">
                        <MessageSquare className="w-12 h-12 mx-auto mb-4 opacity-50" />
                        <p>Select a ticket or create a new one</p>
                    </div>
                )}

                {creating && (
                    <div className="p-6 h-full flex flex-col">
                        <div className="flex items-center justify-between mb-6">
                            <h2 className="text-2xl font-bold text-white">New Support Ticket</h2>
                            <button onClick={() => setCreating(false)} className="md:hidden text-zinc-400"><X /></button>
                        </div>
                        
                        {(profile?.accountState === 'warned' || profile?.accountState === 'suspended') && (
                            <div className="mb-6 p-4 rounded-xl bg-orange-500/10 border border-orange-500/30 text-orange-200 text-sm flex gap-3 items-start">
                                <ShieldAlert className="w-5 h-5 text-orange-400 shrink-0 mt-0.5" />
                                <div>
                                    <strong className="block mb-1 text-orange-300">Account Moderation Status</strong>
                                    You can use this form to appeal your current {profile.accountState} status directly with our Trust & Safety team.
                                </div>
                            </div>
                        )}

                        <form onSubmit={handleCreateTicket} className="space-y-4 flex-1">
                            <div>
                                <label className="block text-sm text-zinc-400 mb-1">Category</label>
                                <select 
                                    value={form.category} 
                                    onChange={e=>setForm({...form, category: e.target.value})}
                                    className="w-full bg-black/50 border border-white/10 rounded-lg p-3 text-white focus:outline-none focus:border-white/30"
                                >
                                    <option value="general_support">General Support</option>
                                    <option value="moderation_appeal">Moderation Appeal</option>
                                    <option value="order_issue">Order Issue</option>
                                    <option value="other">Other</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm text-zinc-400 mb-1">Subject</label>
                                <input 
                                    type="text" required maxLength={200}
                                    value={form.subject} onChange={e=>setForm({...form, subject: e.target.value})}
                                    className="w-full bg-black/50 border border-white/10 rounded-lg p-3 text-white focus:outline-none focus:border-white/30"
                                    placeholder="Brief summary of your issue"
                                />
                            </div>
                            <div className="flex-1 flex flex-col h-1/2">
                                <label className="block text-sm text-zinc-400 mb-1">Initial Message</label>
                                <textarea 
                                    required maxLength={2000}
                                    value={form.message} onChange={e=>setForm({...form, message: e.target.value})}
                                    className="w-full h-full flex-1 bg-black/50 border border-white/10 rounded-lg p-3 text-white focus:outline-none focus:border-white/30 resize-none"
                                    placeholder="Explain your issue in detail..."
                                />
                            </div>
                            <button type="submit" className="w-full bg-white text-black font-bold py-3 rounded-xl hover:bg-zinc-200 transition-colors">
                                Submit Ticket
                            </button>
                        </form>
                    </div>
                )}

                {activeTicketId && activeTicket && (
                    <div className="flex flex-col h-full bg-[#050505] rounded-2xl overflow-hidden">
                        {/* Header */}
                        <div className="p-4 border-b border-white/10 flex items-center gap-4 bg-black/40">
                            <button onClick={() => setActiveTicketId(null)} className="md:hidden text-zinc-400"><X /></button>
                            <div className="flex-1">
                                <div className="text-lg font-bold text-white flex items-center gap-2">
                                    {activeTicket.subject}
                                </div>
                                <div className="text-xs text-zinc-500 font-mono flex items-center gap-3 mt-1">
                                    <span>ID: {activeTicket._id}</span>
                                    {getStatusBadge(activeTicket.status)}
                                </div>
                            </div>
                        </div>

                        {/* Chat Body */}
                        <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-hide">
                            {messagesLoading ? (
                                <div className="text-center text-zinc-500 mt-10">Loading chat history...</div>
                            ) : (
                                messages.map((m, i) => {
                                    const isMe = !m.isAdmin && !m.isSystem;
                                    
                                    if (m.isSystem) {
                                        return (
                                            <div key={m._id || i} className="flex justify-center my-4">
                                                <div className="bg-white/5 border border-white/10 px-4 py-1.5 rounded-full text-xs text-zinc-400 flex items-center gap-2">
                                                    <AlertCircle className="w-3 h-3" /> {m.text}
                                                </div>
                                            </div>
                                        );
                                    }

                                    return (
                                        <div key={m._id || i} className={cn("flex", isMe ? "justify-end" : "justify-start")}>
                                            <div className={cn(
                                                "max-w-[85%] rounded-2xl p-4",
                                                isMe ? "bg-white text-black rounded-tr-sm" : "bg-zinc-900 border border-white/10 text-white rounded-tl-sm"
                                            )}>
                                                {!isMe && (
                                                    <div className="flex items-center gap-2 mb-1.5 mb-2">
                                                        <ShieldAlert className="w-3.5 h-3.5 text-rose-500" />
                                                        <span className="text-xs font-bold text-rose-400 tracking-wider uppercase">Aura Admin</span>
                                                    </div>
                                                )}
                                                <div className="whitespace-pre-wrap text-[15px] leading-relaxed">{m.text}</div>
                                                <div className={cn("text-[10px] mt-2 text-right opacity-60", isMe ? "text-zinc-600" : "text-zinc-500")}>
                                                    {new Date(m.sentAt).toLocaleTimeString([], { hour: '2-digit', minute:'2-digit' })}
                                                </div>
                                            </div>
                                        </div>
                                    )
                                })
                            )}
                            <div ref={messagesEndRef} />
                        </div>

                        {/* Input Area */}
                        {activeTicket.status !== 'closed' ? (
                            <form onSubmit={handleSendMessage} className="p-4 border-t border-white/10 bg-black/40">
                                <div className="flex gap-2 relative">
                                    <input 
                                        type="text" 
                                        value={newMessage}
                                        onChange={e => setNewMessage(e.target.value)}
                                        placeholder="Type your reply..."
                                        className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-white/30 pr-12"
                                    />
                                    <button 
                                        type="submit" 
                                        disabled={!newMessage.trim() || sending}
                                        className="absolute right-2 top-2 bottom-2 aspect-square bg-white text-black rounded-lg flex items-center justify-center disabled:opacity-50 transition-opacity"
                                    >
                                        <Send className="w-4 h-4 ml-0.5" />
                                    </button>
                                </div>
                            </form>
                        ) : (
                            <div className="p-4 bg-red-500/10 border-t border-red-500/20 text-center text-red-400 text-sm">
                                This ticket is closed. You can no longer reply.
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
