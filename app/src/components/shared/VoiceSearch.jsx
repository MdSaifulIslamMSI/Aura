import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bot, Mic, MicOff, Volume2, VolumeX, X, Loader2, Send } from 'lucide-react';

const COMMAND_HINTS = [
  'Search for iPhone 15',
  'Open marketplace',
  'Go to cart',
  'Show laptops category',
  'Open orders',
  'Help',
];

const CATEGORY_ROUTES = [
  { aliases: ['mobiles', 'mobile', 'phone', 'smartphone'], slug: 'mobiles', label: 'Mobiles' },
  { aliases: ['laptops', 'laptop', 'notebook', 'macbook'], slug: 'laptops', label: 'Laptops' },
  { aliases: ['electronics', 'electronic', 'gadgets'], slug: 'electronics', label: 'Electronics' },
  { aliases: ['mens fashion', "men's fashion", 'mens'], slug: "men's-fashion", label: "Men's Fashion" },
  { aliases: ['womens fashion', "women's fashion", 'womens', "ladies' fashion"], slug: "women's-fashion", label: "Women's Fashion" },
  { aliases: ['home kitchen', 'home', 'kitchen'], slug: 'home-kitchen', label: 'Home & Kitchen' },
  { aliases: ['gaming', 'games', 'console'], slug: 'gaming', label: 'Gaming' },
  { aliases: ['books', 'book'], slug: 'books', label: 'Books' },
  { aliases: ['sports', 'sport', 'fitness'], slug: 'sports', label: 'Sports' },
];

const ROUTE_COMMANDS = [
  { aliases: ['home', 'homepage'], path: '/', label: 'Home' },
  { aliases: ['marketplace', 'market place'], path: '/marketplace', label: 'Marketplace' },
  { aliases: ['cart', 'bag'], path: '/cart', label: 'Cart' },
  { aliases: ['wishlist', 'favorites', 'favourites'], path: '/wishlist', label: 'Wishlist' },
  { aliases: ['orders', 'my orders'], path: '/orders', label: 'Orders' },
  { aliases: ['profile', 'account'], path: '/profile', label: 'Profile' },
  { aliases: ['sell', 'sell item'], path: '/sell', label: 'Sell' },
  { aliases: ['bundles', 'smart bundles'], path: '/bundles', label: 'Bundles' },
  { aliases: ['compare', 'ai compare'], path: '/compare', label: 'AI Compare' },
  { aliases: ['visual search', 'camera search'], path: '/visual-search', label: 'Visual Search' },
  { aliases: ['deals'], path: '/deals', label: 'Deals' },
  { aliases: ['trending'], path: '/trending', label: 'Trending' },
  { aliases: ['new arrivals', 'latest'], path: '/new-arrivals', label: 'New Arrivals' },
  { aliases: ['checkout'], path: '/checkout', label: 'Checkout' },
];

const normalizeText = (value = '') =>
  String(value)
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const findCategoryCommand = (normalized) => {
  for (const category of CATEGORY_ROUTES) {
    const hit = category.aliases.some((alias) => normalized.includes(alias));
    if (hit) {
      return category;
    }
  }
  return null;
};

const findRouteCommand = (normalized) => {
  for (const route of ROUTE_COMMANDS) {
    const hit = route.aliases.some((alias) => normalized.includes(alias));
    if (hit) {
      return route;
    }
  }
  return null;
};

