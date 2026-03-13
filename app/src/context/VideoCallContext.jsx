import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { useSocket } from './SocketContext';
import VideoCallOverlay from '../components/features/video/VideoCallOverlay';

const VideoCallContext = createContext(null);

export const useVideoCall = () => useContext(VideoCallContext);

export const VideoCallProvider = ({ children }) => {
    const { socket } = useSocket();
    const [activeListingId, setActiveListingId] = useState(null);
    const [localStream, setLocalStream] = useState(null);
    const [remoteStream, setRemoteStream] = useState(null);
    const [callStatus, setCallStatus] = useState('idle'); // idle, calling, incoming, connected
    const [callerInfo, setCallerInfo] = useState(null);
    
    const peerConnection = useRef(null);
    const targetUserId = useRef(null);

    // Configuration for Aura high-availability (STUN for NAT traversal)
    const pcConfig = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
        ]
    };

    const cleanup = () => {
        if (peerConnection.current) {
            peerConnection.current.close();
            peerConnection.current = null;
        }
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
            setLocalStream(null);
        }
        setRemoteStream(null);
        setCallStatus('idle');
        setCallerInfo(null);
        setActiveListingId(null);
        targetUserId.current = null;
    };

    const initializePeerConnection = () => {
        const pc = new RTCPeerConnection(pcConfig);

        pc.onicecandidate = (event) => {
            if (event.candidate && socket && targetUserId.current) {
                socket.emit('video:call:signal', {
                    targetUserId: targetUserId.current,
                    signalData: { type: 'ice-candidate', candidate: event.candidate }
                });
            }
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

    const startCall = async (toUserId, listingId) => {
        try {
            setActiveListingId(listingId);
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            setLocalStream(stream);
            setCallStatus('calling');
            targetUserId.current = toUserId;

            const pc = initializePeerConnection();
            stream.getTracks().forEach(track => pc.addTrack(track, stream));

            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            socket.emit('video:call:initiate', {
                targetUserId: toUserId,
                listingId,
                signalData: { type: 'offer', sdp: offer.sdp }
            });
        } catch (error) {
            console.error('WebRTC: Failed to start call', error);
            cleanup();
        }
    };

    const answerCall = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            setLocalStream(stream);

            const pc = peerConnection.current; 
            if (!pc) return;
            
            stream.getTracks().forEach(track => pc.addTrack(track, stream));

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            socket.emit('video:call:signal', {
                targetUserId: targetUserId.current,
                signalData: { type: 'answer', sdp: answer.sdp }
            });

            setCallStatus('connected');
        } catch (error) {
            console.error('WebRTC: Failed to answer call', error);
            cleanup();
        }
    };

    const hangUp = () => {
        if (socket && targetUserId.current) {
            socket.emit('video:call:hangup', { targetUserId: targetUserId.current });
        }
        cleanup();
    };

    useEffect(() => {
        if (!socket) return;

        const handleIncoming = async (payload) => {
            setCallerInfo({ userId: payload.fromUserId, name: payload.fromName });
            targetUserId.current = payload.fromUserId;
            setActiveListingId(payload.listingId);
            setCallStatus('incoming');

            if (payload.signalData?.type === 'offer') {
                const pc = initializePeerConnection();
                await pc.setRemoteDescription(new RTCSessionDescription({
                    type: 'offer',
                    sdp: payload.signalData.sdp
                }));
            }
        };

        const handleSignal = async (payload) => {
            const { signalData } = payload;
            const pc = peerConnection.current;
            if (!pc) return;

            if (signalData.type === 'answer') {
                await pc.setRemoteDescription(new RTCSessionDescription({
                    type: 'answer',
                    sdp: signalData.sdp
                }));
                setCallStatus('connected');
            } else if (signalData.type === 'ice-candidate') {
                try {
                    await pc.addIceCandidate(new RTCIceCandidate(signalData.candidate));
                } catch (e) {
                    console.warn('WebRTC: Error adding IC candidate', e);
                }
            }
        };

        const handleTerminated = () => {
            cleanup();
        };

        socket.on('video:call:incoming', handleIncoming);
        socket.on('video:call:signal', handleSignal);
        socket.on('video:call:terminated', handleTerminated);

        return () => {
            socket.off('video:call:incoming', handleIncoming);
            socket.off('video:call:signal', handleSignal);
            socket.off('video:call:terminated', handleTerminated);
        };
    }, [socket]);

    return (
        <VideoCallContext.Provider value={{ startCall, answerCall, hangUp, callStatus, activeListingId }}>
            {children}
            <VideoCallOverlay 
                localStream={localStream}
                remoteStream={remoteStream}
                callStatus={callStatus}
                callerInfo={callerInfo}
                onAnswer={answerCall}
                onHangUp={hangUp}
            />
        </VideoCallContext.Provider>
    );
};
