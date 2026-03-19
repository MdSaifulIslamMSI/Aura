import { useState, useEffect, useContext, useCallback, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
    MapPin,
    Eye,
    Clock,
    Shield,
    ShieldCheck,
    AlertTriangle,
    MessageCircle,
    Send,
    X,
    ChevronLeft,
    ChevronRight,
    Video,
    ArrowLeft,
} from 'lucide-react';
import { listingApi, otpApi, paymentApi } from '@/services/api';
import { AuthContext } from '@/context/AuthContext';
import { useSocket, useSocketDemand } from '@/context/SocketContext';
import { useVideoCall } from '@/context/VideoCallContext';
import { toast } from 'sonner';

import { loadRazorpayScript } from '@/utils/razorpay';

function timeAgo(dateStr) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs} hours ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days} days ago`;
    return `${Math.floor(days / 30)} months ago`;
}

const PAYMENT_PROVIDER = String(import.meta.env.VITE_PAYMENT_PROVIDER || '').trim().toLowerCase();

export default function ListingDetail() {
    const { id } = useParams();
    const { currentUser, dbUser } = useContext(AuthContext);
    const [listing, setListing] = useState(null);
    const [trustPassport, setTrustPassport] = useState(null);
    const [loading, setLoading] = useState(true);
    const [currentImage, setCurrentImage] = useState(0);
    const [showOffer, setShowOffer] = useState(false);
    const [offerPrice, setOfferPrice] = useState('');
    const [escrowBusy, setEscrowBusy] = useState(false);
    const [escrowError, setEscrowError] = useState('');
    const [escrowNotice, setEscrowNotice] = useState('');
    const [chatOpen, setChatOpen] = useState(false);
    const [chatLoading, setChatLoading] = useState(false);
    const [chatSending, setChatSending] = useState(false);
    const [chatError, setChatError] = useState('');
    const [chatInput, setChatInput] = useState('');
    const [conversation, setConversation] = useState(null);
    const { socket } = useSocket();
    const { startCall } = useVideoCall();

    useEffect(() => {
        (async () => {
            try {
                const data = await listingApi.getListingById(id);
                setListing(data.listing);
                setTrustPassport(data.trustPassport || null);
            } catch (err) {
                console.error(err);
            } finally {
                setLoading(false);
            }
        })();
    }, [id]);

    if (loading) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-[#04060f]">
                <div className="h-12 w-12 animate-spin rounded-full border-4 border-cyan-300/70 border-t-transparent" />
            </div>
        );
    }

    if (!listing) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-[#04060f] px-4 text-center text-slate-100">
                <div>
                    <h2 className="mb-2 text-2xl font-black">Listing not found</h2>
                    <Link
                        to="/marketplace"
                        className="inline-flex items-center gap-2 rounded-xl border border-cyan-300/35 bg-cyan-400/10 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-400/20"
                    >
                        <ArrowLeft className="h-4 w-4" />
                        Back to Marketplace
                    </Link>
                </div>
            </div>
        );
    }

    const images = listing.images || [];
    const seller = listing.seller || {};
    const isOwner = currentUser?.email && seller?.email && currentUser.email === seller.email;
    const memberSince = seller.createdAt
        ? new Date(seller.createdAt).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
        : '';
    const escrowState = String(listing?.escrow?.state || 'none').toLowerCase();
    const buyerId = String(listing?.escrow?.buyer || '');
    const isEscrowBuyer = buyerId && dbUser?._id && buyerId === String(dbUser._id);
    const escrowEnabled = Boolean(listing?.escrowOptIn);
    const showEscrowControls = !isOwner && escrowEnabled;
    useSocketDemand(`listing-realtime:${id}`, Boolean(currentUser && !isOwner));

    const loadConversation = useCallback(async (options = {}) => {
        const { silent = false } = options;
        if (!currentUser || isOwner) return;
        if (!silent) setChatLoading(true);
        setChatError('');

        try {
            const result = await listingApi.getListingMessages(id);
            setConversation(result.conversation || null);
        } catch (error) {
            setChatError(error.message || 'Failed to load conversation');
        } finally {
            if (!silent) setChatLoading(false);
        }
    }, [currentUser, id, isOwner]);

    useEffect(() => {
        if (!chatOpen) return undefined;
        loadConversation();
        // Fallback polling removed in favor of WebSockets
    }, [chatOpen, loadConversation]);

    // WebSocket real-time listener
    useEffect(() => {
        if (!socket || !chatOpen || !id || isOwner) return;

        const handleNewMessage = (payload) => {
            if (String(payload.listingId) !== String(id)) return;
            
            setConversation(prev => {
                if (!prev) {
                    // If we have no active conversation loaded, trigger a fetch
                    loadConversation({ silent: true });
                    return prev;
                }
                
                // Prevent duplicate messages if we already sent it
                const msgExists = (prev.messages || []).some(m => String(m._id) === String(payload.message._id));
                if (msgExists) return prev;
                
                return {
                    ...prev,
                    messages: [...(prev.messages || []), payload.message],
                    lastMessageAt: payload.message.sentAt,
                    lastMessagePreview: payload.message.text.substring(0, 180)
                };
            });
        };

        socket.on('new_message', handleNewMessage);
        
        return () => {
            socket.off('new_message', handleNewMessage);
        };
    }, [socket, chatOpen, id, isOwner, loadConversation]);

    const chatMessages = useMemo(
        () => (Array.isArray(conversation?.messages) ? conversation.messages : []),
        [conversation]
    );

    const handleOpenChat = () => {
        if (isOwner) return;
        if (!currentUser) {
            toast.error('Sign in to start a chat with seller');
            return;
        }
        setChatOpen(true);
    };

    const handleSendMessage = async (event) => {
        event?.preventDefault?.();
        if (!currentUser) {
            setChatError('Sign in required to send messages.');
            return;
        }
        const text = String(chatInput || '').trim();
        if (!text) return;

        setChatSending(true);
        setChatError('');
        try {
            const result = await listingApi.sendListingMessage(id, { text });
            setConversation(result.conversation || null);
            setChatInput('');
        } catch (error) {
            setChatError(error.message || 'Failed to send message');
        } finally {
            setChatSending(false);
        }
    };

    const handleSendOffer = async () => {
        const amount = Number(offerPrice);
        if (!Number.isFinite(amount) || amount <= 0) {
            toast.error('Enter a valid offer amount');
            return;
        }
        if (!currentUser) {
            toast.error('Sign in to send an offer');
            return;
        }

        setChatSending(true);
        setChatError('');
        try {
            const offerText = `Offer: Rs ${Math.round(amount).toLocaleString('en-IN')} for ${listing.title}`;
            const result = await listingApi.sendListingMessage(id, { text: offerText });
            setConversation(result.conversation || null);
            setOfferPrice('');
            setShowOffer(false);
            setChatOpen(true);
            toast.success('Offer sent to seller');
        } catch (error) {
            setChatError(error.message || 'Failed to send offer');
            toast.error(error.message || 'Failed to send offer');
        } finally {
            setChatSending(false);
        }
    };

    const handleEscrowStart = async () => {
        if (!currentUser) {
            setEscrowError('Sign in is required to start escrow.');
            return;
        }

        setEscrowBusy(true);
        setEscrowError('');
        setEscrowNotice('');
        try {
            const intent = await listingApi.createEscrowIntent(id, {
                paymentMethod: 'UPI',
                deviceContext: {
                    userAgent: navigator.userAgent,
                    platform: navigator.platform,
                    language: navigator.language,
                    screen: `${window.screen.width}x${window.screen.height}`,
                },
            });

            if (intent?.challengeRequired) {
                const challengePhone = String(dbUser?.phone || currentUser?.phoneNumber || '').trim();
                const challengeEmail = String(currentUser?.email || dbUser?.email || '').trim();
                if (!challengePhone || !challengeEmail) {
                    throw new Error('Payment challenge requires verified phone and email.');
                }

                await otpApi.sendOtp(challengeEmail, challengePhone, 'payment-challenge');
                const otp = window.prompt('Enter payment challenge OTP to continue escrow payment');
                if (!otp) {
                    throw new Error('Payment challenge OTP is required to continue.');
                }

                const otpResult = await otpApi.verifyOtp(
                    challengePhone,
                    String(otp),
                    'payment-challenge',
                    intent.intentId
                );
                if (!otpResult?.challengeToken) {
                    throw new Error('Challenge verification token missing.');
                }
                await paymentApi.completeChallenge(intent.intentId, {
                    challengeToken: otpResult.challengeToken,
                });
            }

            if ((intent.provider || PAYMENT_PROVIDER) === 'simulated') {
                const simulatedConfirm = intent.simulatedConfirm || intent.checkoutPayload?.simulatedConfirm;
                if (!simulatedConfirm) {
                    throw new Error('Simulated payment confirmation payload is missing.');
                }
                await listingApi.confirmEscrowIntent(id, intent.intentId, simulatedConfirm);
            } else {
                await loadRazorpayScript();
                await new Promise((resolve, reject) => {
                    const rzp = new window.Razorpay({
                        ...intent.checkoutPayload,
                        handler: async (paymentResponse) => {
                            try {
                                await listingApi.confirmEscrowIntent(id, intent.intentId, {
                                    providerPaymentId: paymentResponse.razorpay_payment_id,
                                    providerOrderId: paymentResponse.razorpay_order_id,
                                    providerSignature: paymentResponse.razorpay_signature,
                                });
                                resolve();
                            } catch (error) {
                                reject(error);
                            }
                        },
                        modal: {
                            ondismiss: () => reject(new Error('Escrow payment window was closed before confirmation.')),
                        },
                    });
                    rzp.open();
                });
            }

            const result = await listingApi.startEscrow(id, {
                paymentIntentId: intent.intentId,
            });
            setListing(result.listing);
            setEscrowNotice(result.message || 'Escrow hold created with verified payment authorization.');
        } catch (error) {
            setEscrowError(error.message || 'Failed to start escrow');
        } finally {
            setEscrowBusy(false);
        }
    };

    const handleEscrowConfirm = async () => {
        setEscrowBusy(true);
        setEscrowError('');
        setEscrowNotice('');
        try {
            const result = await listingApi.confirmEscrow(id);
            setListing(result.listing);
            setEscrowNotice(result.message || 'Delivery confirmed and escrow released.');
        } catch (error) {
            setEscrowError(error.message || 'Failed to confirm delivery');
        } finally {
            setEscrowBusy(false);
        }
    };

    const handleEscrowCancel = async () => {
        setEscrowBusy(true);
        setEscrowError('');
        setEscrowNotice('');
        try {
            const result = await listingApi.cancelEscrow(id);
            setListing(result.listing);
            setEscrowNotice(result.message || 'Escrow cancelled.');
        } catch (error) {
            setEscrowError(error.message || 'Failed to cancel escrow');
        } finally {
            setEscrowBusy(false);
        }
    };

    return (
        <div className="min-h-screen bg-[#04060f] text-slate-100">
            <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
                <div className="absolute left-[-10%] top-[8%] h-[360px] w-[360px] rounded-full bg-cyan-500/15 blur-3xl" />
                <div className="absolute right-[-10%] top-[18%] h-[420px] w-[420px] rounded-full bg-violet-500/15 blur-3xl" />
                <div className="absolute bottom-[-15%] left-[35%] h-[320px] w-[320px] rounded-full bg-emerald-500/10 blur-3xl" />
            </div>

            <div className="border-b border-cyan-400/20 bg-[#050817]/80">
                <div className="mx-auto max-w-6xl px-4 py-4 text-sm">
                    <Link to="/marketplace" className="text-cyan-100/80 transition hover:text-cyan-100">
                        Marketplace
                    </Link>
                    <span className="mx-2 text-slate-500">&gt;</span>
                    <span className="capitalize text-slate-300">{listing.category}</span>
                    <span className="mx-2 text-slate-500">&gt;</span>
                    <span className="text-slate-100">{listing.title}</span>
                </div>
            </div>

            <div className="mx-auto max-w-6xl px-4 py-8">
                <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
                    <div className="space-y-6 lg:col-span-2">
                        <div className="overflow-hidden rounded-3xl border border-cyan-400/20 bg-slate-900/70 shadow-[0_0_40px_rgba(34,211,238,0.1)]">
                            <div className="relative aspect-[16/10] bg-slate-950/80">
                                <img src={images[currentImage] || '/placeholder.png'} alt={listing.title} className="h-full w-full object-contain" />
                                {images.length > 1 && (
                                    <>
                                        <button
                                            onClick={() => setCurrentImage((i) => (i - 1 + images.length) % images.length)}
                                            className="absolute left-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-cyan-300/30 bg-slate-950/75 text-cyan-100 transition hover:bg-slate-900"
                                        >
                                            <ChevronLeft className="h-5 w-5" />
                                        </button>
                                        <button
                                            onClick={() => setCurrentImage((i) => (i + 1) % images.length)}
                                            className="absolute right-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-cyan-300/30 bg-slate-950/75 text-cyan-100 transition hover:bg-slate-900"
                                        >
                                            <ChevronRight className="h-5 w-5" />
                                        </button>
                                    </>
                                )}
                                {images.length > 1 && (
                                    <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1.5">
                                        {images.map((_, i) => (
                                            <button
                                                key={i}
                                                onClick={() => setCurrentImage(i)}
                                                className={`h-2.5 rounded-full transition-all ${i === currentImage ? 'w-6 bg-cyan-300' : 'w-2.5 bg-slate-400/70'}`}
                                            />
                                        ))}
                                    </div>
                                )}
                            </div>

                            {images.length > 1 && (
                                <div className="flex gap-2 overflow-x-auto border-t border-cyan-400/20 p-3">
                                    {images.map((img, i) => (
                                        <button
                                            key={i}
                                            onClick={() => setCurrentImage(i)}
                                            className={`h-16 w-16 flex-shrink-0 overflow-hidden rounded-xl border-2 transition ${
                                                i === currentImage ? 'border-cyan-300 shadow-[0_0_16px_rgba(34,211,238,0.25)]' : 'border-slate-700'
                                            }`}
                                        >
                                            <img src={img} alt="" className="h-full w-full object-cover" />
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="space-y-5 rounded-3xl border border-cyan-400/20 bg-slate-900/70 p-6 shadow-[0_0_30px_rgba(15,23,42,0.65)]">
                            <div>
                                <h1 className="text-2xl font-black md:text-3xl">{listing.title}</h1>
                                <div className="mt-3 flex flex-wrap items-center gap-2">
                                    <span className="rounded-full border border-cyan-300/35 bg-cyan-400/15 px-3 py-1 text-xs font-bold uppercase tracking-wide text-cyan-100">
                                        {listing.category}
                                    </span>
                                    <span className="rounded-full border border-slate-600 bg-slate-800 px-3 py-1 text-xs font-bold uppercase tracking-wide text-slate-200">
                                        {listing.condition}
                                    </span>
                                    {listing.negotiable && (
                                        <span className="rounded-full border border-emerald-300/40 bg-emerald-500/15 px-3 py-1 text-xs font-bold uppercase tracking-wide text-emerald-100">
                                            Negotiable
                                        </span>
                                    )}
                                </div>
                            </div>

                            <div className="h-px bg-gradient-to-r from-transparent via-cyan-300/30 to-transparent" />

                            <div>
                                <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-cyan-100/80">Description</h3>
                                <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-300">{listing.description}</p>
                            </div>

                            <div className="h-px bg-gradient-to-r from-transparent via-cyan-300/30 to-transparent" />

                            <div className="grid gap-2 text-sm text-slate-300 sm:grid-cols-3">
                                <span className="flex items-center gap-2">
                                    <MapPin className="h-4 w-4 text-cyan-300/80" />
                                    {listing.location?.city}, {listing.location?.state}
                                </span>
                                <span className="flex items-center gap-2">
                                    <Clock className="h-4 w-4 text-cyan-300/80" />
                                    Posted {timeAgo(listing.createdAt)}
                                </span>
                                <span className="flex items-center gap-2">
                                    <Eye className="h-4 w-4 text-cyan-300/80" />
                                    {listing.views || 0} views
                                </span>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-6">
                        <div className="sticky top-4 rounded-3xl border border-cyan-400/20 bg-slate-900/75 p-6 shadow-[0_0_40px_rgba(34,211,238,0.12)]">
                            <p className="text-3xl font-black text-slate-100">Rs. {listing.price?.toLocaleString('en-IN')}</p>
                            {listing.negotiable && <p className="mt-1 text-sm text-emerald-300">Price is negotiable</p>}
                            {escrowEnabled && (
                                <p className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-cyan-300/35 bg-cyan-500/15 px-3 py-1 text-[11px] font-black uppercase tracking-[0.12em] text-cyan-100">
                                    <ShieldCheck className="h-3.5 w-3.5" />
                                    Escrow Mode Enabled
                                </p>
                            )}

                            <div className="mt-6 space-y-3">
                                <button
                                    onClick={() => setShowOffer(true)}
                                    disabled={isOwner}
                                    className="w-full rounded-xl border border-cyan-300/40 bg-gradient-to-r from-cyan-500/25 to-violet-500/25 py-3 text-sm font-bold text-cyan-100 transition hover:from-cyan-500/35 hover:to-violet-500/35 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    {isOwner ? 'Your listing' : 'Make an offer'}
                                </button>
                                <button
                                    disabled={isOwner}
                                    onClick={handleOpenChat}
                                    className="w-full rounded-xl border border-slate-600 bg-slate-800/60 py-3 text-sm font-bold text-slate-200 transition hover:border-cyan-300/35 hover:text-cyan-100 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    <MessageCircle className="mr-2 inline h-4 w-4" />
                                    {isOwner ? 'This is your listing' : 'Chat with seller'}
                                </button>
                                {!isOwner && (
                                    <button
                                        disabled={!currentUser}
                                        onClick={() => startCall(seller._id, id)}
                                        className="w-full rounded-xl border border-blue-300/40 bg-blue-500/20 py-3 text-sm font-bold text-blue-100 transition hover:bg-blue-500/30 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                        <Video className="mr-2 inline h-4 w-4" />
                                        Request Live Inspection
                                    </button>
                                )}
                                {showEscrowControls && escrowState === 'none' && (
                                    <button
                                        disabled={escrowBusy}
                                        onClick={handleEscrowStart}
                                        className="w-full rounded-xl border border-cyan-300/45 bg-cyan-400/20 py-3 text-sm font-black uppercase tracking-[0.12em] text-cyan-50 transition hover:bg-cyan-400/30 disabled:opacity-60"
                                    >
                                        {escrowBusy ? 'Starting...' : 'Secure Escrow Buy'}
                                    </button>
                                )}
                                {showEscrowControls && escrowState === 'held' && isEscrowBuyer && (
                                    <div className="grid grid-cols-1 gap-2">
                                        <button
                                            disabled={escrowBusy}
                                            onClick={handleEscrowConfirm}
                                            className="w-full rounded-xl border border-emerald-300/45 bg-emerald-500/20 py-3 text-sm font-black uppercase tracking-[0.12em] text-emerald-100 transition hover:bg-emerald-500/30 disabled:opacity-60"
                                        >
                                            {escrowBusy ? 'Processing...' : 'Confirm Delivery & Release'}
                                        </button>
                                        <button
                                            disabled={escrowBusy}
                                            onClick={handleEscrowCancel}
                                            className="w-full rounded-xl border border-rose-300/40 bg-rose-500/15 py-2.5 text-sm font-bold text-rose-100 transition hover:bg-rose-500/25 disabled:opacity-60"
                                        >
                                            Cancel Escrow
                                        </button>
                                    </div>
                                )}
                                {escrowState === 'held' && isOwner && (
                                    <button
                                        disabled={escrowBusy}
                                        onClick={handleEscrowCancel}
                                        className="w-full rounded-xl border border-amber-300/45 bg-amber-500/15 py-2.5 text-sm font-bold text-amber-100 transition hover:bg-amber-500/25 disabled:opacity-60"
                                    >
                                        Cancel Escrow Hold
                                    </button>
                                )}
                                {escrowState === 'released' && (
                                    <div className="rounded-xl border border-emerald-300/35 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-100">
                                        Escrow completed. Funds were released after buyer confirmation.
                                    </div>
                                )}
                                {escrowState === 'cancelled' && (
                                    <div className="rounded-xl border border-amber-300/35 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-100">
                                        Escrow hold was cancelled. Listing is active again.
                                    </div>
                                )}
                                {escrowError && (
                                    <div className="rounded-xl border border-rose-300/35 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-100 inline-flex items-center gap-1.5">
                                        <AlertTriangle className="h-3.5 w-3.5" />
                                        {escrowError}
                                    </div>
                                )}
                                {escrowNotice && (
                                    <div className="rounded-xl border border-cyan-300/35 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-100">
                                        {escrowNotice}
                                    </div>
                                )}
                            </div>

                            {showOffer && (
                                <div className="mt-4 rounded-xl border border-cyan-300/25 bg-slate-950/70 p-4">
                                    <label className="text-xs font-semibold uppercase tracking-wide text-cyan-100/70">Your offer (Rs.)</label>
                                    <input
                                        type="number"
                                        value={offerPrice}
                                        onChange={(e) => setOfferPrice(e.target.value)}
                                        placeholder={`Example: ${Math.round(listing.price * 0.8)}`}
                                        className="mt-2 h-11 w-full rounded-xl border border-slate-700 bg-slate-900/80 px-3 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-cyan-300/40"
                                    />
                                    <div className="mt-3 flex gap-2">
                                        <button
                                            onClick={handleSendOffer}
                                            disabled={chatSending}
                                            className="flex-1 rounded-lg border border-cyan-300/35 bg-cyan-400/15 py-2 text-sm font-bold text-cyan-100 transition hover:bg-cyan-400/25 disabled:opacity-60"
                                        >
                                            Send offer
                                        </button>
                                        <button
                                            onClick={() => setShowOffer(false)}
                                            className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-300 transition hover:bg-slate-800"
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="rounded-3xl border border-cyan-400/20 bg-slate-900/70 p-6">
                            <div className="mb-4 flex items-center gap-4">
                                <div className="flex h-14 w-14 items-center justify-center rounded-full border border-cyan-300/35 bg-gradient-to-br from-cyan-500/35 to-violet-500/35 text-xl font-black text-white">
                                    {seller.name?.charAt(0)?.toUpperCase() || 'S'}
                                </div>
                                <div>
                                    <h3 className="font-bold text-slate-100">{seller.name || 'Seller'}</h3>
                                    {memberSince && <p className="text-xs text-slate-400">Member since {memberSince}</p>}
                                </div>
                            </div>
                            <Link
                                to={`/seller/${seller._id}`}
                                className="block rounded-xl border border-cyan-300/35 bg-cyan-400/10 py-2 text-center text-sm font-semibold text-cyan-100 transition hover:bg-cyan-400/20"
                            >
                                View seller profile
                            </Link>

                            {trustPassport && (
                                <div className="mt-4 rounded-xl border border-cyan-300/25 bg-cyan-500/10 p-4">
                                    <p className="text-[11px] font-black uppercase tracking-[0.16em] text-cyan-100 mb-2">Seller Trust Passport</p>
                                    <div className="grid grid-cols-2 gap-2 text-xs">
                                        <div className="rounded-lg border border-white/10 bg-slate-950/40 px-2 py-2">
                                            <p className="text-slate-400 uppercase tracking-wider">Trust</p>
                                            <p className="text-cyan-100 font-black text-base">{trustPassport.trustScore}</p>
                                        </div>
                                        <div className="rounded-lg border border-white/10 bg-slate-950/40 px-2 py-2">
                                            <p className="text-slate-400 uppercase tracking-wider">Fraud Tier</p>
                                            <p className="text-cyan-100 font-black text-base uppercase">{trustPassport.fraudRiskTier}</p>
                                        </div>
                                        <div className="rounded-lg border border-white/10 bg-slate-950/40 px-2 py-2">
                                            <p className="text-slate-400 uppercase tracking-wider">Disputes</p>
                                            <p className="text-cyan-100 font-black text-base">{trustPassport.disputeRate}%</p>
                                        </div>
                                        <div className="rounded-lg border border-white/10 bg-slate-950/40 px-2 py-2">
                                            <p className="text-slate-400 uppercase tracking-wider">On-time</p>
                                            <p className="text-cyan-100 font-black text-base">{trustPassport.onTimeHistory}%</p>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="rounded-3xl border border-amber-300/25 bg-amber-500/10 p-5">
                            <h4 className="mb-2 flex items-center gap-2 font-bold text-amber-100">
                                <Shield className="h-4 w-4" />
                                Safety checks
                            </h4>
                            <ul className="space-y-1 text-xs text-amber-100/85">
                                <li>- Meet in public, well-lit places.</li>
                                <li>- Verify the item physically before payment.</li>
                                <li>- Do not share card, OTP, or banking details.</li>
                                <li>- Keep all negotiation inside Aura chat.</li>
                            </ul>
                        </div>
                    </div>
                </div>
            </div>

            {chatOpen && !isOwner && (
                <div
                    className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/75 p-3 md:items-center"
                    onClick={() => setChatOpen(false)}
                >
                    <div
                        className="flex max-h-[86vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-cyan-300/35 bg-[#050817] shadow-[0_0_50px_rgba(34,211,238,0.2)]"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="flex items-center justify-between border-b border-cyan-300/20 px-4 py-3">
                            <div>
                                <p className="text-xs font-black uppercase tracking-[0.14em] text-cyan-200/80">Aura Marketplace Chat</p>
                                <p className="text-sm font-semibold text-slate-100">
                                    {conversation?.counterpart?.name || seller.name || 'Seller'}
                                </p>
                            </div>
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={() => startCall(seller._id, id)}
                                    className="rounded-lg border border-slate-700 bg-slate-900/80 p-2 text-slate-300 transition hover:border-blue-300/35 hover:text-blue-100"
                                    title="Start Live Inspection"
                                >
                                    <Video className="h-4 w-4" />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setChatOpen(false)}
                                    className="rounded-lg border border-slate-700 bg-slate-900/80 p-2 text-slate-300 transition hover:border-cyan-300/35 hover:text-cyan-100"
                                >
                                    <X className="h-4 w-4" />
                                </button>
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto px-4 py-4">
                            {chatLoading ? (
                                <div className="flex items-center justify-center py-16">
                                    <div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-300/60 border-t-transparent" />
                                </div>
                            ) : chatMessages.length === 0 ? (
                                <div className="rounded-xl border border-cyan-300/20 bg-cyan-500/10 px-4 py-6 text-center text-sm text-cyan-100/90">
                                    No messages yet. Start the conversation with seller.
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {chatMessages.map((message) => (
                                        <div
                                            key={message.id || `${message.senderId}-${message.sentAt}`}
                                            className={`max-w-[88%] rounded-2xl border px-3 py-2 text-sm ${
                                                message.isMine
                                                    ? 'ml-auto border-cyan-300/35 bg-cyan-500/15 text-cyan-50'
                                                    : 'border-slate-700 bg-slate-900/80 text-slate-100'
                                            }`}
                                        >
                                            <p className="whitespace-pre-wrap break-words">{message.text}</p>
                                            <p className="mt-1 text-[11px] opacity-75">
                                                {message.sentAt ? new Date(message.sentAt).toLocaleString('en-IN') : ''}
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {chatError && (
                            <div className="border-t border-rose-300/30 bg-rose-500/10 px-4 py-2 text-xs font-semibold text-rose-200">
                                {chatError}
                            </div>
                        )}

                        <form onSubmit={handleSendMessage} className="border-t border-cyan-300/20 p-3">
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={chatInput}
                                    onChange={(event) => setChatInput(event.target.value)}
                                    maxLength={1200}
                                    placeholder="Type your message..."
                                    className="h-11 flex-1 rounded-xl border border-slate-700 bg-slate-900/80 px-3 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-cyan-300/40"
                                />
                                <button
                                    type="submit"
                                    disabled={chatSending || !String(chatInput || '').trim()}
                                    className="inline-flex h-11 items-center gap-2 rounded-xl border border-cyan-300/40 bg-cyan-400/20 px-4 text-sm font-bold text-cyan-100 transition hover:bg-cyan-400/30 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    <Send className="h-4 w-4" />
                                    Send
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