const parseAssistantCommand = (rawText) => {
  const raw = String(rawText || '').trim();
  if (!raw) return { type: 'empty' };

  const normalized = normalizeText(raw);

  if (/\b(help|commands|what can you do)\b/.test(normalized)) {
    return {
      type: 'help',
      message:
        'Try saying search for iPhone fifteen, open cart, show laptops category, or open marketplace.',
    };
  }

  if (/\b(close|exit|cancel|stop)\b/.test(normalized)) {
    return { type: 'close', message: 'Closing voice assistant.' };
  }

  const productIdMatch = normalized.match(/\b(?:open|show)\s+(?:product|item)\s+(\d{4,})\b/);
  if (productIdMatch) {
    return {
      type: 'product',
      productId: productIdMatch[1],
      message: `Opening product ${productIdMatch[1]}.`,
    };
  }

  const categoryIntent = /\b(category|section|show)\b/.test(normalized)
    ? findCategoryCommand(normalized)
    : null;
  if (categoryIntent) {
    return {
      type: 'category',
      slug: categoryIntent.slug,
      message: `Opening ${categoryIntent.label} category.`,
    };
  }

  const searchMatch = raw.match(/^\s*(?:search(?:\s+for)?|find|look\s+for|show\s+me|buy)\s+(.+)$/i);
  if (searchMatch?.[1]?.trim()) {
    return {
      type: 'search',
      query: searchMatch[1].trim(),
      message: `Searching for ${searchMatch[1].trim()}.`,
    };
  }

  const explicitNavigate = /\b(open|go to|navigate to|take me to|show)\b/.test(normalized);
  if (explicitNavigate || ROUTE_COMMANDS.some((item) => item.aliases.includes(normalized))) {
    const route = findRouteCommand(normalized);
    if (route) {
      return {
        type: 'navigate',
        path: route.path,
        message: `Opening ${route.label}.`,
      };
    }
  }

  if (raw.length >= 2) {
    return {
      type: 'search',
      query: raw,
      message: `Searching for ${raw}.`,
    };
  }

  return {
    type: 'unknown',
    message: 'I could not understand that. Say help for examples.',
  };
};

const VoiceSearch = ({ onClose, onResult }) => {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [manualCommand, setManualCommand] = useState('');
  const [assistantReply, setAssistantReply] = useState('');
  const [error, setError] = useState('');
  const [speechEnabled, setSpeechEnabled] = useState(true);

  const recognitionRef = useRef(null);
  const transcriptRef = useRef('');
  const navigate = useNavigate();

  const browserSupportsSpeechRecognition =
    typeof window !== 'undefined' &&
    ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window);

  const speak = useCallback(
    (text) => {
      if (!speechEnabled || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
      const message = String(text || '').trim();
      if (!message) return;
      const utterance = new SpeechSynthesisUtterance(message);
      utterance.lang = 'en-IN';
      utterance.rate = 1;
      utterance.pitch = 1;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    },
    [speechEnabled]
  );

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    setIsListening(false);
  }, []);

  const executeCommand = useCallback(
    (rawInput) => {
      const command = parseAssistantCommand(rawInput);
      const reply = command.message || 'Done.';
      setAssistantReply(reply);
      setError('');
      speak(reply);

      if (command.type === 'help') return;
      if (command.type === 'close') {
        onClose?.();
        return;
      }

      if (command.type === 'product' && command.productId) {
        navigate(`/product/${command.productId}`);
        onClose?.();
        return;
      }

      if (command.type === 'category' && command.slug) {
        navigate(`/category/${command.slug}`);
        onClose?.();
        return;
      }

      if (command.type === 'navigate' && command.path) {
        navigate(command.path);
        onClose?.();
        return;
      }

      if (command.type === 'search' && command.query) {
        if (typeof onResult === 'function') {
          onResult(command.query);
        } else {
          navigate(`/search?q=${encodeURIComponent(command.query)}`);
        }
        onClose?.();
        return;
      }

      if (command.type === 'empty') {
        setAssistantReply('Say a command like search for iPhone fifteen.');
      }
    },
    [navigate, onClose, onResult, speak]
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
    recognition.lang = 'en-IN';
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
    startListening();
    return () => {
      recognitionRef.current?.abort();
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, [startListening]);

  return (
    <div
      className="fixed inset-0 z-[75] bg-black/70 backdrop-blur-md flex items-center justify-center p-4"
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
                <p className="text-xs sm:text-sm text-slate-400">Alexa-style command center for search + navigation</p>
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
                disabled={isListening}
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

                {assistantReply && !isListening && (
                  <div className="mt-3 rounded-lg border border-emerald-400/25 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">
                    {assistantReply}
                  </div>
                )}

                {error && (
                  <div className="mt-3 rounded-lg border border-rose-400/25 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
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
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
            <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400 mb-2">Voice Commands</div>
            <div className="flex flex-wrap gap-2">
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
