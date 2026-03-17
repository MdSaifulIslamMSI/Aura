import { useState, useEffect, useRef } from 'react';
import { MessageSquare, Send, AlertCircle, CheckCircle, Clock, ShieldAlert, X } from 'lucide-react';
import { supportApi } from '@/services/api';
import { cn } from '@/lib/utils';
import { io } from 'socket.io-client';
import AdminPremiumShell from '@/components/shared/AdminPremiumShell';
import PremiumSelect from '@/components/ui/premium-select';

export default function AdminSupport() {
    const [tickets, setTickets] = useState([]);
    const [loading, setLoading] = useState(true);
    const [activeTicketId, setActiveTicketId] = useState(null);
    const [messages, setMessages] = useState([]);
    const [messagesLoading, setMessagesLoading] = useState(false);
    const [newMessage, setNewMessage] = useState('');
    const [sending, setSending] = useState(false);
    const [error, setError] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    
    const messagesEndRef = useRef(null);
    const socketRef = useRef(null);

    const fetchTickets = async () => {
        try {
            setLoading(true);
            const params = {};
            if (statusFilter) params.status = statusFilter;
            const res = await supportApi.adminGetTickets(params);
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
            setTickets(prev => prev.map(t => t._id === ticketId ? { ...t, unreadByAdmin: 0 } : t));
        } catch (err) {
            setError(err.message || 'Failed to load messages');
        } finally {
            setMessagesLoading(false);
        }
    };

    useEffect(() => {
        fetchTickets();
        
        // We could also listen to socket here if admins had a generic channel,
        // but for now admins typically don't have a single socket channel for all users' incoming messages
        // unless they subscribe. For simplicity, we just use polling or refresh for ticket list,
        // but if they are inside a ticket, they can fetch messages manually or we could add a socket namespace.
    }, [statusFilter]);

    useEffect(() => {
        if (activeTicketId) {
            fetchMessages(activeTicketId);
        }
    }, [activeTicketId]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
    }, [messages]);

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

    const handleUpdateStatus = async (newStatus) => {
        try {
            await supportApi.adminUpdateStatus(activeTicketId, newStatus);
            setTickets(prev => prev.map(t => t._id === activeTicketId ? { ...t, status: newStatus } : t));
            fetchMessages(activeTicketId); // fetch to show system log
        } catch (err) {
            setError(err.message || 'Failed to update status');
        }
    };

    const activeTicket = tickets.find(t => t._id === activeTicketId);

    const getStatusBadge = (status) => {
        switch (status) {
            case 'open': return <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded border border-amber-500/30 bg-amber-500/10 text-amber-500 font-bold"><Clock className="w-3 h-3"/> Open</span>
            case 'resolved': return <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-500 font-bold"><CheckCircle className="w-3 h-3"/> Resolved</span>
            case 'closed': return <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded border border-zinc-500/30 bg-zinc-500/10 text-zinc-500 font-bold"><X className="w-3 h-3"/> Closed</span>
            default: return null;
        }
    };

    return (
        <AdminPremiumShell
            eyebrow="Customer Service"
            title="Support & Appeals"
            description="Manage user moderation appeals, support tickets, and direct communication in real-time."
            actions={(
                <div className="flex gap-3">
                    <PremiumSelect value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-[150px]">
                        <option value="">All Tickets</option>
                        <option value="open">Open</option>
                        <option value="resolved">Resolved</option>
                        <option value="closed">Closed</option>
                    </PremiumSelect>
                    <button onClick={fetchTickets} className="admin-premium-button">
                        Refresh
                    </button>
                </div>
            )}
        >
            <div className="flex flex-col xl:flex-row gap-6 h-[700px]">
                {/* Left: Ticket List */}
                <div className="w-full xl:w-1/3 flex flex-col admin-premium-panel p-0 overflow-hidden">
                    {error && <div className="p-3 m-3 bg-red-50 text-red-600 rounded text-sm font-medium">{error}</div>}

                    <div className="flex-1 overflow-y-auto p-2 space-y-1 relative scrollbar-hide">
                        {loading ? (
                            <div className="text-center p-6 text-slate-500 text-sm">Loading tickets...</div>
                        ) : tickets.length === 0 ? (
                            <div className="text-center p-6 text-slate-500 text-sm">No support tickets found</div>
                        ) : (
                            tickets.map(ticket => (
                                <button
                                    key={ticket._id}
                                    onClick={() => setActiveTicketId(ticket._id)}
                                    className={cn("w-full text-left p-4 rounded-xl transition-all border",
                                        activeTicketId === ticket._id ? "bg-indigo-50 border-indigo-200" : "bg-white border-transparent hover:bg-slate-50")}
                                >
                                    <div className="flex justify-between items-start mb-1">
                                        <div className="font-bold text-slate-900 truncate pr-2" title={ticket.subject}>{ticket.subject}</div>
                                        {getStatusBadge(ticket.status)}
                                    </div>
                                    <div className="text-xs text-slate-500 flex items-center gap-2 mb-2 font-mono">
                                        <span className="bg-slate-100 px-1.5 py-0.5 rounded">{ticket.category}</span>
                                        <span className="truncate">{ticket.user?.email}</span>
                                    </div>
                                    <div className="text-sm text-slate-600 truncate">
                                        {ticket.lastMessagePreview || 'No messages'}
                                    </div>
                                    <div className="flex justify-between items-center mt-3">
                                        <div className="text-[10px] text-slate-400 font-mono">ID: {ticket._id.slice(-6)}</div>
                                        {ticket.unreadByAdmin > 0 && (
                                            <div className="bg-rose-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm">
                                                {ticket.unreadByAdmin} NEW
                                            </div>
                                        )}
                                    </div>
                                </button>
                            ))
                        )}
                    </div>
                </div>

                {/* Right: Ticket Content */}
                <div className="flex-1 flex flex-col admin-premium-panel p-0 overflow-hidden relative">
                    {!activeTicketId ? (
                        <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
                            <MessageSquare className="w-16 h-16 mb-4 opacity-20" />
                            <p className="font-medium text-slate-500">Select a ticket to view conversation</p>
                        </div>
                    ) : activeTicket ? (
                        <>
                            {/* Header */}
                            <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
                                <div className="flex-1 min-w-0 pr-4">
                                    <h3 className="text-lg font-bold text-slate-900 truncate">{activeTicket.subject}</h3>
                                    <div className="flex items-center gap-3 mt-1 font-mono text-xs text-slate-500">
                                        <span>User: {activeTicket.user?.email || activeTicket.user?.name}</span>
                                        <span>•</span>
                                        <span className={cn(
                                            activeTicket.user?.accountState === 'suspended' ? "text-rose-600 font-bold" : "text-emerald-600 font-bold"
                                        )}>
                                            [{activeTicket.user?.accountState}]
                                        </span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    <PremiumSelect 
                                        value={activeTicket.status}
                                        onChange={(e) => handleUpdateStatus(e.target.value)}
                                        className="w-[120px] text-xs font-bold"
                                    >
                                        <option value="open">Set Open</option>
                                        <option value="resolved">Set Resolved</option>
                                        <option value="closed">Set Closed</option>
                                    </PremiumSelect>
                                </div>
                            </div>

                            {/* Chat Body */}
                            <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-50/50 scrollbar-hide">
                                {messagesLoading ? (
                                    <div className="text-center text-slate-400 mt-10">Loading chat history...</div>
                                ) : (
                                    messages.map((m, i) => {
                                        const isAdmin = m.isAdmin;
                                        
                                        if (m.isSystem) {
                                            return (
                                                <div key={m._id || i} className="flex justify-center my-4">
                                                    <div className="bg-slate-200/50 border border-slate-300 px-4 py-1.5 rounded-full text-xs font-medium text-slate-600 flex items-center gap-2">
                                                        <AlertCircle className="w-3 h-3" /> {m.text}
                                                    </div>
                                                </div>
                                            );
                                        }

                                        return (
                                            <div key={m._id || i} className={cn("flex", isAdmin ? "justify-end" : "justify-start")}>
                                                <div className={cn(
                                                    "max-w-[85%] rounded-2xl p-4 shadow-sm",
                                                    isAdmin ? "bg-indigo-600 text-white rounded-tr-sm" : "bg-white border border-slate-200 text-slate-900 rounded-tl-sm"
                                                )}>
                                                    {!isAdmin && (
                                                        <div className="flex items-center gap-2 mb-2">
                                                            <div className="w-5 h-5 rounded-full bg-slate-200 flex items-center justify-center text-[10px] font-bold text-slate-600">
                                                                {(m.sender?.name || 'U')[0].toUpperCase()}
                                                            </div>
                                                            <span className="text-xs font-bold text-slate-500 tracking-wide">{m.sender?.name || m.sender?.email || 'User'}</span>
                                                        </div>
                                                    )}
                                                    {isAdmin && (
                                                        <div className="flex items-center gap-2 mb-2 justify-end">
                                                            <span className="text-xs font-bold text-indigo-200 tracking-wider uppercase">Staff Reply</span>
                                                            <ShieldAlert className="w-3.5 h-3.5 text-indigo-300" />
                                                        </div>
                                                    )}
                                                    <div className="whitespace-pre-wrap text-[15px] leading-relaxed">{m.text}</div>
                                                    <div className={cn("text-[10px] mt-2 font-medium text-right opacity-70", isAdmin ? "text-indigo-200" : "text-slate-400")}>
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
                                <form onSubmit={handleSendMessage} className="p-4 border-t border-slate-200 bg-white">
                                    <div className="flex gap-3 relative">
                                        <input 
                                            type="text" 
                                            value={newMessage}
                                            onChange={e => setNewMessage(e.target.value)}
                                            placeholder="Type your official response..."
                                            className="flex-1 bg-slate-100 border-none rounded-xl px-4 py-3.5 text-slate-900 font-medium focus:ring-2 focus:ring-indigo-500 focus:outline-none pr-14"
                                        />
                                        <button 
                                            type="submit" 
                                            disabled={!newMessage.trim() || sending}
                                            className="absolute right-2 top-2 bottom-2 aspect-square bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg flex items-center justify-center disabled:opacity-50 transition-colors shadow-sm"
                                        >
                                            <Send className="w-4 h-4 ml-0.5" />
                                        </button>
                                    </div>
                                </form>
                            ) : (
                                <div className="p-4 bg-slate-100 border-t border-slate-200 text-center text-slate-500 text-sm font-medium">
                                    This ticket is closed. Reopen it to send a new message.
                                </div>
                            )}
                        </>
                    ) : null}
                </div>
            </div>
        </AdminPremiumShell>
    );
}
