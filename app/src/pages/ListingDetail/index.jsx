import { useState, useEffect, useContext, useCallback, useMemo, useRef } from 'react';
import { useParams, Link, useLocation, useNavigate } from 'react-router-dom';
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
    CheckCheck,
    Sparkles,
    TicketPercent,
    Loader2,
    PhoneCall,
    Wifi,
    WifiOff,
} from 'lucide-react';
import { listingApi, otpApi, paymentApi } from '@/services/api';
import { AuthContext } from '@/context/AuthContext';
import { useMarket } from '@/context/MarketContext';
import { useSocket, useSocketDemand } from '@/context/SocketContext';
import { useVideoCall } from '@/context/VideoCallContext';
import { useDynamicTranslations } from '@/hooks/useDynamicTranslations';
import { toast } from 'sonner';

import { BROWSE_BASE_CURRENCY } from '@/config/marketConfig';
import { loadRazorpayScript } from '@/utils/razorpay';
import OtpChallengeModal from '@/pages/Checkout/components/OtpChallengeModal';

function timeAgo(dateStr, t) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return t('listingDetail.time.minutesAgo', { count: mins }, '{{count}} min ago');
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return t('listingDetail.time.hoursAgo', { count: hrs }, '{{count}} hours ago');
    const days = Math.floor(hrs / 24);
    if (days < 30) return t('listingDetail.time.daysAgo', { count: days }, '{{count}} days ago');
    return t('listingDetail.time.monthsAgo', { count: Math.floor(days / 30) }, '{{count}} months ago');
}

function formatThreadPreviewTime(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const sameDay = date.toDateString() === now.toDateString();
    const sameYear = date.getFullYear() === now.getFullYear();

    if (sameDay) {
        return date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
    }

    return date.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: sameYear ? 'short' : 'short',
        year: sameYear ? undefined : 'numeric',
    });
}

function isSameCalendarDay(left, right) {
    if (!left || !right) return false;
    return new Date(left).toDateString() === new Date(right).toDateString();
}

function formatChatDayLabel(dateStr, t) {
    if (!dateStr) return t('listingDetail.chat.day.recently', {}, 'Recently');
    const date = new Date(dateStr);
    const now = new Date();
    const yesterday = new Date();
    yesterday.setDate(now.getDate() - 1);

    if (date.toDateString() === now.toDateString()) {
        return t('listingDetail.chat.day.today', {}, 'Today');
    }

    if (date.toDateString() === yesterday.toDateString()) {
        return t('listingDetail.chat.day.yesterday', {}, 'Yesterday');
    }

    return date.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
    });
}

function formatMessageTime(dateStr) {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleTimeString('en-IN', {
        hour: 'numeric',
        minute: '2-digit',
    });
}

function isOfferMessage(text) {
    return /^offer:/i.test(String(text || '').trim());
}

function getThreadCounterpart(thread, fallbackUser = null) {
    return thread?.sellerUser || thread?.buyerUser || fallbackUser || null;
}

function getParticipantInitial(name = '') {
    const trimmed = String(name || '').trim();
    return trimmed ? trimmed.charAt(0).toUpperCase() : 'A';
}

const MARKETPLACE_CHAT_MAX_LENGTH = 1200;
const MARKETPLACE_CHAT_POLL_MS = 15000;
const normalizeLiveCallMode = (value) => (String(value || '').trim().toLowerCase() === 'voice' ? 'voice' : 'video');
const getListingCallModeLabel = (value, t) => (normalizeLiveCallMode(value) === 'voice'
    ? t('listingDetail.call.voiceLabel', {}, 'voice call')
    : t('listingDetail.call.liveInspectionLabel', {}, 'live inspection'));
const getListingCallTitle = (value, t) => (normalizeLiveCallMode(value) === 'voice'
    ? t('listingDetail.call.voiceTitle', {}, 'Voice Call')
    : t('listingDetail.call.liveInspectionTitle', {}, 'Live Inspection'));
const getListingCallContextLabel = (title, mediaMode = 'video', t) => (
    normalizeLiveCallMode(mediaMode) === 'voice'
        ? t('listingDetail.call.voiceContext', { title: String(title || 'listing') }, 'Voice call about "{{title}}"')
        : t('listingDetail.call.liveInspectionContext', { title: String(title || 'listing') }, 'Live inspection for "{{title}}"')
);

