import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Phone, PhoneOff, Mic, MicOff, Video, VideoOff, Maximize2, Minimize2 } from 'lucide-react';

/**
 * Premium Video Call Overlay with glassmorphism and micro-animations.
 */
const VideoCallOverlay = ({ 
    localStream, 
    remoteStream, 
    callStatus, 
    callerInfo, 
    onAnswer, 
    onHangUp 
}) => {
    const [isMuted, setIsMuted] = useState(false);
    const [isVideoOff, setIsVideoOff] = useState(false);
    const [isMinimized, setIsMinimized] = useState(false);

    const localVideoRef = React.useRef(null);
    const remoteVideoRef = React.useRef(null);

    useEffect(() => {
        if (localVideoRef.current && localStream) {
            localVideoRef.current.srcObject = localStream;
        }
    }, [localStream]);

    useEffect(() => {
        if (remoteVideoRef.current && remoteStream) {
            remoteVideoRef.current.srcObject = remoteStream;
        }
    }, [remoteStream]);

    const toggleMute = () => {
        if (localStream) {
            localStream.getAudioTracks().forEach(track => track.enabled = !track.enabled);
            setIsMuted(!isMuted);
        }
    };

    const toggleVideo = () => {
        if (localStream) {
            localStream.getVideoTracks().forEach(track => track.enabled = !track.enabled);
            setIsVideoOff(!isVideoOff);
        }
    };

    if (callStatus === 'idle') return null;

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ 
                    opacity: 1, 
                    scale: 1, 
                    y: 0,
                    width: isMinimized ? '320px' : '100%',
                    height: isMinimized ? '180px' : '100%',
                    bottom: isMinimized ? '20px' : '0',
                    right: isMinimized ? '20px' : '0',
                }}
                exit={{ opacity: 0, scale: 0.9, y: 20 }}
                className={`fixed z-50 flex items-center justify-center overflow-hidden transition-all duration-500 ease-in-out ${
                    isMinimized 
                        ? 'rounded-2xl shadow-2xl border border-white/20' 
                        : 'inset-0 bg-black/60 backdrop-blur-xl'
                }`}
            >
                {/* Main Video Area */}
                <div className="relative w-full h-full bg-slate-900 overflow-hidden">
                    {/* Remote Video (Full Screen) */}
                    <video
                        ref={remoteVideoRef}
                        autoPlay
                        playsInline
                        className={`w-full h-full object-cover transition-opacity duration-700 ${
                            callStatus === 'connected' ? 'opacity-100' : 'opacity-0'
                        }`}
                    />

                    {/* Local Video (Floating / PIP) */}
                    <motion.div 
                        drag={isMinimized ? false : true}
                        dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
                        className={`absolute top-6 right-6 w-40 aspect-video rounded-xl overflow-hidden border-2 border-white/20 shadow-2xl bg-black transition-all ${
                            isMinimized ? 'scale-0' : 'scale-100'
                        }`}
                    >
                        <video
                            ref={localVideoRef}
                            autoPlay
                            playsInline
                            muted
                            className="w-full h-full object-cover"
                        />
                        {isVideoOff && (
                            <div className="absolute inset-0 flex items-center justify-center bg-slate-800">
                                <VideoOff className="text-white/40 w-8 h-8" />
                            </div>
                        )}
                    </motion.div>

                    {/* Calling/Incoming UI States */}
                    {(callStatus === 'calling' || callStatus === 'incoming') && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-white space-y-8 bg-gradient-to-b from-blue-900/40 to-slate-900/80">
                            <div className="w-32 h-32 rounded-full border-4 border-blue-500/30 flex items-center justify-center animate-pulse">
                                <div className="w-24 h-24 rounded-full bg-blue-500 flex items-center justify-center text-3xl font-bold shadow-lg shadow-blue-500/50">
                                    {(callerInfo?.name || 'A').charAt(0)}
                                </div>
                            </div>
                            <div className="text-center">
                                <h3 className="text-2xl font-light tracking-widest uppercase">
                                    {callStatus === 'calling' ? 'Contacting Seller...' : 'Incoming Inspection Request'}
                                </h3>
                                <p className="text-white/60 mt-2 font-medium">
                                    {callerInfo?.name || 'Authorized Peer'}
                                </p>
                            </div>

                            {callStatus === 'incoming' && (
                                <div className="flex space-x-6">
                                    <motion.button
                                        whileHover={{ scale: 1.1 }}
                                        whileTap={{ scale: 0.9 }}
                                        onClick={onAnswer}
                                        className="w-16 h-16 rounded-full bg-emerald-500 flex items-center justify-center shadow-lg shadow-emerald-500/40"
                                    >
                                        <Phone className="text-white fill-white" />
                                    </motion.button>
                                    <motion.button
                                        whileHover={{ scale: 1.1 }}
                                        whileTap={{ scale: 0.9 }}
                                        onClick={onHangUp}
                                        className="w-16 h-16 rounded-full bg-rose-500 flex items-center justify-center shadow-lg shadow-rose-500/40"
                                    >
                                        <PhoneOff className="text-white fill-white" />
                                    </motion.button>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Controls Bar */}
                    {!isMinimized && callStatus === 'connected' && (
                        <motion.div 
                            initial={{ y: 100 }}
                            animate={{ y: 0 }}
                            className="absolute bottom-10 left-1/2 -translate-x-1/2 flex items-center space-x-4 px-8 py-4 bg-white/10 backdrop-blur-2xl rounded-3xl border border-white/10 shadow-3xl"
                        >
                            <button onClick={toggleMute} className={`p-4 rounded-2xl transition-colors ${isMuted ? 'bg-rose-500 text-white' : 'bg-white/5 text-white hover:bg-white/20'}`}>
                                {isMuted ? <MicOff /> : <Mic />}
                            </button>
                            <button onClick={toggleVideo} className={`p-4 rounded-2xl transition-colors ${isVideoOff ? 'bg-rose-500 text-white' : 'bg-white/5 text-white hover:bg-white/20'}`}>
                                {isVideoOff ? <VideoOff /> : <Video />}
                            </button>
                            <button 
                                onClick={onHangUp}
                                className="px-8 py-4 bg-rose-500 text-white rounded-2xl font-bold flex items-center space-x-2 hover:bg-rose-600 transition-all shadow-lg shadow-rose-500/30"
                            >
                                <PhoneOff className="w-5 h-5" />
                                <span>End Inspection</span>
                            </button>
                            <div className="w-px h-8 bg-white/10" />
                            <button onClick={() => setIsMinimized(true)} className="p-4 rounded-2xl bg-white/5 text-white hover:bg-white/20 transition-colors">
                                <Minimize2 />
                            </button>
                        </motion.div>
                    )}

                    {/* Minimized Controls */}
                    {isMinimized && (
                        <div className="absolute inset-0 flex items-center justify-center group cursor-pointer" onClick={() => setIsMinimized(false)}>
                            <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-black/40 backdrop-blur-sm inset-0 absolute flex items-center justify-center">
                                <Maximize2 className="text-white w-8 h-8" />
                            </div>
                        </div>
                    )}
                </div>
            </motion.div>
        </AnimatePresence>
    );
};

export default VideoCallOverlay;
