import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { useSocketDemand } from './SocketContext';
import VideoCallOverlay from '../components/features/video/VideoCallOverlay';
import { RTC_PEER_CONFIG } from '../config/rtcConfig';

const VideoCallContext = createContext(null);

export const useVideoCall = () => useContext(VideoCallContext);

const normalizeCallRequest = (targetOrRequest, listingId) => {
    if (targetOrRequest && typeof targetOrRequest === 'object') {
        const channelType = targetOrRequest.channelType === 'support_ticket' ? 'support_ticket' : 'listing';
        const contextId = String(
            targetOrRequest.contextId
            || targetOrRequest.supportTicketId
            || targetOrRequest.listingId
            || listingId
            || ''
        );

        return {
            targetUserId: String(targetOrRequest.targetUserId || targetOrRequest.toUserId || '').trim(),
            listingId: channelType === 'listing'
                ? String(targetOrRequest.listingId || targetOrRequest.contextId || listingId || '').trim()
                : '',
            supportTicketId: channelType === 'support_ticket'
                ? String(targetOrRequest.supportTicketId || targetOrRequest.contextId || '').trim()
                : '',
            channelType,
            contextId,
            contextLabel: String(targetOrRequest.contextLabel || targetOrRequest.title || '').trim(),
        };
    }

    return {
        targetUserId: String(targetOrRequest || '').trim(),
        listingId: String(listingId || '').trim(),
        supportTicketId: '',
        channelType: 'listing',
        contextId: String(listingId || '').trim(),
        contextLabel: '',
    };
};