export default function ListingDetail() {
    const { id } = useParams();
    const location = useLocation();
    const navigate = useNavigate();
    const { currentUser, dbUser } = useContext(AuthContext);
    const { t, formatPrice } = useMarket();
    const [listing, setListing] = useState(null);
    const [listingLiveCall, setListingLiveCall] = useState(null);
    const [trustPassport, setTrustPassport] = useState(null);
    const [loading, setLoading] = useState(true);
    const [currentImage, setCurrentImage] = useState(0);
    const [showOffer, setShowOffer] = useState(false);
    const [offerPrice, setOfferPrice] = useState('');
    const [escrowBusy, setEscrowBusy] = useState(false);
    const [escrowError, setEscrowError] = useState('');
    const [escrowNotice, setEscrowNotice] = useState('');
    const [escrowOtpModal, setEscrowOtpModal] = useState({ open: false, loading: false, error: '' });
    const [chatOpen, setChatOpen] = useState(false);
    const [chatLoading, setChatLoading] = useState(false);
    const [chatSending, setChatSending] = useState(false);
    const [chatError, setChatError] = useState('');
    const [chatInput, setChatInput] = useState('');
    const [conversation, setConversation] = useState(null);
    const [chatInboxLoading, setChatInboxLoading] = useState(false);
    const [chatInbox, setChatInbox] = useState([]);
    const chatMessagesEndRef = useRef(null);
    const chatInputRef = useRef(null);
    const escrowOtpResolverRef = useRef(null);
    const { socket, isConnected, connectionState } = useSocket();
    const { startCall, joinCall, callStatus, activeCallContext } = useVideoCall();

    useEffect(() => {
        (async () => {
            try {
                const data = await listingApi.getListingById(id);
                setListing(data.listing);
                setListingLiveCall(data?.meta?.liveCall || null);
                setTrustPassport(data.trustPassport || null);
            } catch (err) {
                console.error(err);
            } finally {
                setLoading(false);
            }
        })();
    }, [currentUser?.uid, dbUser?._id, id]);

    if (loading) {
        return (
            <div className="listing-detail-theme-shell flex min-h-screen items-center justify-center bg-[#04060f]">
                <div className="h-12 w-12 animate-spin rounded-full border-4 border-cyan-300/70 border-t-transparent" />
            </div>
        );
    }

    if (!listing) {
        return (
            <div className="listing-detail-theme-shell flex min-h-screen items-center justify-center bg-[#04060f] px-4 text-center text-slate-100">
                <div>
                    <h2 className="mb-2 text-2xl font-black">{t('listingDetail.notFound.title', {}, 'Listing not found')}</h2>
                    <Link
                        to="/marketplace"
                        className="inline-flex items-center gap-2 rounded-xl border border-cyan-300/35 bg-cyan-400/10 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-400/20"
                    >
                        <ArrowLeft className="h-4 w-4" />
                        {t('listingDetail.notFound.back', {}, 'Back to Marketplace')}
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
    const canRequestLiveInspection = Boolean(!isOwner && currentUser && isEscrowBuyer);
    const activeListingCallContext = activeCallContext?.channelType === 'listing'
        && String(activeCallContext?.contextId || activeCallContext?.listingId || '') === String(id)
        ? activeCallContext
        : null;
    const isListingCallActive = Boolean(activeListingCallContext && callStatus !== 'idle');
    const listingLiveCallMode = normalizeLiveCallMode(
        activeListingCallContext?.mediaMode
        || listingLiveCall?.mediaMode
    );
    const listingLiveCallLabel = getListingCallModeLabel(listingLiveCallMode, t);
    const listingLiveCallTitle = getListingCallTitle(listingLiveCallMode, t);
    const liveInspectionStatus = String(listingLiveCall?.status || '').trim().toLowerCase();
    const canJoinLiveInspection = Boolean(
        currentUser
        && listingLiveCall?.sessionKey
        && (isOwner || isEscrowBuyer)
        && (liveInspectionStatus === 'ringing' || liveInspectionStatus === 'connected')
    );
    const canStartLiveInspection = Boolean(canRequestLiveInspection || canJoinLiveInspection);
    const showLiveInspectionAction = Boolean(canRequestLiveInspection || canJoinLiveInspection || isListingCallActive);
    const liveInspectionHint = isOwner
        ? canJoinLiveInspection
            ? t('listingDetail.liveHint.ownerRejoin', { mode: listingLiveCallLabel }, 'A {{mode}} is already active for this escrow. Join it again from here if you refreshed the page.')
            : ''
        : !currentUser
            ? t('listingDetail.liveHint.signIn', {}, 'Sign in and start escrow to unlock voice and video calls with the seller.')
        : !escrowEnabled
            ? t('listingDetail.liveHint.escrowUnavailable', {}, 'Seller has not enabled escrow, so live calls are unavailable for this listing.')
        : canJoinLiveInspection
            ? t('listingDetail.liveHint.rejoin', { mode: listingLiveCallLabel }, 'A {{mode}} is already active for this escrow. Join it again from here if you refreshed the page.')
        : isEscrowBuyer
                    ? ''
                    : buyerId
                        ? t('listingDetail.liveHint.reserved', {}, 'Live calls are reserved for the active escrow buyer on this listing.')
                        : t('listingDetail.liveHint.startEscrow', {}, 'Start escrow to unlock voice and video calls with the seller.');
    const isSocketReconnecting = connectionState === 'connecting' || connectionState === 'reconnecting';
    const chatConnectionLabel = connectionState === 'connected'
        ? t('listingDetail.chat.connection.live', {}, 'Live updates on')
        : isSocketReconnecting
            ? t('listingDetail.chat.connection.reconnecting', {}, 'Reconnecting...')
            : t('listingDetail.chat.connection.polling', {}, 'Polling fallback');
    const chatConnectionCopy = connectionState === 'connected'
        ? t('listingDetail.chat.copy.live', {}, 'Realtime is connected for this deal.')
        : isSocketReconnecting
            ? t('listingDetail.chat.copy.reconnecting', {}, 'Realtime is reconnecting for this deal.')
            : t('listingDetail.chat.copy.polling', { seconds: Math.round(MARKETPLACE_CHAT_POLL_MS / 1000) }, 'Realtime is on polling fallback. Aura refreshes this thread every {{seconds}} seconds.');
    const chatCharacterCount = String(chatInput || '').length;

    const handleLiveInspection = useCallback(async (mediaMode = 'video') => {
        if (isListingCallActive) {
            return;
        }

        const requestedMode = canJoinLiveInspection
            ? listingLiveCallMode
            : normalizeLiveCallMode(mediaMode);
        const contextLabel = listingLiveCall?.contextLabel || getListingCallContextLabel(listing?.title, requestedMode, t);

        if (canJoinLiveInspection) {
            await joinCall({
                channelType: 'listing',
                contextId: id,
                listingId: id,
                contextLabel,
                sessionKey: listingLiveCall?.sessionKey,
                callerName: isOwner ? t('listingDetail.chat.escrowBuyer', {}, 'Escrow buyer') : (seller?.name || t('listingDetail.chat.seller', {}, 'Seller')),
                transport: 'livekit',
                mediaMode: requestedMode,
            });
            return;
        }

        await startCall({
            targetUserId: seller?._id,
            listingId: id,
            contextId: id,
            channelType: 'listing',
            contextLabel,
            callerName: seller?.name || t('listingDetail.chat.seller', {}, 'Seller'),
            transport: 'livekit',
            mediaMode: requestedMode,
        });
    }, [
        canJoinLiveInspection,
        id,
        isListingCallActive,
        isOwner,
        joinCall,
        listing?.title,
        listingLiveCall?.contextLabel,
        listingLiveCallMode,
        listingLiveCall?.sessionKey,
        seller?._id,
        seller?.name,
        startCall,
    ]);

    useSocketDemand(`listing-realtime:${id}`, Boolean(currentUser && !isOwner));

    const loadChatInbox = useCallback(async (options = {}) => {
        const { silent = false } = options;
        if (!currentUser) return;
        if (!silent) setChatInboxLoading(true);

        try {
            const result = await listingApi.getMessageInbox();
            setChatInbox(Array.isArray(result?.conversations) ? result.conversations : []);
        } catch (error) {
            if (import.meta.env.DEV) {
                console.warn('Marketplace inbox load failed', error);
            }
        } finally {
            if (!silent) setChatInboxLoading(false);
        }
    }, [currentUser]);

    const loadConversation = useCallback(async (options = {}) => {
        const { silent = false } = options;
        if (!currentUser || isOwner) return;
        if (!silent) setChatLoading(true);
        setChatError('');

        try {
            const result = await listingApi.getListingMessages(id);
            setConversation(result.conversation || null);
        } catch (error) {
            setChatError(error.message || t('listingDetail.chat.error.load', {}, 'Failed to load conversation'));
        } finally {
            if (!silent) setChatLoading(false);
        }
    }, [currentUser, id, isOwner, t]);

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

    const activeThread = useMemo(() => ({
        listing: conversation?.listing || {
            _id: listing._id,
            title: listing.title,
            price: listing.price,
            images: listing.images,
            status: listing.status,
        },
        sellerUser: conversation?.sellerUser || (!isOwner ? seller : null),
        buyerUser: conversation?.buyerUser || null,
        unreadCount: 0,
        lastMessageAt: conversation?.lastMessageAt || chatMessages[chatMessages.length - 1]?.sentAt || listing.createdAt,
        lastMessagePreview: conversation?.lastMessagePreview || chatMessages[chatMessages.length - 1]?.text || t('listingDetail.chat.readyPreview', {}, 'Start your negotiation in Aura chat.'),
    }), [chatMessages, conversation, isOwner, listing, seller, t]);

    const counterpart = useMemo(
        () => getThreadCounterpart(activeThread, seller),
        [activeThread, seller]
    );

    const counterpartName = counterpart?.name || seller?.name || t('listingDetail.chat.seller', {}, 'Seller');
    const formatListingPrice = useCallback((value) => formatPrice(Number(value || 0), undefined, undefined, {
        baseCurrency: BROWSE_BASE_CURRENCY,
    }), [formatPrice]);

    const otherInboxThreads = useMemo(
        () => chatInbox.filter((thread) => String(thread?.listing?._id || '') !== String(id)),
        [chatInbox, id]
    );

    const quickReplies = useMemo(() => {
        const suggestedOffer = Math.max(1, Math.round(Number(listing?.price || 0) * 0.92));
        return [
            t('listingDetail.quickReply.available', {}, 'Is this still available?'),
            listing?.negotiable
                ? t('listingDetail.quickReply.offer', { amount: formatListingPrice(suggestedOffer) }, 'Would you consider {{amount}}?')
                : t('listingDetail.quickReply.photos', {}, 'Can you share a few more close-up photos?'),
            showLiveInspectionAction
                ? t('listingDetail.quickReply.call', {}, 'Can we hop on a quick call about this?')
                : t('listingDetail.quickReply.meet', {}, 'Can we meet today to check the item?'),
        ];
    }, [formatListingPrice, listing?.negotiable, listing?.price, showLiveInspectionAction, t]);

    const offerSuggestions = useMemo(() => {
        const listingPrice = Number(listing?.price || 0);
        if (!Number.isFinite(listingPrice) || listingPrice <= 0) {
            return [];
        }

        return [0.95, 0.9, 0.85].map((ratio) => Math.max(1, Math.round(listingPrice * ratio)));
    }, [listing?.price]);

    const chatTimeline = useMemo(() => chatMessages.map((message, index) => {
        const sentAt = message?.sentAt || message?.createdAt || '';
        const previousMessage = chatMessages[index - 1];
        const nextMessage = chatMessages[index + 1];
        const previousSentAt = previousMessage?.sentAt || previousMessage?.createdAt || '';
        const nextSentAt = nextMessage?.sentAt || nextMessage?.createdAt || '';
        const isMine = String(message?.sender || '') === String(dbUser?._id || '')
            || (!isOwner && String(message?.senderRole || '').toLowerCase() === 'buyer');
        const previousIsMine = previousMessage
            ? (String(previousMessage?.sender || '') === String(dbUser?._id || '')
                || (!isOwner && String(previousMessage?.senderRole || '').toLowerCase() === 'buyer'))
            : false;
        const nextIsMine = nextMessage
            ? (String(nextMessage?.sender || '') === String(dbUser?._id || '')
                || (!isOwner && String(nextMessage?.senderRole || '').toLowerCase() === 'buyer'))
            : false;

        return {
            key: message?._id || message?.id || `${message?.sender || 'unknown'}-${sentAt || index}`,
            message,
            isMine,
            isOffer: isOfferMessage(message?.text),
            showDatePill: !previousMessage || !isSameCalendarDay(sentAt, previousSentAt),
            dateLabel: formatChatDayLabel(sentAt, t),
            groupedWithPrevious: Boolean(previousMessage && previousIsMine === isMine && isSameCalendarDay(sentAt, previousSentAt)),
            groupedWithNext: Boolean(nextMessage && nextIsMine === isMine && isSameCalendarDay(sentAt, nextSentAt)),
        };
    }), [chatMessages, dbUser?._id, isOwner, t]);
    const listingDynamicTexts = useMemo(() => ([
        listing?.title,
        listing?.description,
        chatError,
        escrowError,
        escrowNotice,
        activeThread?.lastMessagePreview,
        ...otherInboxThreads.flatMap((thread) => [thread?.listing?.title, thread?.lastMessagePreview]),
        ...chatMessages.map((message) => message?.text),
    ]), [
        activeThread?.lastMessagePreview,
        chatError,
        chatMessages,
        escrowError,
        escrowNotice,
        listing?.description,
        listing?.title,
        otherInboxThreads,
    ]);
    const { translateText: translateListingText } = useDynamicTranslations(listingDynamicTexts, { enabled: Boolean(listing) });
    const translatedListingTitle = translateListingText(listing?.title) || listing?.title;
    const translatedListingDescription = translateListingText(listing?.description) || listing?.description;
    const translatedActiveThreadPreview = translateListingText(activeThread?.lastMessagePreview) || activeThread?.lastMessagePreview;
    const translatedOtherInboxThreads = useMemo(() => (
        otherInboxThreads.map((thread) => ({
            ...thread,
            translatedListingTitle: translateListingText(thread?.listing?.title) || thread?.listing?.title,
            translatedPreview: translateListingText(thread?.lastMessagePreview) || thread?.lastMessagePreview,
        }))
    ), [otherInboxThreads, translateListingText]);
    const translatedChatTimeline = useMemo(() => (
        chatTimeline.map((entry) => ({
            ...entry,
            translatedText: translateListingText(entry?.message?.text) || entry?.message?.text,
        }))
    ), [chatTimeline, translateListingText]);

    useEffect(() => {
        if (!chatOpen) return undefined;
        void loadConversation();
        void loadChatInbox();
    }, [chatOpen, loadConversation, loadChatInbox]);

    useEffect(() => {
        if (!chatOpen || !currentUser || isOwner || isConnected) return undefined;

        const pollTimer = window.setInterval(() => {
            void loadConversation({ silent: true });
            void loadChatInbox({ silent: true });
        }, MARKETPLACE_CHAT_POLL_MS);

        return () => window.clearInterval(pollTimer);
    }, [chatOpen, currentUser, isConnected, isOwner, loadChatInbox, loadConversation]);

    useEffect(() => {
        if (!chatOpen) return;

        chatMessagesEndRef.current?.scrollIntoView({
            behavior: 'smooth',
            block: 'end',
        });
    }, [chatMessages, chatOpen]);

    useEffect(() => {
        if (!chatOpen) return;

        const focusTimer = window.setTimeout(() => {
            chatInputRef.current?.focus();
        }, 140);

        return () => window.clearTimeout(focusTimer);
    }, [chatOpen]);

    useEffect(() => {
        const composer = chatInputRef.current;
        if (!composer) return;

        composer.style.height = '0px';
        const nextHeight = Math.min(Math.max(composer.scrollHeight, 52), 164);
        composer.style.height = `${nextHeight}px`;
    }, [chatInput, chatOpen]);

    useEffect(() => {
        const shouldOpenChat = Boolean(location.state?.openChat);
        if (!shouldOpenChat || isOwner || !currentUser) return;

        setChatOpen(true);
        setShowOffer(Boolean(location.state?.focusOffer));
        navigate(location.pathname, { replace: true, state: {} });
    }, [currentUser, isOwner, location.pathname, location.state, navigate]);

    const handleOpenChat = ({ focusOffer = false } = {}) => {
        if (isOwner) return;
        if (!currentUser) {
            toast.error(t('listingDetail.chat.error.signIn', {}, 'Sign in to start a chat with seller'));
            return;
        }
        setChatOpen(true);
        setShowOffer(focusOffer);
    };

    const handleCloseChat = useCallback(() => {
        setChatOpen(false);
        setShowOffer(false);
        setOfferPrice('');
        setChatError('');
    }, []);

    const handleOpenThread = useCallback((thread) => {
        const targetListingId = String(thread?.listing?._id || '').trim();
        if (!targetListingId || targetListingId === String(id)) {
            return;
        }

        handleCloseChat();
        navigate(`/listing/${targetListingId}`, {
            state: { openChat: true },
        });
    }, [handleCloseChat, id, navigate]);

    const handleSendMessage = async (event) => {
        event?.preventDefault?.();
        if (!currentUser) {
            setChatError(t('listingDetail.chat.error.signIn', {}, 'Sign in required to send messages.'));
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
            setChatError(error.message || t('listingDetail.chat.error.send', {}, 'Failed to send message'));
        } finally {
            setChatSending(false);
        }
    };

    const handleSendOffer = async () => {
        const amount = Number(offerPrice);
        if (!Number.isFinite(amount) || amount <= 0) {
            toast.error(t('listingDetail.offer.error.invalidAmount', {}, 'Enter a valid offer amount'));
            return;
        }
        if (!currentUser) {
            toast.error(t('listingDetail.offer.error.signIn', {}, 'Sign in to send an offer'));
            return;
        }

        setChatSending(true);
        setChatError('');
        try {
            const offerText = `Offer: ${formatListingPrice(Math.round(amount))} for ${listing.title}`;
            const result = await listingApi.sendListingMessage(id, { text: offerText });
            setConversation(result.conversation || null);
            setOfferPrice('');
            setShowOffer(false);
            setChatOpen(true);
            toast.success(t('listingDetail.offer.success.sent', {}, 'Offer sent to seller'));
        } catch (error) {
            setChatError(error.message || t('listingDetail.offer.error.sendFailed', {}, 'Failed to send offer'));
            toast.error(error.message || t('listingDetail.offer.error.sendFailed', {}, 'Failed to send offer'));
        } finally {
            setChatSending(false);
        }
    };

    const promptEscrowOtp = useCallback(() => new Promise((resolve, reject) => {
        escrowOtpResolverRef.current = { resolve, reject };
        setEscrowOtpModal({ open: true, loading: false, error: '' });
    }), []);

    const handleEscrowOtpSubmit = useCallback((otp) => {
        setEscrowOtpModal((prev) => ({ ...prev, loading: true, error: '' }));
        escrowOtpResolverRef.current?.resolve(otp);
    }, []);

    const handleEscrowOtpClose = useCallback(() => {
        escrowOtpResolverRef.current?.reject(new Error('Payment challenge OTP entry cancelled.'));
        escrowOtpResolverRef.current = null;
        setEscrowOtpModal({ open: false, loading: false, error: '' });
    }, []);

    const handleEscrowStart = async () => {
        if (!currentUser) {
            setEscrowError(t('listingDetail.escrow.error.signIn', {}, 'Sign in is required to start escrow.'));
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
                const otp = await promptEscrowOtp();
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
                setEscrowOtpModal({ open: false, loading: false, error: '' });
                escrowOtpResolverRef.current = null;
            }

            if (!['authorized', 'captured'].includes(String(intent.status || '').toLowerCase())) {
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
            setEscrowNotice(result.message || t('listingDetail.escrow.notice.started', {}, 'Escrow hold created with verified payment authorization.'));
        } catch (error) {
            setEscrowOtpModal({ open: false, loading: false, error: '' });
            escrowOtpResolverRef.current = null;
            setEscrowError(error.message || t('listingDetail.escrow.error.start', {}, 'Failed to start escrow'));
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
            setEscrowNotice(result.message || t('listingDetail.escrow.notice.confirmed', {}, 'Delivery confirmed and escrow released.'));
        } catch (error) {
            setEscrowError(error.message || t('listingDetail.escrow.error.confirm', {}, 'Failed to confirm delivery'));
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
            setEscrowNotice(result.message || t('listingDetail.escrow.notice.cancelled', {}, 'Escrow cancelled.'));
        } catch (error) {
            setEscrowError(error.message || t('listingDetail.escrow.error.cancel', {}, 'Failed to cancel escrow'));
        } finally {
            setEscrowBusy(false);
        }
    };

    return (
        <div className="listing-detail-theme-shell min-h-screen bg-[#04060f] text-slate-100">
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
                    <span className="text-slate-100">{translatedListingTitle}</span>
                </div>
            </div>

            <div className="mx-auto max-w-6xl px-4 py-8">
                <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
                    <div className="space-y-6 lg:col-span-2">
                        <div className="overflow-hidden rounded-3xl border border-cyan-400/20 bg-slate-900/70 shadow-[0_0_40px_rgba(34,211,238,0.1)]">
                            <div className="relative aspect-[16/10] bg-slate-950/80">
                                <img src={images[currentImage] || '/placeholder.png'} alt={translatedListingTitle} className="h-full w-full object-contain" />
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
                                <h1 className="text-2xl font-black md:text-3xl">{translatedListingTitle}</h1>
                                <div className="mt-3 flex flex-wrap items-center gap-2">
                                    <span className="rounded-full border border-cyan-300/35 bg-cyan-400/15 px-3 py-1 text-xs font-bold uppercase tracking-wide text-cyan-100">
                                        {listing.category}
                                    </span>
                                    <span className="rounded-full border border-slate-600 bg-slate-800 px-3 py-1 text-xs font-bold uppercase tracking-wide text-slate-200">
                                        {listing.condition}
                                    </span>
                                    {listing.negotiable && (
                                        <span className="rounded-full border border-emerald-300/40 bg-emerald-500/15 px-3 py-1 text-xs font-bold uppercase tracking-wide text-emerald-100">
                                            {t('listingDetail.badge.negotiable', {}, 'Negotiable')}
                                        </span>
                                    )}
                                </div>
                            </div>

                            <div className="h-px bg-gradient-to-r from-transparent via-cyan-300/30 to-transparent" />

                            <div>
                                <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-cyan-100/80">{t('listingDetail.description', {}, 'Description')}</h3>
                                <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-300">{translatedListingDescription}</p>
                            </div>

                            <div className="h-px bg-gradient-to-r from-transparent via-cyan-300/30 to-transparent" />

                            <div className="grid gap-2 text-sm text-slate-300 sm:grid-cols-3">
                                <span className="flex items-center gap-2">
                                    <MapPin className="h-4 w-4 text-cyan-300/80" />
                                    {listing.location?.city}, {listing.location?.state}
                                </span>
                                <span className="flex items-center gap-2">
                                    <Clock className="h-4 w-4 text-cyan-300/80" />
                                    {t('listingDetail.posted', { time: timeAgo(listing.createdAt, t) }, 'Posted {{time}}')}
                                </span>
                                <span className="flex items-center gap-2">
                                    <Eye className="h-4 w-4 text-cyan-300/80" />
                                    {t('listingDetail.views', { count: listing.views || 0 }, '{{count}} views')}
                                </span>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-6">
                        <div className="sticky top-4 rounded-3xl border border-cyan-400/20 bg-slate-900/75 p-6 shadow-[0_0_40px_rgba(34,211,238,0.12)]">
                            <p className="text-3xl font-black text-slate-100">{formatListingPrice(listing.price)}</p>
                            {listing.negotiable && <p className="mt-1 text-sm text-emerald-300">{t('listingDetail.price.negotiable', {}, 'Price is negotiable')}</p>}
                            {escrowEnabled && (
                                <p className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-cyan-300/35 bg-cyan-500/15 px-3 py-1 text-[11px] font-black uppercase tracking-[0.12em] text-cyan-100">
                                    <ShieldCheck className="h-3.5 w-3.5" />
                                    {t('listingDetail.escrow.enabled', {}, 'Escrow Mode Enabled')}
                                </p>
                            )}

                            <div className="mt-6 space-y-3">
                                <button
                                    onClick={() => handleOpenChat({ focusOffer: true })}
                                    disabled={isOwner}
                                    className="w-full rounded-xl border border-cyan-300/40 bg-gradient-to-r from-cyan-500/25 to-violet-500/25 py-3 text-sm font-bold text-cyan-100 transition hover:from-cyan-500/35 hover:to-violet-500/35 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    {isOwner ? t('listingDetail.action.yourListing', {}, 'Your listing') : t('listingDetail.action.makeOffer', {}, 'Make an offer')}
                                </button>
                                <button
                                    disabled={isOwner}
                                    onClick={handleOpenChat}
                                    className="w-full rounded-xl border border-slate-600 bg-slate-800/60 py-3 text-sm font-bold text-slate-200 transition hover:border-cyan-300/35 hover:text-cyan-100 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    <MessageCircle className="mr-2 inline h-4 w-4" />
                                    {isOwner ? t('listingDetail.action.thisIsYourListing', {}, 'This is your listing') : t('listingDetail.action.chatWithSeller', {}, 'Chat with seller')}
                                </button>
                                {showLiveInspectionAction && (
                                    canJoinLiveInspection || isListingCallActive ? (
                                        <button
                                            disabled={!canStartLiveInspection || isListingCallActive}
                                            onClick={() => handleLiveInspection(listingLiveCallMode)}
                                            className="w-full rounded-xl border border-blue-300/40 bg-blue-500/20 py-3 text-sm font-bold text-blue-100 transition hover:bg-blue-500/30 disabled:cursor-not-allowed disabled:opacity-60"
                                        >
                                            {listingLiveCallMode === 'voice' ? <PhoneCall className="mr-2 inline h-4 w-4" /> : <Video className="mr-2 inline h-4 w-4" />}
                                            {isListingCallActive
                                                ? t('listingDetail.call.active', { title: listingLiveCallTitle }, '{{title}} Active')
                                                : t('listingDetail.call.join', { title: listingLiveCallTitle }, 'Join {{title}}')}
                                        </button>
                                    ) : (
                                        <div className="grid gap-3 sm:grid-cols-2">
                                            <button
                                                disabled={!canStartLiveInspection}
                                                onClick={() => handleLiveInspection('voice')}
                                                className="w-full rounded-xl border border-emerald-300/35 bg-emerald-500/18 py-3 text-sm font-bold text-emerald-100 transition hover:bg-emerald-500/28 disabled:cursor-not-allowed disabled:opacity-60"
                                            >
                                                <PhoneCall className="mr-2 inline h-4 w-4" />
                                                {t('listingDetail.call.voiceTitle', {}, 'Voice Call')}
                                            </button>
                                            <button
                                                disabled={!canStartLiveInspection}
                                                onClick={() => handleLiveInspection('video')}
                                                className="w-full rounded-xl border border-blue-300/40 bg-blue-500/20 py-3 text-sm font-bold text-blue-100 transition hover:bg-blue-500/30 disabled:cursor-not-allowed disabled:opacity-60"
                                            >
                                                <Video className="mr-2 inline h-4 w-4" />
                                                {t('listingDetail.call.liveInspectionTitle', {}, 'Live Inspection')}
                                            </button>
                                        </div>
                                    )
                                )}
                                {liveInspectionHint ? (
                                    <div className="rounded-xl border border-blue-300/20 bg-blue-500/10 px-3 py-2 text-xs font-semibold text-blue-100/90">
                                        {liveInspectionHint}
                                    </div>
                                ) : null}
                                {showEscrowControls && escrowState === 'none' && (
                                    <button
                                        disabled={escrowBusy}
                                        onClick={handleEscrowStart}
                                        className="w-full rounded-xl border border-cyan-300/45 bg-cyan-400/20 py-3 text-sm font-black uppercase tracking-[0.12em] text-cyan-50 transition hover:bg-cyan-400/30 disabled:opacity-60"
                                    >
                                        {escrowBusy ? t('listingDetail.escrow.starting', {}, 'Starting...') : t('listingDetail.escrow.buy', {}, 'Secure Escrow Buy')}
                                    </button>
                                )}
                                {showEscrowControls && escrowState === 'held' && isEscrowBuyer && (
                                    <div className="grid grid-cols-1 gap-2">
                                        <button
                                            disabled={escrowBusy}
                                            onClick={handleEscrowConfirm}
                                            className="w-full rounded-xl border border-emerald-300/45 bg-emerald-500/20 py-3 text-sm font-black uppercase tracking-[0.12em] text-emerald-100 transition hover:bg-emerald-500/30 disabled:opacity-60"
                                        >
                                            {escrowBusy ? t('listingDetail.escrow.processing', {}, 'Processing...') : t('listingDetail.escrow.confirmRelease', {}, 'Confirm Delivery & Release')}
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

                        </div>

                        <div className="rounded-3xl border border-cyan-400/20 bg-slate-900/70 p-6">
                            <div className="mb-4 flex items-center gap-4">
                                <div className="flex h-14 w-14 items-center justify-center rounded-full border border-cyan-300/35 bg-gradient-to-br from-cyan-500/35 to-violet-500/35 text-xl font-black text-white">
                                    {seller.name?.charAt(0)?.toUpperCase() || 'S'}
                                </div>
                                <div>
                                    <h3 className="font-bold text-slate-100">{seller.name || t('listingDetail.seller.default', {}, 'Seller')}</h3>
                                    {memberSince && <p className="text-xs text-slate-400">{t('listingDetail.seller.memberSince', { date: memberSince }, 'Member since {{date}}')}</p>}
                                </div>
                            </div>
                            <Link
                                to={`/seller/${seller._id}`}
                                className="block rounded-xl border border-cyan-300/35 bg-cyan-400/10 py-2 text-center text-sm font-semibold text-cyan-100 transition hover:bg-cyan-400/20"
                            >
                                {t('listingDetail.seller.viewProfile', {}, 'View seller profile')}
                            </Link>

                            {trustPassport && (
                                <div className="mt-4 rounded-xl border border-cyan-300/25 bg-cyan-500/10 p-4">
                                    <p className="text-[11px] font-black uppercase tracking-[0.16em] text-cyan-100 mb-2">{t('listingDetail.seller.passport', {}, 'Seller Trust Passport')}</p>
                                    <div className="grid grid-cols-2 gap-2 text-xs">
                                        <div className="rounded-lg border border-white/10 bg-slate-950/40 px-2 py-2">
                                            <p className="text-slate-400 uppercase tracking-wider">{t('listingDetail.seller.trust', {}, 'Trust')}</p>
                                            <p className="text-cyan-100 font-black text-base">{trustPassport.trustScore}</p>
                                        </div>
                                        <div className="rounded-lg border border-white/10 bg-slate-950/40 px-2 py-2">
                                            <p className="text-slate-400 uppercase tracking-wider">{t('listingDetail.seller.fraudTier', {}, 'Fraud Tier')}</p>
                                            <p className="text-cyan-100 font-black text-base uppercase">{trustPassport.fraudRiskTier}</p>
                                        </div>
                                        <div className="rounded-lg border border-white/10 bg-slate-950/40 px-2 py-2">
                                            <p className="text-slate-400 uppercase tracking-wider">{t('listingDetail.seller.disputes', {}, 'Disputes')}</p>
                                            <p className="text-cyan-100 font-black text-base">{trustPassport.disputeRate}%</p>
                                        </div>
                                        <div className="rounded-lg border border-white/10 bg-slate-950/40 px-2 py-2">
                                            <p className="text-slate-400 uppercase tracking-wider">{t('listingDetail.seller.onTime', {}, 'On-time')}</p>
                                            <p className="text-cyan-100 font-black text-base">{trustPassport.onTimeHistory}%</p>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="rounded-3xl border border-amber-300/25 bg-amber-500/10 p-5">
                            <h4 className="mb-2 flex items-center gap-2 font-bold text-amber-100">
                                <Shield className="h-4 w-4" />
                                {t('listingDetail.safety.title', {}, 'Safety checks')}
                            </h4>
                            <ul className="space-y-1 text-xs text-amber-100/85">
                                <li>- {t('listingDetail.safety.note1', {}, 'Meet in public, well-lit places.')}</li>
                                <li>- {t('listingDetail.safety.note2', {}, 'Verify the item physically before payment.')}</li>
                                <li>- {t('listingDetail.safety.note3', {}, 'Do not share card, OTP, or banking details.')}</li>
                                <li>- {t('listingDetail.safety.note4', {}, 'Keep all negotiation inside Aura chat.')}</li>
                            </ul>
                        </div>
                    </div>
                </div>
            </div>

            {chatOpen && !isOwner && (
                <div
                    className="fixed inset-0 z-50 bg-slate-950/85 p-0 backdrop-blur-sm sm:p-4"
                    onClick={handleCloseChat}
                >
                    <div
                        className="mx-auto flex h-full w-full max-w-6xl overflow-hidden rounded-none border border-cyan-300/20 bg-[#050817]/96 shadow-[0_40px_120px_rgba(8,15,27,0.78)] sm:h-[calc(100vh-2rem)] sm:rounded-[2rem]"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <aside className="hidden w-[22rem] shrink-0 flex-col border-r border-white/8 bg-[linear-gradient(180deg,rgba(8,13,24,0.98),rgba(4,8,16,0.98))] lg:flex">
                            <div className="border-b border-white/8 px-5 py-5">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="text-[11px] font-black uppercase tracking-[0.28em] text-emerald-200">{t('listingDetail.chat.eyebrow', {}, 'Marketplace chats')}</p>
                                        <h3 className="mt-2 text-2xl font-black text-white">{t('listingDetail.chat.title', {}, 'Deals that feel like a real messenger')}</h3>
                                        <p className="mt-2 text-sm text-slate-400">
                                            {t('listingDetail.chat.body', {}, 'Switch threads the way you would in WhatsApp, but keep pricing, escrow, and inspection inside Aura.')}
                                        </p>
                                    </div>
                                    <div className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-black ${
                                        isConnected
                                            ? 'border-emerald-300/20 bg-emerald-500/12 text-emerald-100'
                                            : 'border-amber-300/20 bg-amber-500/12 text-amber-100'
                                    }`}>
                                        {isConnected ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
                                        {chatConnectionLabel}
                                    </div>
                                </div>
                            </div>

                            <div className="flex-1 overflow-y-auto px-3 py-3">
                                <button
                                    type="button"
                                    disabled
                                    className="support-chat-card support-chat-card-active w-full cursor-default px-4 py-4 text-left"
                                >
                                    <div className="flex items-start gap-3">
                                        <div className="support-chat-avatar h-12 w-12 border border-emerald-300/20 bg-gradient-to-br from-emerald-500/30 to-cyan-500/30 text-lg font-black text-white">
                                            {getParticipantInitial(counterpartName)}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center justify-between gap-3">
                                                <p className="truncate text-sm font-bold text-white">{counterpartName}</p>
                                                <span className="text-[11px] font-semibold text-emerald-200">
                                                    {formatThreadPreviewTime(activeThread.lastMessageAt)}
                                                </span>
                                            </div>
                                            <p className="mt-1 truncate text-xs font-semibold uppercase tracking-[0.18em] text-cyan-100/65">
                                                {translatedListingTitle}
                                            </p>
                                            <p className="mt-2 line-clamp-2 text-sm text-slate-300">
                                                {translatedActiveThreadPreview || t('listingDetail.chat.firstMessage', {}, 'This thread is ready for your first message.')}
                                            </p>
                                        </div>
                                    </div>
                                </button>

                                <div className="mt-4 space-y-2">
                                    <p className="px-2 text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">
                                        {t('listingDetail.chat.otherThreads', {}, 'Other marketplace threads')}
                                    </p>

                                    {chatInboxLoading ? (
                                        Array.from({ length: 3 }).map((_, index) => (
                                            <div
                                                key={`chat-inbox-skeleton-${index}`}
                                                className="support-chat-card animate-pulse px-4 py-4"
                                            >
                                                <div className="flex items-center gap-3">
                                                    <div className="h-11 w-11 rounded-2xl bg-white/8" />
                                                    <div className="min-w-0 flex-1 space-y-2">
                                                        <div className="h-3 w-1/2 rounded-full bg-white/8" />
                                                        <div className="h-3 w-3/4 rounded-full bg-white/8" />
                                                    </div>
                                                </div>
                                            </div>
                                        ))
                                    ) : translatedOtherInboxThreads.length > 0 ? (
                                        translatedOtherInboxThreads.map((thread) => {
                                            const threadCounterpart = getThreadCounterpart(thread);
                                            return (
                                                <button
                                                    key={thread?.listing?._id || thread?.lastMessageAt}
                                                    type="button"
                                                    onClick={() => handleOpenThread(thread)}
                                                    className="support-chat-card w-full px-4 py-4 text-left transition"
                                                >
                                                    <div className="flex items-start gap-3">
                                                        <div className="support-chat-avatar h-11 w-11 border border-white/10 bg-white/5 text-base font-black text-white">
                                                            {getParticipantInitial(threadCounterpart?.name)}
                                                        </div>
                                                        <div className="min-w-0 flex-1">
                                                            <div className="flex items-center justify-between gap-3">
                                                                <p className="truncate text-sm font-bold text-white/95">
                                                                    {threadCounterpart?.name || t('listingDetail.chat.threadFallback', {}, 'Marketplace thread')}
                                                                </p>
                                                                <span className="text-[11px] text-slate-500">
                                                                    {formatThreadPreviewTime(thread?.lastMessageAt)}
                                                                </span>
                                                            </div>
                                                            <p className="mt-1 truncate text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                                                                {thread?.translatedListingTitle || t('listingDetail.chat.otherListing', {}, 'Other listing')}
                                                            </p>
                                                            <p className="mt-2 line-clamp-2 text-sm text-slate-400">
                                                                {thread?.translatedPreview || t('listingDetail.chat.openThread', {}, 'Open this thread')}
                                                            </p>
                                                        </div>
                                                        {Number(thread?.unreadCount || 0) > 0 ? (
                                                            <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-emerald-400 px-2 py-1 text-[11px] font-black text-slate-950">
                                                                {thread.unreadCount}
                                                            </span>
                                                        ) : null}
                                                    </div>
                                                </button>
                                            );
                                        })
                                    ) : (
                                        <div className="support-chat-card px-4 py-5 text-sm text-slate-400">
                                            {t('listingDetail.chat.emptyInbox', {}, 'This is your first marketplace thread. New listing chats will appear here like a real messenger inbox.')}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </aside>

                        <div className="support-chat-thread flex min-w-0 flex-1 flex-col">
                            <div className="border-b border-white/8 px-4 py-4 sm:px-6">
                                <div className="flex items-start justify-between gap-4">
                                    <div className="flex min-w-0 items-center gap-3">
                                        <div className="support-chat-avatar h-12 w-12 border border-emerald-300/20 bg-gradient-to-br from-emerald-500/35 to-cyan-500/35 text-lg font-black text-white">
                                            {getParticipantInitial(counterpartName)}
                                        </div>
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2">
                                                <h3 className="truncate text-lg font-black text-white">{counterpartName}</h3>
                                                {counterpart?.isVerified ? (
                                                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300/25 bg-emerald-500/10 px-2 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-emerald-200">
                                                        <ShieldCheck className="h-3 w-3" />
                                                        {t('listingDetail.badge.verifiedSeller', {}, 'Verified')}
                                                    </span>
                                                ) : null}
                                            </div>
                                            <p className="mt-1 text-sm text-slate-400">
                                                {activeThread.lastMessageAt
                                                    ? t('listingDetail.chat.lastMessage', { time: timeAgo(activeThread.lastMessageAt, t) }, 'Last message {{time}}')
                                                    : t('listingDetail.chat.freshThread', {}, 'Fresh marketplace thread')}
                                            </p>
                                            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                                                <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 font-black uppercase tracking-[0.16em] ${
                                                    isConnected
                                                        ? 'border-emerald-300/20 bg-emerald-500/12 text-emerald-100'
                                                        : 'border-amber-300/20 bg-amber-500/12 text-amber-100'
                                                }`}>
                                                    {isConnected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
                                                    {chatConnectionLabel}
                                                </span>
                                                <span>{chatConnectionCopy}</span>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-2">
                                        {showLiveInspectionAction ? (
                                            canJoinLiveInspection || isListingCallActive ? (
                                                <button
                                                    type="button"
                                                    disabled={!canStartLiveInspection || isListingCallActive}
                                                    onClick={() => handleLiveInspection(listingLiveCallMode)}
                                                    className="support-chat-utility h-11 w-11 bg-white/6 text-white transition hover:text-emerald-100"
                                                    title={canJoinLiveInspection ? t('listingDetail.call.join', { title: listingLiveCallLabel }, 'Join {{title}}') : listingLiveCallTitle}
                                                >
                                                    {listingLiveCallMode === 'voice' ? <PhoneCall className="h-4 w-4" /> : <Video className="h-4 w-4" />}
                                                </button>
                                            ) : (
                                                <>
                                                    <button
                                                        type="button"
                                                        disabled={!canStartLiveInspection}
                                                        onClick={() => handleLiveInspection('voice')}
                                                        className="support-chat-utility h-11 w-11 bg-white/6 text-white transition hover:text-emerald-100"
                                                        title={t('listingDetail.call.startVoice', {}, 'Start voice call')}
                                                    >
                                                        <PhoneCall className="h-4 w-4" />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        disabled={!canStartLiveInspection}
                                                        onClick={() => handleLiveInspection('video')}
                                                        className="support-chat-utility h-11 w-11 bg-white/6 text-white transition hover:text-cyan-100"
                                                        title={t('listingDetail.call.startInspection', {}, 'Start live inspection')}
                                                    >
                                                        <Video className="h-4 w-4" />
                                                    </button>
                                                </>
                                            )
                                        ) : null}
                                        <button
                                            type="button"
                                            onClick={handleCloseChat}
                                            className="support-chat-utility h-11 w-11 bg-white/6 text-white transition hover:text-cyan-100"
                                        >
                                            <X className="h-4 w-4" />
                                        </button>
                                    </div>
                                </div>

                                <div className="mt-4 rounded-[1.6rem] border border-white/8 bg-white/[0.03] p-3 shadow-[0_18px_40px_rgba(2,8,23,0.18)]">
                                    <div className="flex items-center gap-3">
                                        <div className="h-16 w-16 overflow-hidden rounded-[1.2rem] border border-white/10 bg-slate-950/70">
                                            <img
                                                src={images[0] || '/placeholder.png'}
                                                alt={translatedListingTitle}
                                                className="h-full w-full object-cover"
                                            />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <p className="text-[11px] font-black uppercase tracking-[0.22em] text-cyan-200/80">{t('listingDetail.chat.pinnedListing', {}, 'Pinned listing')}</p>
                                            <p className="mt-1 truncate text-base font-bold text-white">{translatedListingTitle}</p>
                                            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-300">
                                                <span className="font-black text-emerald-200">{formatListingPrice(listing.price)}</span>
                                                <span className="text-slate-500">|</span>
                                                <span>{listing.location?.city || t('listingDetail.marketplace', {}, 'Marketplace')}</span>
                                                <span className="text-slate-500">|</span>
                                                <span>{listing.condition}</span>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="mt-3 flex flex-wrap gap-2">
                                        {seller?.isVerified ? (
                                            <span className="rounded-full border border-emerald-300/20 bg-emerald-500/10 px-3 py-1 text-[11px] font-bold text-emerald-100">
                                                {t('listingDetail.badge.verifiedSellerText', {}, 'Verified seller')}
                                            </span>
                                        ) : null}
                                        {listing?.negotiable ? (
                                            <span className="rounded-full border border-cyan-300/20 bg-cyan-500/10 px-3 py-1 text-[11px] font-bold text-cyan-100">
                                                {t('listingDetail.badge.negotiablePricing', {}, 'Negotiable pricing')}
                                            </span>
                                        ) : null}
                                        {escrowEnabled ? (
                                            <span className="rounded-full border border-blue-300/20 bg-blue-500/10 px-3 py-1 text-[11px] font-bold text-blue-100">
                                                {t('listingDetail.badge.escrowReady', {}, 'Escrow ready')}
                                            </span>
                                        ) : null}
                                        {showLiveInspectionAction ? (
                                            <span className="rounded-full border border-violet-300/20 bg-violet-500/10 px-3 py-1 text-[11px] font-bold text-violet-100">
                                                {canJoinLiveInspection || isListingCallActive ? listingLiveCallTitle : t('listingDetail.badge.voiceVideo', {}, 'Voice + video calls')}
                                            </span>
                                        ) : null}
                                    </div>
                                </div>
                            </div>

                            <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
                                {chatLoading ? (
                                    <div className="flex h-full items-center justify-center">
                                        <div className="h-10 w-10 animate-spin rounded-full border-2 border-cyan-300/60 border-t-transparent" />
                                    </div>
                                ) : translatedChatTimeline.length === 0 ? (
                                    <div className="mx-auto flex max-w-xl flex-col items-center justify-center rounded-[2rem] border border-white/8 bg-white/[0.03] px-6 py-10 text-center shadow-[0_24px_60px_rgba(2,8,23,0.18)]">
                                        <div className="support-chat-avatar h-16 w-16 border border-cyan-300/20 bg-cyan-500/10 text-cyan-100">
                                            <MessageCircle className="h-7 w-7" />
                                        </div>
                                        <p className="mt-5 text-[11px] font-black uppercase tracking-[0.28em] text-cyan-200">{t('listingDetail.chat.start', {}, 'Start the conversation')}</p>
                                        <h4 className="mt-3 text-3xl font-black text-white">{t('listingDetail.chat.threadTitle', {}, 'This listing now has a real thread')}</h4>
                                        <p className="mt-3 max-w-lg text-sm leading-6 text-slate-400">
                                            {t('listingDetail.chat.threadBody', {}, 'Negotiate, ask for proof, lock an offer, and move to live inspection without leaving Aura.')}
                                        </p>
                                        <div className="mt-6 flex flex-wrap justify-center gap-2">
                                            {quickReplies.map((reply) => (
                                                <button
                                                    key={reply}
                                                    type="button"
                                                    onClick={() => setChatInput(reply)}
                                                    className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-cyan-300/30 hover:text-cyan-100"
                                                >
                                                    {reply}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="space-y-1">
                                        {translatedChatTimeline.map((entry) => (
                                            <div
                                                key={entry.key}
                                                className={entry.groupedWithPrevious ? 'mt-2' : 'mt-5'}
                                            >
                                                {entry.showDatePill ? (
                                                    <div className="mb-5 flex justify-center">
                                                        <span className="support-chat-date-pill border border-white/8 bg-white/[0.04] px-4 py-2 text-[11px] font-black uppercase tracking-[0.2em] text-slate-300">
                                                            {entry.dateLabel}
                                                        </span>
                                                    </div>
                                                ) : null}

                                                <div className={`flex ${entry.isMine ? 'justify-end' : 'justify-start'}`}>
                                                    <div className={`max-w-[90%] ${entry.isMine ? 'items-end' : 'items-start'} flex flex-col`}>
                                                        {!entry.isMine && !entry.groupedWithPrevious ? (
                                                            <span className="mb-1.5 px-1 text-[11px] font-black uppercase tracking-[0.18em] text-emerald-200/80">
                                                                {counterpartName}
                                                            </span>
                                                        ) : null}

                                                        <div
                                                            className={`support-chat-bubble ${
                                                                entry.isMine ? 'support-chat-bubble-self' : 'support-chat-bubble-peer'
                                                            } ${
                                                                entry.groupedWithPrevious
                                                                    ? (entry.isMine ? 'rounded-tr-md' : 'rounded-tl-md')
                                                                    : ''
                                                            } ${
                                                                entry.groupedWithNext
                                                                    ? `${entry.isMine ? 'rounded-br-md after:hidden' : 'rounded-bl-md before:hidden'}`
                                                                    : ''
                                                            }`}
                                                        >
                                                            {entry.isOffer ? (
                                                                <span className={`mb-2 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em] ${
                                                                    entry.isMine
                                                                        ? 'bg-white/15 text-white'
                                                                        : 'bg-emerald-500/15 text-emerald-200'
                                                                }`}>
                                                                    <TicketPercent className="h-3 w-3" />
                                                                    {t('listingDetail.offer.badge', {}, 'Offer')}
                                                                </span>
                                                            ) : null}

                                                            <p className="whitespace-pre-wrap break-words text-[15px] leading-6">
                                                                {entry.translatedText}
                                                            </p>

                                                            <div className={`mt-2 flex items-center justify-end gap-1.5 text-[11px] ${
                                                                entry.isMine ? 'text-white/70' : 'text-slate-400'
                                                            }`}>
                                                                <span>{formatMessageTime(entry.message?.sentAt || entry.message?.createdAt)}</span>
                                                                {entry.isMine ? (
                                                                    <CheckCheck className={`h-3.5 w-3.5 ${
                                                                        entry.message?.readAt ? 'text-cyan-100' : 'text-white/45'
                                                                    }`} />
                                                                ) : null}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                        <div ref={chatMessagesEndRef} />
                                    </div>
                                )}
                            </div>

                            {chatError ? (
                                <div className="border-t border-rose-300/20 bg-rose-500/10 px-4 py-3 text-xs font-semibold text-rose-100 sm:px-6">
                                    {translateListingText(chatError) || chatError}
                                </div>
                            ) : null}

                            {showOffer ? (
                                <div className="border-t border-white/8 px-4 py-4 sm:px-6">
                                    <div className="rounded-[1.6rem] border border-cyan-300/18 bg-cyan-500/8 p-4">
                                        <div className="flex flex-wrap items-start justify-between gap-3">
                                            <div>
                                                <p className="text-[11px] font-black uppercase tracking-[0.22em] text-cyan-200">{t('listingDetail.offer.builder', {}, 'Offer builder')}</p>
                                                <p className="mt-2 text-lg font-bold text-white">{t('listingDetail.offer.title', {}, 'Send a price proposal inside the chat')}</p>
                                                <p className="mt-1 text-sm text-slate-400">
                                                    {t('listingDetail.offer.body', {}, 'The seller receives this as a normal message, so your negotiation stays in one thread.')}
                                                </p>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => setShowOffer(false)}
                                                className="rounded-full border border-white/10 px-3 py-1.5 text-xs font-bold text-slate-300 transition hover:border-cyan-300/25 hover:text-cyan-100"
                                            >
                                                {t('listingDetail.offer.close', {}, 'Close offer')}
                                            </button>
                                        </div>

                                        <div className="mt-4 flex flex-wrap gap-2">
                                            {offerSuggestions.map((suggestedValue) => (
                                                <button
                                                    key={suggestedValue}
                                                    type="button"
                                                    onClick={() => setOfferPrice(String(suggestedValue))}
                                                    className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-sm font-semibold text-slate-200 transition hover:border-cyan-300/25 hover:text-cyan-100"
                                                >
                                                    {formatListingPrice(suggestedValue)}
                                                </button>
                                            ))}
                                        </div>

                                        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                                            <input
                                                type="number"
                                                value={offerPrice}
                                                onChange={(event) => setOfferPrice(event.target.value)}
                                                placeholder={t('listingDetail.offer.placeholder', { amount: formatListingPrice(Math.max(1, Math.round(Number(listing.price || 0) * 0.9))) }, 'Example: {{amount}}')}
                                                className="support-chat-input h-12 px-4 text-sm text-white"
                                            />
                                            <button
                                                type="button"
                                                onClick={handleSendOffer}
                                                disabled={chatSending || !String(offerPrice || '').trim()}
                                                className="support-chat-send h-12 rounded-full bg-gradient-to-r from-cyan-500 to-emerald-500 px-5 text-sm font-black text-slate-950 shadow-[0_18px_36px_rgba(16,185,129,0.22)] transition hover:shadow-[0_22px_42px_rgba(16,185,129,0.28)]"
                                            >
                                                {t('listingDetail.offer.send', {}, 'Send offer')}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ) : null}

                            <div className="support-chat-composer px-4 py-4 sm:px-6">
                                <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
                                    {quickReplies.map((reply) => (
                                        <button
                                            key={reply}
                                            type="button"
                                            onClick={() => setChatInput(reply)}
                                            className="whitespace-nowrap rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-cyan-300/25 hover:text-cyan-100"
                                        >
                                            {reply}
                                        </button>
                                    ))}
                                </div>

                                <form onSubmit={handleSendMessage} className="flex items-end gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setShowOffer((previous) => !previous)}
                                        className="support-chat-utility h-11 w-11 bg-white/[0.06] text-cyan-100"
                                        title={t('listingDetail.offer.create', {}, 'Create offer')}
                                    >
                                        <Sparkles className="h-4 w-4" />
                                    </button>
                                    <textarea
                                        ref={chatInputRef}
                                        value={chatInput}
                                        onChange={(event) => setChatInput(event.target.value)}
                                        onKeyDown={(event) => {
                                            if (event.key === 'Enter' && !event.shiftKey) {
                                                event.preventDefault();
                                                if (!chatSending && String(chatInput || '').trim()) {
                                                    void handleSendMessage();
                                                }
                                            }
                                        }}
                                        rows={1}
                                        maxLength={MARKETPLACE_CHAT_MAX_LENGTH}
                                        placeholder={t('listingDetail.chat.placeholder', {}, 'Write a message, ask for proof, or negotiate the final price')}
                                        className="support-chat-input min-h-[3.25rem] max-h-40 resize-none overflow-y-auto px-4 py-3 text-sm leading-6 text-white"
                                    />
                                    <button
                                        type="submit"
                                        disabled={chatSending || !String(chatInput || '').trim()}
                                        className="support-chat-send h-12 w-12 bg-gradient-to-r from-emerald-400 to-cyan-400 text-slate-950 shadow-[0_18px_36px_rgba(16,185,129,0.22)]"
                                    >
                                        {chatSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                                    </button>
                                </form>
                                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] font-semibold text-slate-400">
                                    <div className="flex items-center gap-2">
                                        {isConnected ? <Wifi className="h-3.5 w-3.5 text-emerald-200" /> : <WifiOff className="h-3.5 w-3.5 text-amber-200" />}
                                        <span>{chatConnectionCopy}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span>{t('listingDetail.chat.enterSends', {}, 'Enter sends')}</span>
                                        <span className="text-slate-600">|</span>
                                        <span>{t('listingDetail.chat.shiftEnter', {}, 'Shift+Enter adds a new line')}</span>
                                        <span className="text-slate-600">|</span>
                                        <span>{chatCharacterCount}/{MARKETPLACE_CHAT_MAX_LENGTH}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            <OtpChallengeModal
                open={escrowOtpModal.open}
                loading={escrowOtpModal.loading}
                error={escrowOtpModal.error}
                onSubmit={handleEscrowOtpSubmit}
                onClose={handleEscrowOtpClose}
            />
        </div>
    );
}
