import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Maximize2, Mic, MicOff, Minimize2, Phone, PhoneOff, Video, VideoOff } from 'lucide-react';

const getInitials = (value = '') => {
    const parts = String(value || '')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2);

    if (parts.length === 0) return 'AU';
    return parts.map((part) => part[0]?.toUpperCase() || '').join('');
};

const getStatusCopy = (callStatus, isSupportCall) => {
    switch (callStatus) {
        case 'incoming':
            return isSupportCall ? 'Incoming support call' : 'Incoming video request';
        case 'calling':
            return isSupportCall ? 'Calling support...' : 'Calling now...';
        case 'connected':
            return isSupportCall ? 'Connected securely' : 'Live and connected';
        default:
            return 'Preparing call...';
    }
};

const VideoCallOverlay = ({
    localStream,
    remoteStream,
    callStatus,
    callerInfo,
    callContext,
    callError,
    onAnswer,
    onHangUp,
}) => {
    const [isMuted, setIsMuted] = useState(false);
    const [isVideoOff, setIsVideoOff] = useState(false);
    const [isMinimized, setIsMinimized] = useState(false);

    const localVideoRef = useRef(null);
    const remoteVideoRef = useRef(null);

    useEffect(() => {
        if (localVideoRef.current) {
            localVideoRef.current.srcObject = localStream || null;
        }
    }, [localStream]);

    useEffect(() => {
        if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = remoteStream || null;
        }
    }, [remoteStream]);

    useEffect(() => {
        const audioTrack = localStream?.getAudioTracks?.()[0];
        const videoTrack = localStream?.getVideoTracks?.()[0];
        setIsMuted(audioTrack ? !audioTrack.enabled : false);
        setIsVideoOff(videoTrack ? !videoTrack.enabled : false);
    }, [localStream]);

    const toggleMute = () => {
        if (!localStream) return;
        const nextMuted = !isMuted;
        localStream.getAudioTracks().forEach((track) => {
            track.enabled = !nextMuted;
        });
        setIsMuted(nextMuted);
    };

    const toggleVideo = () => {
        if (!localStream) return;
        const nextVideoOff = !isVideoOff;
        localStream.getVideoTracks().forEach((track) => {
            track.enabled = !nextVideoOff;
        });
        setIsVideoOff(nextVideoOff);
    };

    if (callStatus === 'idle') return null;

    const isSupportCall = callContext?.channelType === 'support_ticket';
    const callerName = callerInfo?.name || (isSupportCall ? 'Aura Support' : 'Marketplace peer');
    const callLabel = callContext?.contextLabel || (isSupportCall ? 'Aura Support live call' : 'Marketplace live inspection');
    const statusCopy = getStatusCopy(callStatus, isSupportCall);
    const hasRemoteVideo = Boolean(remoteStream && remoteStream.getTracks?.().length);
    const hasLocalVideo = Boolean(localStream && localStream.getVideoTracks?.().length);
    const showAnswerControls = callStatus === 'incoming';
    const showConnectedControls = callStatus === 'connected';
    const showDialingControls = callStatus === 'calling';

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 16 }}
                animate={{
                    opacity: 1,
                    scale: 1,
                    y: 0,
                    width: isMinimized ? 320 : '100%',
                    height: isMinimized ? 184 : '100%',
                    bottom: isMinimized ? 20 : 0,
                    right: isMinimized ? 20 : 0,
                }}
                exit={{ opacity: 0, scale: 0.96, y: 16 }}
                transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                className={`fixed z-50 overflow-hidden ${
                    isMinimized
                        ? 'rounded-[2rem] border border-white/10 shadow-[0_28px_80px_rgba(2,8,23,0.45)]'
                        : 'inset-0'
                }`}
                onClick={() => {
                    if (isMinimized) {
                        setIsMinimized(false);
                    }
                }}
            >
                <div className="relative h-full w-full overflow-hidden bg-[#071019] text-white">
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.22),transparent_28%),radial-gradient(circle_at_top_right,rgba(34,211,238,0.16),transparent_24%),linear-gradient(180deg,rgba(3,7,18,0.2),rgba(2,6,23,0.94))]" />
                    <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:32px_32px] opacity-25" />

                    <video
                        ref={remoteVideoRef}
                        autoPlay
                        playsInline
                        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ${
                            hasRemoteVideo && showConnectedControls ? 'opacity-100' : 'opacity-0'
                        }`}
                    />

                    <div className="absolute inset-0 bg-gradient-to-b from-[#041812]/20 via-[#031017]/35 to-[#020617]/85" />

                    {!isMinimized ? (
                        <div className="absolute left-4 right-4 top-4 flex items-start justify-between gap-4">
                            <div className="rounded-full border border-white/10 bg-black/25 px-4 py-2 shadow-[0_16px_36px_rgba(2,8,23,0.22)]">
                                <div className="text-[11px] font-black uppercase tracking-[0.22em] text-emerald-200">{statusCopy}</div>
                                <div className="mt-1 text-sm font-semibold text-white/90">{callLabel}</div>
                            </div>

                            <button
                                type="button"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    setIsMinimized(true);
                                }}
                                className="support-chat-utility h-11 w-11 bg-black/35 text-white"
                            >
                                <Minimize2 className="h-4 w-4" />
                            </button>
                        </div>
                    ) : null}

                    {hasLocalVideo && !isMinimized ? (
                        <div className="absolute right-4 top-24 h-28 w-24 overflow-hidden rounded-[1.6rem] border border-white/15 bg-black/70 shadow-[0_20px_40px_rgba(2,8,23,0.35)] sm:h-36 sm:w-28">
                            <video
                                ref={localVideoRef}
                                autoPlay
                                playsInline
                                muted
                                className="h-full w-full object-cover"
                            />
                            {isVideoOff ? (
                                <div className="absolute inset-0 flex items-center justify-center bg-slate-900/95">
                                    <VideoOff className="h-7 w-7 text-white/45" />
                                </div>
                            ) : null}
                        </div>
                    ) : null}

                    {(!showConnectedControls || !hasRemoteVideo) && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
                            <div className="relative flex h-36 w-36 items-center justify-center">
                                <div className="absolute inset-0 rounded-full border border-emerald-300/20 bg-emerald-500/10 animate-pulse" />
                                <div className="absolute inset-[18%] rounded-full border border-cyan-300/20 bg-cyan-500/10" />
                                <div className="relative flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-cyan-500 text-3xl font-black shadow-[0_20px_40px_rgba(16,185,129,0.35)]">
                                    {getInitials(callerName)}
                                </div>
                            </div>

                            <div className="mt-6">
                                <div className="text-3xl font-black tracking-tight">{callerName}</div>
                                <div className="mt-2 text-sm uppercase tracking-[0.26em] text-white/55">{callLabel}</div>
                                <div className="mt-4 text-base font-medium text-white/80">{statusCopy}</div>
                                {callError ? (
                                    <div className="mt-4 rounded-full border border-rose-300/20 bg-rose-500/12 px-4 py-2 text-sm text-rose-100">
                                        {callError}
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    )}

                    {showConnectedControls && !isMinimized ? (
                        <motion.div
                            initial={{ y: 80, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            className="absolute bottom-8 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-full border border-white/10 bg-black/35 px-4 py-3 shadow-[0_24px_60px_rgba(2,8,23,0.35)]"
                        >
                            <button
                                type="button"
                                onClick={toggleMute}
                                className={`support-chat-utility h-12 w-12 ${isMuted ? 'bg-rose-500/90 text-white' : 'bg-white/10 text-white'}`}
                            >
                                {isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                            </button>

                            <button
                                type="button"
                                onClick={toggleVideo}
                                className={`support-chat-utility h-12 w-12 ${isVideoOff ? 'bg-rose-500/90 text-white' : 'bg-white/10 text-white'}`}
                            >
                                {isVideoOff ? <VideoOff className="h-4 w-4" /> : <Video className="h-4 w-4" />}
                            </button>

                            <button
                                type="button"
                                onClick={onHangUp}
                                className="inline-flex h-12 items-center gap-2 rounded-full bg-rose-500 px-5 text-sm font-black text-white shadow-[0_18px_34px_rgba(244,63,94,0.3)] transition-colors hover:bg-rose-600"
                            >
                                <PhoneOff className="h-4 w-4" />
                                {isSupportCall ? 'End live call' : 'End call'}
                            </button>
                        </motion.div>
                    ) : null}

                    {showAnswerControls && !isMinimized ? (
                        <div className="absolute bottom-10 left-1/2 flex -translate-x-1/2 items-center gap-6">
                            <motion.button
                                whileHover={{ scale: 1.04 }}
                                whileTap={{ scale: 0.96 }}
                                onClick={onAnswer}
                                className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500 text-white shadow-[0_20px_44px_rgba(16,185,129,0.35)]"
                            >
                                <Phone className="h-6 w-6 fill-white" />
                            </motion.button>
                            <motion.button
                                whileHover={{ scale: 1.04 }}
                                whileTap={{ scale: 0.96 }}
                                onClick={onHangUp}
                                className="flex h-16 w-16 items-center justify-center rounded-full bg-rose-500 text-white shadow-[0_20px_44px_rgba(244,63,94,0.35)]"
                            >
                                <PhoneOff className="h-6 w-6 fill-white" />
                            </motion.button>
                        </div>
                    ) : null}

                    {showDialingControls && !isMinimized ? (
                        <div className="absolute bottom-10 left-1/2 -translate-x-1/2">
                            <button
                                type="button"
                                onClick={onHangUp}
                                className="inline-flex h-14 items-center gap-2 rounded-full bg-rose-500 px-6 text-sm font-black text-white shadow-[0_20px_44px_rgba(244,63,94,0.35)] transition-colors hover:bg-rose-600"
                            >
                                <PhoneOff className="h-4 w-4" />
                                Cancel call
                            </button>
                        </div>
                    ) : null}

                    {isMinimized ? (
                        <div className="absolute inset-0 flex items-end p-3">
                            <div className="flex w-full items-center justify-between rounded-[1.5rem] border border-white/10 bg-black/35 px-4 py-3 backdrop-blur-sm">
                                <div className="min-w-0">
                                    <div className="truncate text-sm font-black text-white">{callerName}</div>
                                    <div className="mt-1 text-[11px] uppercase tracking-[0.18em] text-emerald-200">{statusCopy}</div>
                                </div>

                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            setIsMinimized(false);
                                        }}
                                        className="support-chat-utility h-10 w-10 bg-white/10 text-white"
                                    >
                                        <Maximize2 className="h-4 w-4" />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            onHangUp();
                                        }}
                                        className="flex h-10 w-10 items-center justify-center rounded-full bg-rose-500 text-white"
                                    >
                                        <PhoneOff className="h-4 w-4" />
                                    </button>
                                </div>
                            </div>
                        </div>
                    ) : null}
                </div>
            </motion.div>
        </AnimatePresence>
    );
};

export default VideoCallOverlay;