export const VideoCallProvider = ({ children }) => {
    const { currentUser } = useAuth();
    const socketContext = useSocketDemand('video-calls-global', Boolean(currentUser));
    const { socket } = socketContext || {};

    const [activeCallContext, setActiveCallContext] = useState(null);
    const [localStream, setLocalStream] = useState(null);
    const [remoteStream, setRemoteStream] = useState(null);
    const [callStatus, setCallStatus] = useState('idle'); // idle, calling, incoming, connected
    const [callerInfo, setCallerInfo] = useState(null);
    const [callError, setCallError] = useState('');

    const peerConnection = useRef(null);
    const targetUserId = useRef(null);
    const callContextRef = useRef(null);

    const cleanup = () => {
        if (peerConnection.current) {
            peerConnection.current.close();
            peerConnection.current = null;
        }
        if (localStream) {
            localStream.getTracks().forEach((track) => track.stop());
            setLocalStream(null);
        }
        setRemoteStream(null);
        setCallStatus('idle');
        setCallerInfo(null);
        setActiveCallContext(null);
        targetUserId.current = null;
        callContextRef.current = null;
    };

    const initializePeerConnection = () => {
        const pc = new RTCPeerConnection(RTC_PEER_CONFIG);

        pc.onicecandidate = (event) => {
            if (!event.candidate || !socket || !targetUserId.current || !callContextRef.current) {
                return;
            }

            socket.emit('video:call:signal', {
                targetUserId: targetUserId.current,
                listingId: callContextRef.current.listingId,
                supportTicketId: callContextRef.current.supportTicketId,
                channelType: callContextRef.current.channelType,
                contextId: callContextRef.current.contextId,
                signalData: { type: 'ice-candidate', candidate: event.candidate },
            });
        };

        pc.ontrack = (event) => {
            setRemoteStream(event.streams[0]);
        };

        pc.onconnectionstatechange = () => {
            if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
                cleanup();
            }
        };

        peerConnection.current = pc;
        return pc;
    };

    const startCall = async (targetOrRequest, listingId) => {
        const request = normalizeCallRequest(targetOrRequest, listingId);
        if (!request.targetUserId || !request.contextId) {
            setCallError('Live call target is missing required context.');
            return false;
        }

        try {
            setCallError('');
            setActiveCallContext(request);
            callContextRef.current = request;

            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            setLocalStream(stream);
            setCallStatus('calling');
            targetUserId.current = request.targetUserId;

            const pc = initializePeerConnection();
            stream.getTracks().forEach((track) => pc.addTrack(track, stream));

            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            socket.emit('video:call:initiate', {
                targetUserId: request.targetUserId,
                listingId: request.listingId,
                supportTicketId: request.supportTicketId,
                channelType: request.channelType,
                contextId: request.contextId,
                signalData: { type: 'offer', sdp: offer.sdp },
            });

            return true;
        } catch (error) {
            console.error('WebRTC: Failed to start call', error);
            setCallError(error?.message || 'Failed to start live call');
            cleanup();
            return false;
        }
    };

    const answerCall = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            setLocalStream(stream);

            const pc = peerConnection.current;
            if (!pc || !callContextRef.current) return false;

            stream.getTracks().forEach((track) => pc.addTrack(track, stream));

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            socket.emit('video:call:signal', {
                targetUserId: targetUserId.current,
                listingId: callContextRef.current.listingId,
                supportTicketId: callContextRef.current.supportTicketId,
                channelType: callContextRef.current.channelType,
                contextId: callContextRef.current.contextId,
                signalData: { type: 'answer', sdp: answer.sdp },
            });

            setCallStatus('connected');
            setCallError('');
            return true;
        } catch (error) {
            console.error('WebRTC: Failed to answer call', error);
            setCallError(error?.message || 'Failed to answer live call');
            cleanup();
            return false;
        }
    };

    const hangUp = () => {
        if (socket && targetUserId.current && callContextRef.current) {
            socket.emit('video:call:hangup', {
                targetUserId: targetUserId.current,
                listingId: callContextRef.current.listingId,
                supportTicketId: callContextRef.current.supportTicketId,
                channelType: callContextRef.current.channelType,
                contextId: callContextRef.current.contextId,
            });
        }
        cleanup();
    };

    useEffect(() => {
        if (!socket) return undefined;

        const handleIncoming = async (payload) => {
            const nextContext = {
                channelType: payload.channelType === 'support_ticket' ? 'support_ticket' : 'listing',
                contextId: String(payload.contextId || payload.listingId || payload.supportTicketId || ''),
                listingId: String(payload.listingId || ''),
                supportTicketId: String(payload.supportTicketId || ''),
                contextLabel: String(payload.contextLabel || '').trim(),
            };

            setCallerInfo({ userId: payload.fromUserId, name: payload.fromName });
            targetUserId.current = payload.fromUserId;
            setActiveCallContext(nextContext);
            callContextRef.current = nextContext;
            setCallStatus('incoming');
            setCallError('');

            if (payload.signalData?.type === 'offer') {
                const pc = initializePeerConnection();
                await pc.setRemoteDescription(new RTCSessionDescription({
                    type: 'offer',
                    sdp: payload.signalData.sdp,
                }));
            }
        };

        const handleSignal = async (payload) => {
            const { signalData } = payload || {};
            const pc = peerConnection.current;
            if (!pc || !signalData) return;

            if (signalData.type === 'answer') {
                await pc.setRemoteDescription(new RTCSessionDescription({
                    type: 'answer',
                    sdp: signalData.sdp,
                }));
                setCallStatus('connected');
            } else if (signalData.type === 'ice-candidate') {
                try {
                    await pc.addIceCandidate(new RTCIceCandidate(signalData.candidate));
                } catch (error) {
                    console.warn('WebRTC: Error adding IC candidate', error);
                }
            }
        };

        const handleTerminated = () => {
            cleanup();
        };

        const handleCallError = (payload) => {
            setCallError(String(payload?.message || 'Live call failed'));
            cleanup();
        };

        socket.on('video:call:incoming', handleIncoming);
        socket.on('video:call:signal', handleSignal);
        socket.on('video:call:terminated', handleTerminated);
        socket.on('video:call:error', handleCallError);

        return () => {
            socket.off('video:call:incoming', handleIncoming);
            socket.off('video:call:signal', handleSignal);
            socket.off('video:call:terminated', handleTerminated);
            socket.off('video:call:error', handleCallError);
        };
    }, [socket]);

    return (
        <VideoCallContext.Provider value={{
            startCall,
            answerCall,
            hangUp,
            callStatus,
            activeListingId: activeCallContext?.listingId || null,
            activeCallContext,
            callerInfo,
            callError,
            clearCallError: () => setCallError(''),
        }}>
            {children}
            <VideoCallOverlay
                localStream={localStream}
                remoteStream={remoteStream}
                callStatus={callStatus}
                callerInfo={callerInfo}
                callContext={activeCallContext}
                callError={callError}
                onAnswer={answerCall}
                onHangUp={hangUp}
            />
        </VideoCallContext.Provider>
    );
};
