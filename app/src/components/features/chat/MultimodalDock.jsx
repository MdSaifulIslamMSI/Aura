import { useDeferredValue } from 'react';
import { Camera, Mic, PhoneCall, Sparkles, Video, Wifi, WifiOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMultimodalAssistant } from '@/context/MultimodalAssistantContext';
import { useChatStore } from '@/store/chatStore';

const buildStatusTone = (tone = 'neutral', isWhiteMode = false) => {
    if (tone === 'success') {
        return isWhiteMode
            ? 'border-emerald-200 bg-emerald-500/10 text-emerald-700'
            : 'border-emerald-300/20 bg-emerald-500/12 text-emerald-100';
    }
    if (tone === 'warning') {
        return isWhiteMode
            ? 'border-amber-200 bg-amber-500/10 text-amber-700'
            : 'border-amber-300/20 bg-amber-500/12 text-amber-100';
    }
    if (tone === 'accent') {
        return isWhiteMode
            ? 'border-cyan-200 bg-cyan-500/10 text-cyan-700'
            : 'border-cyan-300/20 bg-cyan-500/12 text-cyan-100';
    }
    return isWhiteMode
        ? 'border-slate-200 bg-white text-slate-600'
        : 'border-white/10 bg-white/5 text-white/75';
};

const MultimodalDock = ({ isWhiteMode = false }) => {
    const inputValue = useChatStore((state) => state.inputValue);
    const {
        activeChannel,
        activeCallSummary,
        continuityContext,
        openVoiceAssistant,
        readiness,
        routeContext,
        sessionEvents,
        startContextualCall,
    } = useMultimodalAssistant() || {};

    const deferredEvents = useDeferredValue(Array.isArray(sessionEvents) ? sessionEvents.slice(0, 3) : []);

    const shellClassName = isWhiteMode
        ? 'border-slate-200 bg-[linear-gradient(180deg,rgba(248,250,252,0.98),rgba(255,255,255,0.98))] text-slate-950'
        : 'border-white/10 bg-[linear-gradient(180deg,rgba(8,15,31,0.94),rgba(6,10,24,0.94))] text-white';
    const mutedTextClass = isWhiteMode ? 'text-slate-500' : 'text-white/60';
    const surfaceClassName = isWhiteMode ? 'border-slate-200 bg-slate-50/80' : 'border-white/10 bg-white/[0.05]';
    const primaryLaneClass = isWhiteMode
        ? 'border-slate-950 bg-slate-950 text-white hover:bg-slate-800'
        : 'border-cyan-300/25 bg-cyan-400/12 text-cyan-100 hover:bg-cyan-400/18';
    const secondaryLaneClass = isWhiteMode
        ? 'border-slate-200 bg-white text-slate-950 hover:bg-slate-100'
        : 'border-white/10 bg-white/[0.04] text-white hover:bg-white/[0.09]';

    const microphoneReady = readiness?.microphone === 'granted';
    const cameraReady = readiness?.camera === 'granted';
    const networkHealthy = readiness?.network === 'online';
    const activeDraft = String(inputValue || continuityContext?.lastQuery || '').trim();

    return (
        <section className={cn('mx-5 mt-5 rounded-[1.6rem] border p-4 sm:mx-6 sm:p-5', shellClassName)}>
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.22em] text-cyan-300">
                        <Sparkles className="h-3.5 w-3.5" />
                        Multimodal Fast Lane
                    </div>
                    <p className={cn('mt-2 text-sm font-semibold', isWhiteMode ? 'text-slate-900' : 'text-white')}>
                        One continuity layer across chat, voice, and live calls.
                    </p>
                    <p className={cn('mt-1 text-xs', mutedTextClass)}>
                        {routeContext?.routeLabel || 'Shopping flow'} | Active lane {String(activeChannel || 'chat').replace(/-/g, ' ')}
                    </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <span className={cn(
                        'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold',
                        microphoneReady
                            ? (isWhiteMode ? 'border-emerald-200 bg-emerald-500/10 text-emerald-700' : 'border-emerald-300/20 bg-emerald-500/10 text-emerald-100')
                            : (isWhiteMode ? 'border-slate-200 bg-white text-slate-500' : 'border-white/10 bg-white/5 text-white/70')
                    )}>
                        <Mic className="h-3 w-3" />
                        {microphoneReady ? 'Mic ready' : 'Mic check'}
                    </span>
                    <span className={cn(
                        'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold',
                        cameraReady
                            ? (isWhiteMode ? 'border-cyan-200 bg-cyan-500/10 text-cyan-700' : 'border-cyan-300/20 bg-cyan-500/10 text-cyan-100')
                            : (isWhiteMode ? 'border-slate-200 bg-white text-slate-500' : 'border-white/10 bg-white/5 text-white/70')
                    )}>
                        <Camera className="h-3 w-3" />
                        {cameraReady ? 'Camera ready' : 'Camera check'}
                    </span>
                    <span className={cn(
                        'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold',
                        networkHealthy
                            ? (isWhiteMode ? 'border-emerald-200 bg-emerald-500/10 text-emerald-700' : 'border-emerald-300/20 bg-emerald-500/10 text-emerald-100')
                            : (isWhiteMode ? 'border-amber-200 bg-amber-500/10 text-amber-700' : 'border-amber-300/20 bg-amber-500/12 text-amber-100')
                    )}>
                        {networkHealthy ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
                        {networkHealthy ? (readiness?.networkProfile || 'online') : 'offline'}
                    </span>
                </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <button
                    type="button"
                    onClick={() => openVoiceAssistant?.({
                        initialCommand: activeDraft,
                        origin: 'chat_fast_lane',
                    })}
                    className={cn('rounded-[1.2rem] border px-4 py-4 text-left transition-colors', primaryLaneClass)}
                >
                    <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em]">
                        <Mic className="h-4 w-4" />
                        Voice Copilot
                    </div>
                    <p className="mt-2 text-sm font-semibold">
                        Lift the current brief into voice and keep the shopping context intact.
                    </p>
                    <p className={cn('mt-1 text-xs', isWhiteMode ? 'text-slate-300' : 'text-cyan-100/75')}>
                        {activeDraft || 'Launch with a clean voice prompt.'}
                    </p>
                </button>

                <button
                    type="button"
                    onClick={() => void startContextualCall?.({ mediaMode: 'voice', source: 'chat_fast_lane' })}
                    disabled={!routeContext?.canLaunchInspection || activeCallSummary?.active}
                    className={cn(
                        'rounded-[1.2rem] border px-4 py-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-55',
                        secondaryLaneClass
                    )}
                >
                    <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em]">
                        <PhoneCall className="h-4 w-4" />
                        Live Voice
                    </div>
                    <p className="mt-2 text-sm font-semibold">
                        Start an audio-only inspection lane on the active marketplace listing.
                    </p>
                    <p className={cn('mt-1 text-xs', mutedTextClass)}>
                        {routeContext?.canLaunchInspection
                            ? (activeCallSummary?.active ? 'A live lane is already active.' : 'Low-friction consult with the current listing context.')
                            : 'Available when you open a marketplace listing.'}
                    </p>
                </button>

                <button
                    type="button"
                    onClick={() => void startContextualCall?.({ mediaMode: 'video', source: 'chat_fast_lane' })}
                    disabled={!routeContext?.canLaunchInspection || activeCallSummary?.active}
                    className={cn(
                        'rounded-[1.2rem] border px-4 py-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-55',
                        secondaryLaneClass
                    )}
                >
                    <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em]">
                        <Video className="h-4 w-4" />
                        Live Video
                    </div>
                    <p className="mt-2 text-sm font-semibold">
                        Escalate into full live inspection without dropping the assistant continuity.
                    </p>
                    <p className={cn('mt-1 text-xs', mutedTextClass)}>
                        {routeContext?.canLaunchInspection
                            ? (activeCallSummary?.active ? 'A live lane is already active.' : 'Best for high-trust walkthroughs and close-up verification.')
                            : 'Open a marketplace listing to unlock live video.'}
                    </p>
                </button>
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-[1.05fr_0.95fr]">
                <div className={cn('rounded-[1.2rem] border p-3', surfaceClassName)}>
                    <div className="text-[11px] font-black uppercase tracking-[0.18em] text-cyan-300">Continuity</div>
                    <p className={cn('mt-2 text-sm', mutedTextClass)}>
                        Latest brief: <span className={cn('font-semibold', isWhiteMode ? 'text-slate-900' : 'text-white')}>
                            {continuityContext?.lastQuery || 'No explicit shopper brief yet.'}
                        </span>
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold">
                        <span className={cn('rounded-full border px-2.5 py-1', surfaceClassName)}>
                            Mode {continuityContext?.chatMode || 'explore'}
                        </span>
                        <span className={cn('rounded-full border px-2.5 py-1', surfaceClassName)}>
                            Cart {continuityContext?.cartCount || 0}
                        </span>
                        <span className={cn('rounded-full border px-2.5 py-1', surfaceClassName)}>
                            Intent {continuityContext?.currentIntent || 'adaptive'}
                        </span>
                        {activeCallSummary?.active ? (
                            <span className={cn(
                                'rounded-full border px-2.5 py-1',
                                isWhiteMode ? 'border-emerald-200 bg-emerald-500/10 text-emerald-700' : 'border-emerald-300/20 bg-emerald-500/10 text-emerald-100'
                            )}>
                                Live {activeCallSummary.mediaMode} active
                            </span>
                        ) : null}
                    </div>
                </div>

                <div className={cn('rounded-[1.2rem] border p-3', surfaceClassName)}>
                    <div className="text-[11px] font-black uppercase tracking-[0.18em] text-cyan-300">Recent Signals</div>
                    <div className="mt-3 space-y-2">
                        {deferredEvents.length > 0 ? deferredEvents.map((event) => (
                            <div key={event.id} className={cn('rounded-2xl border px-3 py-2.5', buildStatusTone(event.tone, isWhiteMode))}>
                                <div className="text-xs font-black uppercase tracking-[0.16em]">{event.title}</div>
                                <div className="mt-1 text-xs leading-5 opacity-90">{event.detail || 'Session state updated.'}</div>
                            </div>
                        )) : (
                            <div className={cn('rounded-2xl border px-3 py-3 text-xs', surfaceClassName, mutedTextClass)}>
                                The assistant will start threading chat, voice, and live-call events here as you use them.
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </section>
    );
};

export default MultimodalDock;
