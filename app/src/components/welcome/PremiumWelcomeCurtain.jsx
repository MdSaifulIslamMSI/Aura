import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles, Volume2, VolumeX } from 'lucide-react';
import { StableText } from '@/i18n/StableText';
import { useStableIcuMessages } from '@/i18n/useStableIcuMessages';
import { playWelcomeCurtainChime } from './welcomeSound';

export const WELCOME_CURTAIN_SEEN_KEY = 'aura.welcomeCurtain.seen';
export const WELCOME_CURTAIN_SOUND_MUTED_KEY = 'aura.welcomeCurtain.soundMuted';

const MESSAGE_COUNT = 3;
const AUTO_CLOSE_MS = 3200;
const TEXT_ROTATION_MS = 880;
const EXIT_ANIMATION_MS = 260;
const SOUND_CONTROL_SELECTOR = '[data-welcome-sound-control="true"]';

const disabledFlagValues = new Set(['0', 'false', 'no', 'off', 'disabled']);
const enabledFlagValues = new Set(['1', 'true', 'yes', 'on', 'enabled']);

const hasBrowserWindow = () => typeof window !== 'undefined';

const sharedGlassControlStyle = {
  border: '1px solid rgba(255, 250, 240, 0.34)',
  borderRadius: 8,
  background: 'rgba(255, 250, 240, 0.1)',
  color: '#fffaf0',
  boxShadow: '0 18px 44px rgba(0, 0, 0, 0.22)',
};

const buildCurtainStyle = ({ isClosing, isCompactViewport, reducedMotion }) => ({
  position: 'fixed',
  inset: 0,
  zIndex: 10000,
  display: 'grid',
  placeItems: 'center',
  width: '100vw',
  height: '100dvh',
  minHeight: '100vh',
  padding: isCompactViewport ? '1.25rem' : 'clamp(1rem, 4vw, 3rem)',
  overflow: 'hidden',
  color: '#fffaf0',
  fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  background: 'linear-gradient(120deg, #030712, #421622 35%, #064e3b 70%, #6b3f12)',
  backgroundSize: '170% 170%',
  isolation: 'isolate',
  opacity: isClosing ? 0 : 1,
  transform: isClosing ? 'scale(1.01)' : 'scale(1)',
  pointerEvents: isClosing ? 'none' : undefined,
  transition: reducedMotion ? 'opacity 1ms ease' : 'opacity 260ms ease, transform 260ms ease',
});

const buildPanelStyle = ({ isCurtainOpen, reducedMotion, side }) => ({
  position: 'absolute',
  insetBlock: 0,
  [side]: 0,
  zIndex: 0,
  width: '51%',
  background: 'linear-gradient(140deg, #150915, #5b2434 42%, #b7791f 72%, #064e3b)',
  boxShadow: 'inset 0 0 72px rgba(255, 236, 179, 0.14)',
  opacity: reducedMotion ? 0 : 1,
  transform: reducedMotion || !isCurtainOpen
    ? 'translateX(0)'
    : `translateX(${side === 'left' ? '-103%' : '103%'})`,
  transition: reducedMotion ? 'opacity 1ms ease' : 'transform 3150ms cubic-bezier(.16, 1, .3, 1)',
});

const parseEnvFlag = (value, defaultValue) => {
  if (value === undefined || value === null) {
    return defaultValue;
  }

  const normalizedValue = String(value).trim().toLowerCase();
  if (!normalizedValue) {
    return defaultValue;
  }

  if (disabledFlagValues.has(normalizedValue)) {
    return false;
  }

  if (enabledFlagValues.has(normalizedValue)) {
    return true;
  }

  return defaultValue;
};

export const isWelcomeCurtainEnabled = (env = import.meta.env) => (
  parseEnvFlag(env?.VITE_WELCOME_CURTAIN_ENABLED, Boolean(env?.PROD))
);

export const isWelcomeCurtainSoundEnabled = (env = import.meta.env) => (
  parseEnvFlag(env?.VITE_WELCOME_CURTAIN_SOUND_ENABLED, true)
);

const safeReadStorage = (storageName, key) => {
  if (!hasBrowserWindow()) {
    return null;
  }

  try {
    return window[storageName]?.getItem(key) ?? null;
  } catch {
    return null;
  }
};

const safeWriteStorage = (storageName, key, value) => {
  if (!hasBrowserWindow()) {
    return;
  }

  try {
    window[storageName]?.setItem(key, value);
  } catch {
    // Storage can be blocked in strict privacy contexts. The curtain should still close.
  }
};

const hasSeenCurtainThisSession = () => (
  safeReadStorage('sessionStorage', WELCOME_CURTAIN_SEEN_KEY) === 'true'
);

