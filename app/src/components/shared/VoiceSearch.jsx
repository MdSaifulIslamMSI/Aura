import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bot, Loader2, Mic, MicOff, Send, Volume2, VolumeX, X } from 'lucide-react';
import { aiApi } from '@/services/aiApi';
import { buildLocalVoiceCommand } from '@/utils/assistantIntent';

const COMMAND_HINTS = [
  'Search for iPhone 15',
  'Open marketplace',
  'Go to cart',
  'Show laptops category',
  'Open orders',
  'Help',
];

const buildLocalAssistantResponse = (rawInput) => {
  const command = buildLocalVoiceCommand(rawInput);
  const answer = command.message || 'Done.';

  switch (command.type) {
    case 'close':
      return { answer, actions: [{ type: 'close' }], followUps: [] };
    case 'product':
      return {
        answer,
        actions: [{ type: 'open_product', productId: command.productId }],
        followUps: [],
      };
    case 'navigate':
      return { answer, actions: [{ type: 'navigate', path: command.path }], followUps: [] };
    case 'search':
      return { answer, actions: [{ type: 'search', query: command.query }], followUps: [] };
    default:
      return { answer, actions: [], followUps: [] };
  }
};

const decodeBase64Audio = (base64Value = '', mimeType = 'audio/mpeg') => {
  if (typeof window === 'undefined' || typeof window.atob !== 'function') return null;
  const cleanValue = String(base64Value || '').trim();
  if (!cleanValue) return null;

  const binaryString = window.atob(cleanValue);
  const bytes = new Uint8Array(binaryString.length);
  for (let index = 0; index < binaryString.length; index += 1) {
    bytes[index] = binaryString.charCodeAt(index);
  }

  return new Blob([bytes], { type: mimeType });
};

