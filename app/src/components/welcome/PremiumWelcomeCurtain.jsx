import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles, Volume2, VolumeX } from 'lucide-react';
import { playWelcomeCurtainChime } from './welcomeSound';
import './PremiumWelcomeCurtain.css';

export const WELCOME_CURTAIN_SEEN_KEY = 'aura.welcomeCurtain.seen';
export const WELCOME_CURTAIN_SOUND_MUTED_KEY = 'aura.welcomeCurtain.soundMuted';

const COPY_SEQUENCE = [
  'Welcome to Aura',
  'Thanks for visiting',
  'Your premium experience is ready',
];

const AUTO_CLOSE_MS = 3200;
const TEXT_ROTATION_MS = 880;
const EXIT_ANIMATION_MS = 260;
const SOUND_CONTROL_SELECTOR = '[data-welcome-sound-control="true"]';

const disabledFlagValues = new Set(['0', 'false', 'no', 'off', 'disabled']);
const enabledFlagValues = new Set(['1', 'true', 'yes', 'on', 'enabled']);

const hasBrowserWindow = () => typeof window !== 'undefined';

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
  const [isVisible, setIsVisible] = useState(shouldRenderCurtain);
  const [isClosing, setIsClosing] = useState(false);
  const [currentMessageIndex, setCurrentMessageIndex] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(readReducedMotionPreference);
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
      setCurrentMessageIndex((currentIndex) => Math.min(currentIndex + 1, COPY_SEQUENCE.length - 1));
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

  const soundLabel = soundMuted || !soundEnabled ? 'Sound off' : 'Sound on';
  const SoundIcon = soundMuted || !soundEnabled ? VolumeX : Volume2;

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
      aria-label="Welcome to Aura"
      onPointerDown={requestSound}
    >
      <div className="aura-welcome-curtain__wash" aria-hidden="true" />
      <div className="aura-welcome-curtain__panel aura-welcome-curtain__panel--left" aria-hidden="true" />
      <div className="aura-welcome-curtain__panel aura-welcome-curtain__panel--right" aria-hidden="true" />
      <div className="aura-welcome-curtain__controls">
        <button
          ref={skipButtonRef}
          type="button"
          className="aura-welcome-curtain__skip"
          onClick={closeCurtain}
        >
          Skip
        </button>
        <button
          type="button"
          className="aura-welcome-curtain__sound"
          aria-label={soundLabel}
          aria-pressed={!soundMuted && soundEnabled}
          title={soundLabel}
          data-welcome-sound-control="true"
          disabled={!isWelcomeCurtainSoundEnabled()}
          onClick={toggleSoundMuted}
        >
          <SoundIcon aria-hidden="true" size={17} strokeWidth={2.1} />
          <span className="aura-welcome-curtain__sr-only">{soundLabel}</span>
        </button>
      </div>
      <div className="aura-welcome-curtain__content">
        <div className="aura-welcome-curtain__brand">
          <Sparkles aria-hidden="true" size={20} strokeWidth={1.9} />
          <span>Aura</span>
        </div>
        <p className="aura-welcome-curtain__kicker">Secured. Fast. Premium.</p>
        <h1 className="aura-welcome-curtain__message" data-testid="premium-welcome-curtain-message">
          {COPY_SEQUENCE[currentMessageIndex]}
        </h1>
        <p className="aura-welcome-curtain__subcopy">
          A polished marketplace session is ready for you.
        </p>
      </div>
    </div>
  );
}
