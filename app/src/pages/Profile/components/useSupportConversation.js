import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supportApi } from '@/services/api';
import { useSocket, useSocketDemand } from '@/context/SocketContext';
import { useVideoCall } from '@/context/VideoCallContext';
import { useMarket } from '@/context/MarketContext';
import { useSpeechInput } from '@/hooks/useSpeechInput';
import { useStableIcuMessages } from '@/i18n/useStableIcuMessages';
import {
    ACTIVE_TICKET_POLL_MS,
    TICKET_LIST_POLL_MS,
    SUPPORT_MESSAGE_MAX_LENGTH,
    normalizeLiveCallMode,
    getLiveCallModeLabel,
    getLiveCallModeTitle,
    buildCategoryOptions,
    createInitialForm,
    sortTickets,
    normalizeTicket,
    upsertTicket,
    appendUniqueMessage,
    buildMessagesSignature,
    isNearBottom,
    isPrefillMeaningful,
} from './supportHelpers';

export function useSupportConversation({
    focusTicketId = '',
    startCompose = false,
    prefill = {},
}) {
    useSocketDemand('profile-support', true);
    const { t: legacyT } = useMarket();
    const t = useStableIcuMessages(legacyT);
    const { socket, isConnected, connectionState } = useSocket();
    const { callStatus, activeCallContext, joinSupportCall } = useVideoCall();
    const categoryOptions = useMemo(() => buildCategoryOptions(t), [t]);
    const categoryMap = useMemo(() => new Map(categoryOptions.map((option) => [option.value, option])), [categoryOptions]);

    const [tickets, setTickets] = useState([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [activeTicketId, setActiveTicketId] = useState(null);
    const [messages, setMessages] = useState([]);
    const [messagesLoading, setMessagesLoading] = useState(false);
    const [form, setForm] = useState(() => createInitialForm(prefill, categoryMap));
    const [newMessage, setNewMessage] = useState('');
    const [sending, setSending] = useState(false);
    const [creatingTicket, setCreatingTicket] = useState(false);
    const [requestingLiveCall, setRequestingLiveCall] = useState(false);
    const [error, setError] = useState('');

    const messagesEndRef = useRef(null);
    const messagesContainerRef = useRef(null);
    const composerRef = useRef(null);
    const shouldStickToBottomRef = useRef(true);
    const pendingScrollBehaviorRef = useRef('auto');
    const messageSignatureRef = useRef('');
    const launchRef = useRef('');
    const activeComposerValue = creating ? form.message : newMessage;
    const handleSupportComposerChange = useCallback((nextValue) => {
        if (creating) {
            setForm((previous) => ({ ...previous, message: nextValue }));
            return;
        }

        setNewMessage(nextValue);
    }, [creating]);
    const {
        isListening: isVoiceDrafting,
        supportsSpeechInput,
        stopListening: stopVoiceDrafting,
        toggleListening: toggleVoiceDrafting,
    } = useSpeechInput({
        value: activeComposerValue,
        onChange: handleSupportComposerChange,
        clearOnStart: false,
        lang: 'en-IN',
    });

    const handleMessagesScroll = () => {
        shouldStickToBottomRef.current = isNearBottom(messagesContainerRef.current);
    };

    const supportLaunchSignature = useMemo(() => JSON.stringify({
        focusTicketId: String(focusTicketId || ''),
        startCompose: Boolean(startCompose),
        prefill: {
            category: String(prefill?.category || ''),
            relatedActionId: String(prefill?.relatedActionId || ''),
            subject: String(prefill?.subject || ''),
            intent: String(prefill?.intent || ''),
        },
    }), [focusTicketId, prefill?.category, prefill?.intent, prefill?.relatedActionId, prefill?.subject, startCompose]);

    const fetchTickets = useCallback(async ({ silent = false } = {}) => {
        try {
            if (!silent) {
                setLoading(true);
            }

            const res = await supportApi.getTickets({ limit: 50 });
            const nextTickets = sortTickets(Array.isArray(res?.data) ? res.data.map(normalizeTicket) : []);
            setTickets(nextTickets);
            setError('');

            setActiveTicketId((previous) => {
                const requested = String(focusTicketId || '');
                if (requested && nextTickets.some((ticket) => String(ticket._id) === requested)) {
                    return requested;
                }
                if (previous && nextTickets.some((ticket) => String(ticket._id) === String(previous))) {
                    return previous;
                }
                if (creating || startCompose || isPrefillMeaningful(prefill)) {
                    return null;
                }
                return previous || nextTickets[0]?._id || null;
            });
        } catch (err) {
            setError(err.message || t('profile.support.error.loadTickets', {}, 'Failed to load support tickets'));
        } finally {
            if (!silent) {
                setLoading(false);
            }
        }
    }, [creating, focusTicketId, prefill, startCompose]);

    const fetchMessages = useCallback(async (ticketId, { silent = false } = {}) => {
        if (!ticketId) {
            setMessages([]);
            return;
        }

        try {
            if (!silent) {
                setMessagesLoading(true);
            }

            const res = await supportApi.getMessages(ticketId);
            setMessages(Array.isArray(res?.data) ? res.data : []);
            setTickets((previous) => previous.map((ticket) => (
                String(ticket._id) === String(ticketId)
                    ? { ...ticket, unreadByUser: 0 }
                    : ticket
            )));
            setError('');
        } catch (err) {
            setError(err.message || t('profile.support.error.loadConversation', {}, 'Failed to load support conversation'));
        } finally {
            if (!silent) {
                setMessagesLoading(false);
            }
        }
    }, []);

    useEffect(() => {
        fetchTickets();
    }, [fetchTickets]);

    useEffect(() => {
        if (!activeTicketId) {
            messageSignatureRef.current = '';
            pendingScrollBehaviorRef.current = '';
            setMessages([]);
            return;
        }

        shouldStickToBottomRef.current = true;
        pendingScrollBehaviorRef.current = 'auto';
        fetchMessages(activeTicketId);
    }, [activeTicketId, fetchMessages]);

    useEffect(() => {
        const nextSignature = buildMessagesSignature(messages);
        const signatureChanged = nextSignature !== messageSignatureRef.current;
        const requestedBehavior = pendingScrollBehaviorRef.current;

        if (!signatureChanged && !requestedBehavior) {
            return;
        }

        messageSignatureRef.current = nextSignature;

        if (!requestedBehavior && !shouldStickToBottomRef.current) {
            return;
        }

        pendingScrollBehaviorRef.current = '';
        messagesEndRef.current?.scrollIntoView({
            behavior: requestedBehavior || 'auto',
            block: 'end',
        });
    }, [messages]);

    useEffect(() => {
        const composer = composerRef.current;
        if (!composer) return;

        composer.style.height = '0px';
        const nextHeight = Math.min(Math.max(composer.scrollHeight, 56), 180);
        composer.style.height = `${nextHeight}px`;
    }, [activeTicketId, newMessage]);

    useEffect(() => {
        if (!activeTicketId || creating) return undefined;

        const focusTimer = window.setTimeout(() => {
            composerRef.current?.focus();
        }, 120);

        return () => window.clearTimeout(focusTimer);
    }, [activeTicketId, creating]);

    useEffect(() => {
        if (launchRef.current === supportLaunchSignature) return;
        launchRef.current = supportLaunchSignature;

        setForm(createInitialForm(prefill, categoryMap));

        if (focusTicketId) {
            setCreating(false);
            setActiveTicketId(focusTicketId);
            return;
        }

        if (startCompose || isPrefillMeaningful(prefill)) {
            setCreating(true);
            setActiveTicketId(null);
        }
    }, [categoryMap, focusTicketId, prefill, startCompose, supportLaunchSignature]);

    useEffect(() => {
        if (isConnected) return undefined;

        const ticketTimer = window.setInterval(() => {
            if (typeof document !== 'undefined' && document.hidden) return;
            fetchTickets({ silent: true });
        }, TICKET_LIST_POLL_MS);

        return () => window.clearInterval(ticketTimer);
    }, [fetchTickets, isConnected]);

    useEffect(() => {
        if (isConnected || !activeTicketId) return undefined;

        const messageTimer = window.setInterval(() => {
            if (typeof document !== 'undefined' && document.hidden) return;
            fetchMessages(activeTicketId, { silent: true });
        }, ACTIVE_TICKET_POLL_MS);

        return () => window.clearInterval(messageTimer);
    }, [activeTicketId, fetchMessages, isConnected]);

    useEffect(() => {
        if (!socket) return undefined;

        const handleTicketUpdate = (payload = {}) => {
            const nextTicket = normalizeTicket(payload.ticket);
            if (!nextTicket?._id) return;

            setTickets((previous) => upsertTicket(previous, nextTicket));
        };

        const handleMessageNew = (payload = {}) => {
            const ticketId = String(payload.ticketId || payload.ticket?._id || '');
            if (!ticketId) return;

            if (payload.ticket) {
                setTickets((previous) => upsertTicket(previous, payload.ticket));
            } else {
                setTickets((previous) => previous.map((ticket) => (
                    String(ticket._id) === ticketId
                        ? {
                            ...ticket,
                            lastMessagePreview: String(payload?.message?.text || ticket.lastMessagePreview || ''),
                            lastMessageAt: payload?.message?.sentAt || payload?.message?.createdAt || new Date().toISOString(),
                            unreadByUser: String(ticketId) === String(activeTicketId) ? 0 : (Number(ticket.unreadByUser || 0) + 1),
                        }
                        : ticket
                )));
            }

            void fetchTickets({ silent: true });

            if (String(ticketId) !== String(activeTicketId || '')) return;
            setMessages((previous) => appendUniqueMessage(previous, payload.message));
            void fetchMessages(ticketId, { silent: true });
        };

        socket.on('support:ticket:update', handleTicketUpdate);
        socket.on('support:message:new', handleMessageNew);

        return () => {
            socket.off('support:ticket:update', handleTicketUpdate);
            socket.off('support:message:new', handleMessageNew);
        };
    }, [activeTicketId, fetchMessages, fetchTickets, socket]);

    const handleCreateTicket = async (event) => {
        event.preventDefault();
        if (creatingTicket) return;

        if (isVoiceDrafting) {
            stopVoiceDrafting();
        }

        const payload = {
            subject: String(form.subject || '').trim(),
            category: form.category,
            message: String(form.message || '').trim(),
        };

        if (prefill?.relatedActionId) {
            payload.relatedActionId = String(prefill.relatedActionId);
        }

        try {
            setCreatingTicket(true);
            const res = await supportApi.createTicket(payload);
            const createdTicket = normalizeTicket(res?.data);
            if (createdTicket) {
                setTickets((previous) => upsertTicket(previous, createdTicket));
                setActiveTicketId(createdTicket._id);
                setCreating(false);
                setForm(createInitialForm({}, categoryMap));
                await fetchMessages(createdTicket._id);
            }
            setError('');
        } catch (err) {
            setError(err.message || t('profile.support.error.createTicket', {}, 'Failed to create support ticket'));
        } finally {
            setCreatingTicket(false);
        }
    };

    const handleSendMessage = async (event) => {
        event.preventDefault();
        if (!newMessage.trim() || sending || !activeTicketId) return;

        if (isVoiceDrafting) {
            stopVoiceDrafting();
        }

        const tempText = newMessage;
        const pendingId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        setNewMessage('');
        // Optimistic echo: the bubble appears instantly with a sending state
        // and is replaced by the server-confirmed message when the round trip
        // completes (or removed, restoring the draft, if the send fails).
        setMessages((previous) => [
            ...previous,
            {
                _id: pendingId,
                text: tempText,
                isAdmin: false,
                isSystem: false,
                isPending: true,
                sentAt: new Date().toISOString(),
            },
        ]);
        shouldStickToBottomRef.current = true;
        pendingScrollBehaviorRef.current = 'smooth';

        try {
            setSending(true);
            const res = await supportApi.sendMessage(activeTicketId, tempText);
            const nextMessage = res?.data;
            shouldStickToBottomRef.current = true;
            pendingScrollBehaviorRef.current = 'smooth';
            setMessages((previous) => appendUniqueMessage(
                previous.filter((message) => message?._id !== pendingId),
                nextMessage,
            ));
            setTickets((previous) => previous.map((ticket) => (
                String(ticket._id) === String(activeTicketId)
                    ? {
                        ...ticket,
                        lastMessagePreview: String(tempText).slice(0, 150),
                        lastMessageAt: nextMessage?.sentAt || nextMessage?.createdAt || new Date().toISOString(),
                        lastActorRole: 'user',
                        unreadByUser: 0,
                        userActionRequired: false,
                    }
                    : ticket
            )));
            setError('');
        } catch (err) {
            setMessages((previous) => previous.filter((message) => message?._id !== pendingId));
            shouldStickToBottomRef.current = true;
            pendingScrollBehaviorRef.current = 'smooth';
            setError(err.message || t('profile.support.error.sendReply', {}, 'Failed to send support reply'));
            setNewMessage(tempText);
        } finally {
            setSending(false);
        }
    };

    const handleRequestLiveCall = async (mediaMode = 'video') => {
        if (!activeTicketId || requestingLiveCall) return;

        try {
            setRequestingLiveCall(true);
            const res = await supportApi.requestVideoCall(activeTicketId, {
                mediaMode: normalizeLiveCallMode(mediaMode),
            });
            const updatedTicket = normalizeTicket(res?.data);
            if (updatedTicket?._id) {
                setTickets((previous) => upsertTicket(previous, updatedTicket));
            }
            await fetchMessages(activeTicketId, { silent: true });
            setError('');
        } catch (err) {
            setError(err.message || t('profile.support.error.liveCallRequest', {}, 'Failed to request a live support call'));
        } finally {
            setRequestingLiveCall(false);
        }
    };

    const activeTicket = tickets.find((ticket) => String(ticket._id) === String(activeTicketId));
    const isSocketReconnecting = connectionState === 'connecting' || connectionState === 'reconnecting';
    const socketStatusLabel = connectionState === 'connected'
        ? t('profile.support.socket.live', {}, 'Live')
        : isSocketReconnecting
            ? t('profile.support.socket.reconnecting', {}, 'Reconnecting...')
            : t('profile.support.socket.polling', {}, 'Polling');
    const activeCategory = categoryMap.get(activeTicket?.category || form.category || 'general_support');
    const isActiveSupportCall = activeCallContext?.channelType === 'support_ticket'
        && String(activeCallContext?.contextId || '') === String(activeTicketId || '')
        && ['calling', 'incoming', 'connected'].includes(callStatus);
    const supportLiveCallMode = normalizeLiveCallMode(
        activeCallContext?.mediaMode
        || activeTicket?.liveCallLastMediaMode
        || activeTicket?.liveCallRequestedMode
    );
    const supportLiveCallLabel = getLiveCallModeLabel(supportLiveCallMode, t);
    const supportLiveCallTitle = getLiveCallModeTitle(supportLiveCallMode, t);
    const canJoinSupportCall = Boolean(
        activeTicket?._id
        && activeTicket.liveCallLastSessionKey
        && ['ringing', 'connected'].includes(String(activeTicket.liveCallLastStatus || ''))
        && !isActiveSupportCall
    );

    const handleLiveCallAction = async (mediaMode = 'video') => {
        if (!activeTicketId || requestingLiveCall) return;

        if (canJoinSupportCall) {
            try {
                setRequestingLiveCall(true);
                const joined = await joinSupportCall({
                    channelType: 'support_ticket',
                    contextId: activeTicketId,
                    supportTicketId: activeTicketId,
                    contextLabel: activeTicket?.liveCallLastContextLabel || t('profile.support.call.contextLabel', { subject: activeTicket?.subject || t('profile.support.ticketFallback', {}, 'support ticket') }, `Aura Support live call for "${activeTicket?.subject || 'support ticket'}"`),
                    sessionKey: activeTicket?.liveCallLastSessionKey,
                    callerName: t('profile.support.callerName', {}, 'Aura Support'),
                    mediaMode: supportLiveCallMode,
                });
                if (!joined) {
                    setError(t('profile.support.error.joinCall', { label: supportLiveCallLabel }, `Failed to join the ${supportLiveCallLabel}`));
                } else {
                    setError('');
                }
            } finally {
                setRequestingLiveCall(false);
            }
            return;
        }

        await handleRequestLiveCall(mediaMode);
    };

    const liveCallActionDisabled = Boolean(
        requestingLiveCall
        || activeTicket?.status === 'closed'
        || isActiveSupportCall
        || (!canJoinSupportCall && activeTicket?.liveCallRequested)
    );
    const liveCallActionLabel = isActiveSupportCall
        ? t('profile.support.call.liveNow', {}, 'Live now')
        : canJoinSupportCall
            ? t('profile.support.call.join', { label: supportLiveCallLabel }, `Join ${supportLiveCallLabel}`)
            : activeTicket?.liveCallRequested
                ? t('profile.support.call.requested', {}, 'Requested')
                : t('profile.support.call.request', { label: supportLiveCallLabel }, `Request ${supportLiveCallLabel}`);
    const liveCallComposerLabel = isActiveSupportCall
        ? t('profile.support.call.active', { title: supportLiveCallTitle }, `${supportLiveCallTitle} Active`)
        : canJoinSupportCall
            ? t('profile.support.call.join', { label: supportLiveCallLabel }, `Join ${supportLiveCallLabel}`)
            : activeTicket?.liveCallRequested
                ? t('profile.support.call.queued', { title: supportLiveCallTitle }, `${supportLiveCallTitle} queued`)
                : t('profile.support.call.escalate', { label: supportLiveCallLabel }, `Escalate to ${supportLiveCallLabel}`);
    const supportComposerConnectionCopy = connectionState === 'connected'
        ? t('profile.support.connection.live', {}, 'Realtime is connected for this thread.')
        : isSocketReconnecting
            ? t('profile.support.connection.reconnecting', {}, 'Realtime is reconnecting for this thread.')
            : t('profile.support.connection.polling', { seconds: Math.round(ACTIVE_TICKET_POLL_MS / 1000) }, `Realtime is on polling fallback. Aura refreshes this chat every ${Math.round(ACTIVE_TICKET_POLL_MS / 1000)} seconds.`);
    const supportCharacterCount = String(newMessage || '').length;
    const liveCallStatusCopy = isActiveSupportCall
        ? t('profile.support.call.status.active', { label: supportLiveCallLabel }, `Aura Support is already ringing or connected on this ${supportLiveCallLabel}.`)
        : activeTicket?.liveCallRequested
            ? t('profile.support.call.status.queued', { label: supportLiveCallLabel }, `Your ${supportLiveCallLabel} request is queued for the support team.`)
            : canJoinSupportCall
                ? t('profile.support.call.status.joinable', { label: supportLiveCallLabel }, `Aura Support already opened a ${supportLiveCallLabel} for this ticket. Join it from here.`)
                : activeTicket?.liveCallLastStatus === 'ended' || activeTicket?.liveCallLastStatus === 'missed'
                    ? t('profile.support.call.status.ended', { label: supportLiveCallLabel }, `The last ${supportLiveCallLabel} finished. Request another one if text support is still not enough.`)
                    : t('profile.support.call.status.default', {}, 'Move this thread into a real-time voice or video call when typing is too slow.');
    const liveCallStatusTime = activeTicket?.liveCallRequestedAt
        ? t('profile.support.call.requestedAt', { time: new Date(activeTicket.liveCallRequestedAt).toLocaleString() }, `Requested ${new Date(activeTicket.liveCallRequestedAt).toLocaleString()}`)
        : activeTicket?.liveCallEndedAt
            ? t('profile.support.call.lastCallAt', { time: new Date(activeTicket.liveCallEndedAt).toLocaleString() }, `Last call ${new Date(activeTicket.liveCallEndedAt).toLocaleString()}`)
            : '';

    return {
        t,
        socket,
        isConnected,
        connectionState,
        callStatus,
        activeCallContext,
        categoryOptions,
        categoryMap,
        tickets,
        loading,
        creating,
        setCreating,
        activeTicketId,
        setActiveTicketId,
        messages,
        messagesLoading,
        form,
        setForm,
        newMessage,
        sending,
        creatingTicket,
        requestingLiveCall,
        error,
        messagesEndRef,
        messagesContainerRef,
        composerRef,
        handleMessagesScroll,
        handleSupportComposerChange,
        isVoiceDrafting,
        supportsSpeechInput,
        stopVoiceDrafting,
        toggleVoiceDrafting,
        fetchTickets,
        fetchMessages,
        handleCreateTicket,
        handleSendMessage,
        handleRequestLiveCall,
        handleLiveCallAction,
        activeTicket,
        isSocketReconnecting,
        socketStatusLabel,
        activeCategory,
        isActiveSupportCall,
        supportLiveCallMode,
        supportLiveCallLabel,
        supportLiveCallTitle,
        canJoinSupportCall,
        liveCallActionDisabled,
        liveCallActionLabel,
        liveCallComposerLabel,
        supportComposerConnectionCopy,
        supportCharacterCount,
        liveCallStatusCopy,
        liveCallStatusTime,
        supportMessageMaxLength: SUPPORT_MESSAGE_MAX_LENGTH,
    };
}