const VoiceSearch = ({ onClose, onResult }) => {
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [manualCommand, setManualCommand] = useState('');
  const [assistantReply, setAssistantReply] = useState('');
  const [error, setError] = useState('');
  const [speechEnabled, setSpeechEnabled] = useState(true);
  const [voiceSession, setVoiceSession] = useState(null);

  const recognitionRef = useRef(null);
  const transcriptRef = useRef('');
  const voiceSessionRef = useRef(null);
  const audioRef = useRef(null);
  const audioUrlRef = useRef('');
  const navigate = useNavigate();

  const browserSupportsSpeechRecognition =
    typeof window !== 'undefined' &&
    ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window);

  const playServerSpeech = useCallback(async (text) => {
    const provider = voiceSessionRef.current?.capabilities?.textToSpeech?.provider;
    if (provider !== 'elevenlabs') return false;

    const response = await aiApi.speakText({
      text,
      locale: voiceSessionRef.current?.locale || 'en-IN',
    });

    const audioBlob = decodeBase64Audio(response?.audioBase64, response?.mimeType || 'audio/mpeg');
    if (!audioBlob) return false;

    if (audioRef.current) {
      audioRef.current.pause();
    }
    if (audioUrlRef.current && typeof URL !== 'undefined') {
      URL.revokeObjectURL(audioUrlRef.current);
    }

    const objectUrl = URL.createObjectURL(audioBlob);
    const audio = new Audio(objectUrl);
    audioRef.current = audio;
    audioUrlRef.current = objectUrl;
    await audio.play();
    return true;
  }, []);

  const speak = useCallback(
    async (text) => {
      if (!speechEnabled || typeof window === 'undefined') return;
      const message = String(text || '').trim();
      if (!message) return;

      try {
        const usedServerSpeech = await playServerSpeech(message);
        if (usedServerSpeech) return;
      } catch (error) {
        console.error('Server voice synthesis failed, using browser fallback:', error);
      }

      if (!('speechSynthesis' in window)) return;

      const utterance = new SpeechSynthesisUtterance(message);
      utterance.lang = voiceSession?.locale || 'en-IN';
      utterance.rate = 1;
      utterance.pitch = 1;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    },
    [playServerSpeech, speechEnabled, voiceSession?.locale]
  );

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    setIsListening(false);
  }, []);

  const applyAssistantActions = useCallback(
    (actions = []) => {
      const [primaryAction] = Array.isArray(actions) ? actions : [];
      if (!primaryAction?.type) return;

      if (primaryAction.type === 'close') {
        onClose?.();
        return;
      }

      if (primaryAction.type === 'open_product' && primaryAction.productId) {
        navigate(`/product/${primaryAction.productId}`);
        onClose?.();
        return;
      }

      if (primaryAction.type === 'navigate' && primaryAction.path) {
        navigate(primaryAction.path);
        onClose?.();
        return;
      }

      if (primaryAction.type === 'search' && primaryAction.query) {
        if (typeof onResult === 'function') {
          onResult(primaryAction.query);
        } else {
          navigate(`/search?q=${encodeURIComponent(primaryAction.query)}`);
        }
        onClose?.();
      }
    },
    [navigate, onClose, onResult]
  );

  const executeLocalCommand = useCallback(
    (rawInput, nextError = '') => {
      const response = buildLocalAssistantResponse(rawInput);
      setAssistantReply(response.answer || 'Done.');
      setError(nextError);
      void speak(response.answer || 'Done.');
      applyAssistantActions(response.actions || []);
    },
    [applyAssistantActions, speak]
  );

  const executeCommand = useCallback(
    async (rawInput) => {
      const message = String(rawInput || '').trim();
      if (!message) {
        setAssistantReply('Say a command like search for iPhone fifteen.');
        return;
      }

      setTranscript(message);
      setIsProcessing(true);
      setError('');

      try {
        const response = await aiApi.chat({
          message,
          assistantMode: 'voice',
          context: {
            locale: voiceSessionRef.current?.locale || 'en-IN',
            voiceSessionId: voiceSessionRef.current?.sessionId || '',
          },
        });

        const answer = String(response?.answer || '').trim() || 'Voice command processed.';
        setAssistantReply(answer);
        void speak(answer);
        applyAssistantActions(response?.actions || []);
      } catch (requestError) {
        executeLocalCommand(message, 'Using local voice fallback.');
        console.error('Voice assistant fallback:', requestError);
      } finally {
        setIsProcessing(false);
      }
    },
    [applyAssistantActions, executeLocalCommand, speak]
  );

  const startListening = useCallback(() => {
    if (!browserSupportsSpeechRecognition) {
      setError('Voice commands are not supported in this browser.');
      setAssistantReply('Please use typed command mode.');
      return;
    }

    setError('');
    setTranscript('');
    transcriptRef.current = '';

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = voiceSessionRef.current?.locale || 'en-IN';
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setIsListening(true);
      setAssistantReply('Listening...');
    };

    recognition.onresult = (event) => {
      let finalText = '';
      let interimText = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const chunk = event.results[i]?.[0]?.transcript || '';
        if (event.results[i].isFinal) {
          finalText += ` ${chunk}`;
        } else {
          interimText += ` ${chunk}`;
        }
      }

      const mergedFinal = `${transcriptRef.current} ${finalText}`.trim();
      transcriptRef.current = mergedFinal || transcriptRef.current;
      const visibleTranscript = `${mergedFinal || transcriptRef.current} ${interimText}`.trim();
      setTranscript(visibleTranscript);
    };

    recognition.onend = () => {
      setIsListening(false);
      const finalTranscript = transcriptRef.current.trim();
      if (finalTranscript) {
        executeCommand(finalTranscript);
      } else {
        setAssistantReply('No command detected. Try again.');
      }
    };

    recognition.onerror = (event) => {
      setIsListening(false);
      if (event.error === 'no-speech') {
        setError('No speech detected. Try again.');
      } else if (event.error === 'not-allowed') {
        setError('Microphone permission denied. Allow microphone access and retry.');
      } else if (event.error === 'audio-capture') {
        setError('No microphone detected. Connect a mic and retry.');
      } else {
        setError(`Voice error: ${event.error}`);
      }
    };

    recognition.start();
  }, [browserSupportsSpeechRecognition, executeCommand]);

  useEffect(() => {
    let active = true;

    aiApi.createVoiceSession({ locale: 'en-IN' })
      .then((session) => {
        if (!active) return;
        voiceSessionRef.current = session;
        setVoiceSession(session);
      })
      .catch((requestError) => {
        if (!active) return;
        console.error('Voice session bootstrap failed:', requestError);
      });

    startListening();
    return () => {
      active = false;
      recognitionRef.current?.abort();
      audioRef.current?.pause();
      if (audioUrlRef.current && typeof URL !== 'undefined') {
        URL.revokeObjectURL(audioUrlRef.current);
      }
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, [startListening]);

  return (
    <div
      className="fixed inset-0 z-[75] bg-black/70 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-3xl border border-white/10 bg-zinc-950/95 shadow-[0_30px_90px_rgba(2,6,23,0.8)] overflow-hidden"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="px-5 sm:px-6 py-4 border-b border-white/10 bg-gradient-to-r from-cyan-500/10 via-indigo-500/10 to-emerald-500/10">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl border border-cyan-300/35 bg-cyan-500/15 flex items-center justify-center">
                <Bot className="w-5 h-5 text-cyan-200" />
              </div>
              <div>
                <h2 className="text-base sm:text-lg font-black text-slate-100 tracking-wide">Aura Voice Assistant</h2>
                <p className="text-xs sm:text-sm text-slate-400">Browser capture plus server-backed command reasoning</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSpeechEnabled((value) => !value)}
                className="rounded-lg border border-white/15 bg-white/5 p-2 text-slate-300 hover:text-white hover:border-white/25"
                title={speechEnabled ? 'Mute assistant voice' : 'Enable assistant voice'}
              >
                {speechEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-white/15 bg-white/5 p-2 text-slate-300 hover:text-white hover:border-white/25"
                aria-label="Close voice assistant"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        <div className="p-5 sm:p-6 space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-4 items-start">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className="text-[11px] font-black uppercase tracking-[0.2em] text-cyan-300 mb-2">Microphone</div>
              <div className="relative mx-auto w-20 h-20 mb-3">
                {isListening && (
                  <>
                    <span className="absolute inset-0 rounded-full bg-cyan-400/20 animate-ping" />
                    <span className="absolute inset-[-6px] rounded-full bg-cyan-400/10 animate-pulse" />
                  </>
                )}
                <button
                  type="button"
                  onClick={isListening ? stopListening : startListening}
                  className={`relative w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300 border ${
                    isListening
                      ? 'bg-gradient-to-br from-cyan-500 to-emerald-500 text-white border-cyan-300/50 scale-105'
                      : 'bg-white/[0.06] text-slate-200 border-white/15 hover:bg-white/[0.1]'
                  }`}
                  title={isListening ? 'Stop listening' : 'Start listening'}
                >
                  {isListening ? <Mic className="w-8 h-8 animate-pulse" /> : <MicOff className="w-7 h-7" />}
                </button>
              </div>

              <button
                type="button"
                onClick={startListening}
                disabled={isListening || isProcessing}
                className="w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs font-bold uppercase tracking-wider text-slate-200 hover:bg-white/10 disabled:opacity-50"
              >
                Retry
              </button>
            </div>

            <div className="space-y-3">
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 min-h-[8.5rem]">
                <div className="text-[11px] font-black uppercase tracking-[0.2em] text-cyan-300 mb-2">I Heard</div>
                <p className="text-slate-100 text-base sm:text-lg font-semibold break-words">
                  {transcript ? `"${transcript}"` : 'Waiting for your command...'}
                </p>

                {isListening && (
                  <div className="mt-3 flex items-center gap-2 text-xs text-cyan-200">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Listening for command...
                  </div>
                )}

                {isProcessing && !isListening && (
                  <div className="mt-3 flex items-center gap-2 text-xs text-cyan-200">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Aura is resolving your command...
                  </div>
                )}

                {assistantReply && !isListening && !isProcessing && (
                  <div className="mt-3 rounded-lg border border-emerald-400/25 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">
                    {assistantReply}
                  </div>
                )}

                {error && (
                  <div className="mt-3 rounded-lg border border-amber-300/25 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
                    {error}
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400 mb-2">Type Command</div>
                <div className="flex items-center gap-2">
                  <input
                    value={manualCommand}
                    onChange={(event) => setManualCommand(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        executeCommand(manualCommand);
                        setManualCommand('');
                      }
                    }}
                    placeholder="Example: search for bluetooth headphones"
                    className="flex-1 rounded-xl border border-white/15 bg-zinc-900/90 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-cyan-400/70"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      executeCommand(manualCommand);
                      setManualCommand('');
                    }}
                    className="rounded-xl border border-cyan-300/35 bg-cyan-500/15 px-3 py-2 text-cyan-100 hover:bg-cyan-500/25"
                    aria-label="Execute typed command"
                    disabled={isProcessing}
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">Voice Commands</div>
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1">
                  {voiceSession?.capabilities?.speechToText?.provider || 'browser'}
                </span>
                <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1">
                  {voiceSession?.locale || 'en-IN'}
                </span>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {COMMAND_HINTS.map((hint) => (
                <button
                  key={hint}
                  type="button"
                  onClick={() => executeCommand(hint)}
                  className="rounded-full border border-white/12 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-cyan-300/40 hover:text-cyan-200"
                >
                  {hint}
                </button>
              ))}
            </div>
            {!browserSupportsSpeechRecognition && (
              <p className="mt-3 text-xs text-amber-200">
                Voice capture is unavailable in this browser. Typed command mode is enabled.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default VoiceSearch;