const readSoundMutedPreference = () => (
  safeReadStorage('localStorage', WELCOME_CURTAIN_SOUND_MUTED_KEY) === 'true'
);

const readReducedMotionPreference = () => {
  if (!hasBrowserWindow() || typeof window.matchMedia !== 'function') {
    return false;
  }

  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

const readCompactViewportPreference = () => {
  if (!hasBrowserWindow() || typeof window.matchMedia !== 'function') {
    return false;
  }

  try {
    return window.matchMedia('(max-width: 640px)').matches;
  } catch {
    return false;
  }
};

const shouldRenderCurtain = () => (
  hasBrowserWindow()
  && isWelcomeCurtainEnabled()
  && !hasSeenCurtainThisSession()
);

const isSoundControlInteraction = (event) => {
  const target = event?.target;
  return Boolean(typeof target?.closest === 'function' && target.closest(SOUND_CONTROL_SELECTOR));
};

export default function PremiumWelcomeCurtain() {
  const t = useStableIcuMessages();
  const [isVisible, setIsVisible] = useState(shouldRenderCurtain);
  const [isClosing, setIsClosing] = useState(false);
  const [isCurtainOpen, setIsCurtainOpen] = useState(false);
  const [currentMessageIndex, setCurrentMessageIndex] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(readReducedMotionPreference);
  const [isCompactViewport, setIsCompactViewport] = useState(readCompactViewportPreference);
  const [soundMuted, setSoundMuted] = useState(readSoundMutedPreference);
  const skipButtonRef = useRef(null);
  const previousFocusRef = useRef(null);
  const closeTimeoutRef = useRef(null);
  const hasClosedRef = useRef(false);
  const hasHandledSoundGestureRef = useRef(false);

  const soundEnabled = useMemo(
    () => isWelcomeCurtainSoundEnabled() && !reducedMotion,
    [reducedMotion]
  );

  const curtainStyle = useMemo(
    () => buildCurtainStyle({ isClosing, isCompactViewport, reducedMotion }),
    [isClosing, isCompactViewport, reducedMotion]
  );

  const leftPanelStyle = useMemo(
    () => buildPanelStyle({ isCurtainOpen, reducedMotion, side: 'left' }),
    [isCurtainOpen, reducedMotion]
  );

  const rightPanelStyle = useMemo(
    () => buildPanelStyle({ isCurtainOpen, reducedMotion, side: 'right' }),
    [isCurtainOpen, reducedMotion]
  );

  const restoreFocus = useCallback(() => {
    if (typeof document === 'undefined') {
      return;
    }

    const previousFocus = previousFocusRef.current;
    if (
      previousFocus
      && previousFocus !== document.body
      && typeof previousFocus.focus === 'function'
      && document.contains(previousFocus)
    ) {
      previousFocus.focus({ preventScroll: true });
    }
  }, []);

  const closeCurtain = useCallback(() => {
    if (hasClosedRef.current) {
      return;
    }

    hasClosedRef.current = true;
    safeWriteStorage('sessionStorage', WELCOME_CURTAIN_SEEN_KEY, 'true');
    setIsClosing(true);

    const finishClose = () => {
      setIsVisible(false);
      restoreFocus();
    };

    if (!hasBrowserWindow() || reducedMotion) {
      finishClose();
      return;
    }

    closeTimeoutRef.current = window.setTimeout(finishClose, EXIT_ANIMATION_MS);
  }, [reducedMotion, restoreFocus]);

  const requestSound = useCallback((event) => {
    if (
      !soundEnabled
      || soundMuted
      || reducedMotion
      || hasHandledSoundGestureRef.current
      || isSoundControlInteraction(event)
    ) {
      return;
    }

    hasHandledSoundGestureRef.current = true;
    Promise.resolve(playWelcomeCurtainChime()).catch(() => {});
  }, [reducedMotion, soundEnabled, soundMuted]);

  const toggleSoundMuted = useCallback(() => {
    setSoundMuted((currentValue) => {
      const nextValue = !currentValue;
      safeWriteStorage('localStorage', WELCOME_CURTAIN_SOUND_MUTED_KEY, String(nextValue));
      return nextValue;
    });
  }, []);

  useEffect(() => {
    if (!isVisible || !hasBrowserWindow() || typeof window.matchMedia !== 'function') {
      return undefined;
    }

    let mediaQuery;
    try {
      mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    } catch {
      return undefined;
    }

    const handleMotionPreferenceChange = () => {
      setReducedMotion(Boolean(mediaQuery.matches));
    };

    handleMotionPreferenceChange();

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleMotionPreferenceChange);
    } else if (typeof mediaQuery.addListener === 'function') {
      mediaQuery.addListener(handleMotionPreferenceChange);
    }

    return () => {
      if (typeof mediaQuery.removeEventListener === 'function') {
        mediaQuery.removeEventListener('change', handleMotionPreferenceChange);
      } else if (typeof mediaQuery.removeListener === 'function') {
        mediaQuery.removeListener(handleMotionPreferenceChange);
      }
    };
  }, [isVisible]);

  useEffect(() => {
    if (!isVisible || !hasBrowserWindow() || typeof window.matchMedia !== 'function') {
      return undefined;
    }

    let mediaQuery;
    try {
      mediaQuery = window.matchMedia('(max-width: 640px)');
    } catch {
      return undefined;
    }

    const handleViewportPreferenceChange = () => {
      setIsCompactViewport(Boolean(mediaQuery.matches));
    };

    handleViewportPreferenceChange();

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleViewportPreferenceChange);
    } else if (typeof mediaQuery.addListener === 'function') {
      mediaQuery.addListener(handleViewportPreferenceChange);
    }

    return () => {
      if (typeof mediaQuery.removeEventListener === 'function') {
        mediaQuery.removeEventListener('change', handleViewportPreferenceChange);
      } else if (typeof mediaQuery.removeListener === 'function') {
        mediaQuery.removeListener(handleViewportPreferenceChange);
      }
    };
  }, [isVisible]);

  useEffect(() => {
    if (!isVisible) {
      return undefined;
    }

    setIsCurtainOpen(false);

    if (!hasBrowserWindow() || reducedMotion) {
      setIsCurtainOpen(true);
      return undefined;
    }

    const frameId = window.requestAnimationFrame(() => {
      setIsCurtainOpen(true);
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [isVisible, reducedMotion]);

  useEffect(() => {
    if (!isVisible || typeof document === 'undefined') {
      return undefined;
    }

    previousFocusRef.current = document.activeElement;
    const focusTimer = window.setTimeout(() => {
      skipButtonRef.current?.focus({ preventScroll: true });
    }, 0);

    return () => {
      window.clearTimeout(focusTimer);
    };
  }, [isVisible]);

  useEffect(() => {
    if (!isVisible) {
      return undefined;
    }

    setCurrentMessageIndex(0);
    const intervalId = window.setInterval(() => {
      setCurrentMessageIndex((currentIndex) => Math.min(currentIndex + 1, MESSAGE_COUNT - 1));
    }, TEXT_ROTATION_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isVisible]);

  useEffect(() => {
    if (!isVisible) {
      return undefined;
    }

    const autoCloseTimer = window.setTimeout(closeCurtain, reducedMotion ? 2600 : AUTO_CLOSE_MS);
    return () => {
      window.clearTimeout(autoCloseTimer);
    };
  }, [closeCurtain, isVisible, reducedMotion]);

  useEffect(() => {
    if (!isVisible) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeCurtain();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [closeCurtain, isVisible]);

  useEffect(() => (
    () => {
      if (closeTimeoutRef.current) {
        window.clearTimeout(closeTimeoutRef.current);
      }
    }
  ), []);

  if (!isVisible) {
    return null;
  }

  const welcomeAriaLabel = t('welcomeCurtain.ariaLabel', {}, 'Welcome to Aura');
  const soundLabel = soundMuted || !soundEnabled
    ? t('welcomeCurtain.soundOff', {}, 'Sound off')
    : t('welcomeCurtain.soundOn', {}, 'Sound on');
  const SoundIcon = soundMuted || !soundEnabled ? VolumeX : Volume2;
  const messageSequence = [
    <StableText key="welcome" id="welcomeCurtain.message.welcome" defaultMessage="Welcome to Aura" />,
    <StableText key="thanks" id="welcomeCurtain.message.thanks" defaultMessage="Thanks for visiting" />,
    <StableText key="ready" id="welcomeCurtain.message.ready" defaultMessage="Your premium experience is ready" />,
  ];

  return (
    <div
      className={[
        'aura-welcome-curtain',
        isClosing ? 'is-closing' : '',
        reducedMotion ? 'is-reduced-motion' : '',
      ].filter(Boolean).join(' ')}
      data-testid="premium-welcome-curtain"
      role="dialog"
      aria-modal="true"
      aria-label={welcomeAriaLabel}
      style={curtainStyle}
      onPointerDown={requestSound}
    >
      <div
        className="aura-welcome-curtain__wash"
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 1,
          background: 'linear-gradient(90deg, transparent, rgba(255, 232, 179, 0.16), transparent)',
          mixBlendMode: 'screen',
          pointerEvents: 'none',
        }}
      />
      <div
        className="aura-welcome-curtain__panel aura-welcome-curtain__panel--left"
        aria-hidden="true"
        style={leftPanelStyle}
      />
      <div
        className="aura-welcome-curtain__panel aura-welcome-curtain__panel--right"
        aria-hidden="true"
        style={rightPanelStyle}
      />
      <div
        className="aura-welcome-curtain__controls"
        style={{
          position: 'absolute',
          top: isCompactViewport ? '1rem' : '1.5rem',
          right: isCompactViewport ? '1rem' : '1.5rem',
          zIndex: 3,
          display: 'flex',
          gap: '0.55rem',
        }}
      >
        <button
          ref={skipButtonRef}
          type="button"
          className="aura-welcome-curtain__skip"
          style={{
            ...sharedGlassControlStyle,
            minWidth: '4.6rem',
            minHeight: '2.5rem',
            padding: '0.55rem 0.9rem',
            fontWeight: 700,
          }}
          onClick={closeCurtain}
        >
          <StableText id="welcomeCurtain.action.skip" defaultMessage="Skip" />
        </button>
        <button
          type="button"
          className="aura-welcome-curtain__sound"
          aria-label={soundLabel}
          aria-pressed={!soundMuted && soundEnabled}
          title={soundLabel}
          data-welcome-sound-control="true"
          disabled={!isWelcomeCurtainSoundEnabled()}
          style={{
            ...sharedGlassControlStyle,
            display: 'grid',
            placeItems: 'center',
            width: '2.5rem',
            height: '2.5rem',
            opacity: isWelcomeCurtainSoundEnabled() ? 1 : 0.62,
            cursor: isWelcomeCurtainSoundEnabled() ? 'pointer' : 'not-allowed',
          }}
          onClick={toggleSoundMuted}
        >
          <SoundIcon aria-hidden="true" size={17} strokeWidth={2.1} />
          <span className="sr-only">{soundLabel}</span>
        </button>
      </div>
      <div
        className="aura-welcome-curtain__content"
        style={{
          zIndex: 2,
          display: 'grid',
          justifyItems: 'center',
          width: 'min(100%, 58rem)',
          textAlign: 'center',
          textShadow: '0 12px 52px rgba(0, 0, 0, 0.42)',
          opacity: isCurtainOpen || reducedMotion ? 1 : 0,
          transform: isCurtainOpen || reducedMotion ? 'translateY(0)' : 'translateY(14px)',
          transition: reducedMotion ? 'opacity 1ms ease' : 'opacity 780ms ease-out, transform 780ms ease-out',
        }}
      >
        <div
          className="aura-welcome-curtain__brand"
          style={{
            ...sharedGlassControlStyle,
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.55rem',
            minHeight: '2.5rem',
            padding: '0.45rem 0.75rem',
            color: '#fde68a',
            fontWeight: 800,
          }}
        >
          <Sparkles aria-hidden="true" size={20} strokeWidth={1.9} />
          <span>Aura</span>
        </div>
        <p
          className="aura-welcome-curtain__kicker"
          style={{
            margin: `${isCompactViewport ? '1.1rem' : '1.55rem'} 0 0`,
            color: '#d1fae5',
            fontSize: isCompactViewport ? '0.88rem' : '1rem',
            fontWeight: 700,
          }}
        >
          <StableText id="welcomeCurtain.kicker" defaultMessage="Secured. Fast. Premium." />
        </p>
        <h1
          className="aura-welcome-curtain__message"
          data-testid="premium-welcome-curtain-message"
          style={{
            maxWidth: isCompactViewport ? '11ch' : '13ch',
            margin: `${isCompactViewport ? '0.65rem' : '0.9rem'} 0 0`,
            fontSize: isCompactViewport ? '2.75rem' : '5.85rem',
            fontWeight: 900,
            lineHeight: 0.95,
            textWrap: 'balance',
          }}
        >
          {messageSequence[currentMessageIndex]}
        </h1>
        <p
          className="aura-welcome-curtain__subcopy"
          style={{
            maxWidth: '31rem',
            margin: `${isCompactViewport ? '1rem' : '1.4rem'} 0 0`,
            color: 'rgba(255, 250, 240, 0.84)',
            fontSize: isCompactViewport ? '0.96rem' : '1.08rem',
            fontWeight: 600,
            lineHeight: 1.6,
          }}
        >
          <StableText
            id="welcomeCurtain.subcopy"
            defaultMessage="A polished marketplace session is ready for you."
          />
        </p>
      </div>
    </div>
  );
}
