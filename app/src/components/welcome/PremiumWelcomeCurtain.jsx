import { useCallback, useEffect, useRef, useState } from 'react';
import { Sparkles, Volume2, VolumeX } from 'lucide-react';
import { StableText } from '@/i18n/StableText';
import { useStableIcuMessages } from '@/i18n/useStableIcuMessages';
import { useMotionMode } from '@/context/MotionModeContext';
import { playWelcomeCurtainChime } from './welcomeSound';
import './PremiumWelcomeCurtain.css';

export const WELCOME_CURTAIN_SEEN_KEY = 'aura.welcomeCurtain.seen';
export const WELCOME_CURTAIN_SOUND_MUTED_KEY = 'aura.welcomeCurtain.soundMuted';

const AUTO_CLOSE_MS = 1800;
const STATIC_MOTION_AUTO_CLOSE_MS = 700;
const EXIT_ANIMATION_MS = 260;

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

const hasSeenCurtain = () => (
  safeReadStorage('localStorage', WELCOME_CURTAIN_SEEN_KEY) === 'true'
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
  && !hasSeenCurtain()
);

export default function PremiumWelcomeCurtain() {
  const t = useStableIcuMessages();
  const { effectiveMotionMode } = useMotionMode();
  const [isVisible, setIsVisible] = useState(shouldRenderCurtain);
  const [isClosing, setIsClosing] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(readReducedMotionPreference);
  const [soundMuted, setSoundMuted] = useState(readSoundMutedPreference);
  const skipButtonRef = useRef(null);
  const previousFocusRef = useRef(null);
  const closeTimeoutRef = useRef(null);
  const hasClosedRef = useRef(false);

  const prefersStaticMotion = reducedMotion || effectiveMotionMode === 'minimal';

  const soundEnabled = isWelcomeCurtainSoundEnabled() && !prefersStaticMotion;

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
    safeWriteStorage('localStorage', WELCOME_CURTAIN_SEEN_KEY, 'true');
    setIsClosing(true);

    const finishClose = () => {
      setIsVisible(false);
      restoreFocus();
    };

    if (!hasBrowserWindow() || prefersStaticMotion) {
      finishClose();
      return;
    }

    closeTimeoutRef.current = window.setTimeout(finishClose, EXIT_ANIMATION_MS);
  }, [prefersStaticMotion, restoreFocus]);

  const toggleSoundMuted = useCallback(() => {
    const nextValue = !soundMuted;
    setSoundMuted(nextValue);
    safeWriteStorage('localStorage', WELCOME_CURTAIN_SOUND_MUTED_KEY, String(nextValue));

    // Unmuting is an explicit user gesture, so the chime can legally play here.
    if (!nextValue && soundEnabled) {
      Promise.resolve(playWelcomeCurtainChime()).catch(() => {});
    }
  }, [soundEnabled, soundMuted]);

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

    const autoCloseTimer = window.setTimeout(
      closeCurtain,
      prefersStaticMotion ? STATIC_MOTION_AUTO_CLOSE_MS : AUTO_CLOSE_MS
    );
    return () => {
      window.clearTimeout(autoCloseTimer);
    };
  }, [closeCurtain, isVisible, prefersStaticMotion]);

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

  return (
    <div
      className={[
        'aura-welcome-curtain',
        isClosing ? 'is-closing' : '',
        prefersStaticMotion ? 'is-reduced-motion' : '',
      ].filter(Boolean).join(' ')}
      data-testid="premium-welcome-curtain"
      role="dialog"
      aria-modal="true"
      aria-label={welcomeAriaLabel}
    >
      <div className="aura-welcome-curtain__ribbon" aria-hidden="true" />
      <div className="aura-welcome-curtain__halo" aria-hidden="true" />
      <div className="aura-welcome-curtain__controls">
        <button
          ref={skipButtonRef}
          type="button"
          className="aura-welcome-curtain__control"
          onClick={closeCurtain}
        >
          <StableText id="welcomeCurtain.action.skip" defaultMessage="Skip" />
        </button>
        <button
          type="button"
          className="aura-welcome-curtain__control aura-welcome-curtain__control--icon"
          aria-label={soundLabel}
          aria-pressed={!soundMuted && soundEnabled}
          title={soundLabel}
          data-welcome-sound-control="true"
          disabled={!isWelcomeCurtainSoundEnabled()}
          onClick={toggleSoundMuted}
        >
          <SoundIcon aria-hidden="true" size={17} strokeWidth={2.1} />
          <span className="sr-only">{soundLabel}</span>
        </button>
      </div>
      <div className="aura-welcome-curtain__card">
        <div className="aura-welcome-curtain__brand">
          <Sparkles aria-hidden="true" size={16} strokeWidth={2} />
          <span>Aura</span>
        </div>
        <p className="aura-welcome-curtain__kicker">
          <StableText id="welcomeCurtain.kicker" defaultMessage="Secured. Fast. Premium." />
        </p>
        <h1
          className="aura-welcome-curtain__headline"
          data-testid="premium-welcome-curtain-message"
        >
          <StableText id="welcomeCurtain.message.welcome" defaultMessage="Welcome to Aura" />
        </h1>
        <p className="aura-welcome-curtain__subcopy">
          <StableText
            id="welcomeCurtain.subcopy"
            defaultMessage="A polished marketplace session is ready for you."
          />
        </p>
        <div className="aura-welcome-curtain__progress" aria-hidden="true">
          <span className="aura-welcome-curtain__progress-sweep" />
        </div>
      </div>
    </div>
  );
}
