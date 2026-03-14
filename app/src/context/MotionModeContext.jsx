import { createContext, useContext, useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'aura_motion_mode';
const MODES = ['cinematic', 'balanced', 'minimal'];
const DEFAULT_MODE = 'balanced';

const MotionModeContext = createContext(null);

const isBrowser = typeof window !== 'undefined';

const getInitialMode = () => {
  if (!isBrowser) return DEFAULT_MODE;
  const saved = window.localStorage.getItem(STORAGE_KEY);
  return MODES.includes(saved) ? saved : DEFAULT_MODE;
};

const readDeviceProfile = () => {
  if (!isBrowser) {
    return {
      reducedMotion: false,
      saveData: false,
      effectiveType: 'unknown',
      memoryGb: 0,
      cores: 0,
      tier: 'normal',
    };
  }

  const nav = window.navigator || {};
  const connection = nav.connection || nav.mozConnection || nav.webkitConnection;
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false;
  const saveData = Boolean(connection?.saveData);
  const effectiveType = connection?.effectiveType || 'unknown';
  const memoryGb = Number(nav.deviceMemory || 0);
  const cores = Number(nav.hardwareConcurrency || 0);

  const lowNetwork = /(?:2g|slow-2g)/i.test(effectiveType);
  const constrainedNetwork = /3g/i.test(effectiveType);
  const severe =
    reducedMotion ||
    saveData ||
    lowNetwork ||
    (memoryGb > 0 && memoryGb <= 2) ||
    (cores > 0 && cores <= 2);
  const constrained =
    constrainedNetwork ||
    (memoryGb > 0 && memoryGb <= 4) ||
    (cores > 0 && cores <= 4);

  return {
    reducedMotion,
    saveData,
    effectiveType,
    memoryGb,
    cores,
    tier: severe ? 'severe' : constrained ? 'constrained' : 'normal',
  };
};

export const MOTION_MODE_OPTIONS = [
  { value: 'cinematic', label: 'Cinematic' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'minimal', label: 'Minimal' },
];

export function MotionModeProvider({ children }) {
  const [motionMode, setMotionModeState] = useState(getInitialMode);
  const [deviceProfile, setDeviceProfile] = useState(readDeviceProfile);

  const setMotionMode = (mode) => {
    if (!MODES.includes(mode)) return;
    setMotionModeState(mode);
  };

  useEffect(() => {
    if (!isBrowser) return;
    window.localStorage.setItem(STORAGE_KEY, motionMode);
  }, [motionMode]);

  useEffect(() => {
    if (!isBrowser) return undefined;

    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const connection = window.navigator?.connection;

    const onChange = () => setDeviceProfile(readDeviceProfile());

    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', onChange);
    } else {
      media.addListener(onChange);
    }

    if (connection && typeof connection.addEventListener === 'function') {
      connection.addEventListener('change', onChange);
    }

    window.addEventListener('online', onChange);
    window.addEventListener('offline', onChange);

    return () => {
      if (typeof media.removeEventListener === 'function') {
        media.removeEventListener('change', onChange);
      } else {
        media.removeListener(onChange);
      }
      if (connection && typeof connection.removeEventListener === 'function') {
        connection.removeEventListener('change', onChange);
      }
      window.removeEventListener('online', onChange);
      window.removeEventListener('offline', onChange);
    };
  }, []);

  const effectiveMotionMode = useMemo(() => {
    if (deviceProfile.reducedMotion) return 'minimal';
    if (motionMode === 'minimal') return 'minimal';

    const severe = deviceProfile.tier === 'severe';
    const constrained = deviceProfile.tier === 'constrained';

    if (severe) return 'minimal';
    if (constrained && motionMode === 'cinematic') return 'balanced';
    return motionMode;
  }, [deviceProfile.reducedMotion, deviceProfile.tier, motionMode]);

  const autoDowngraded = effectiveMotionMode !== motionMode;

  useEffect(() => {
    if (!isBrowser) return;
    const html = document.documentElement;
    html.setAttribute('data-motion-mode', motionMode);
    html.setAttribute('data-motion-effective', effectiveMotionMode);
    html.setAttribute('data-motion-auto', autoDowngraded ? '1' : '0');
  }, [autoDowngraded, effectiveMotionMode, motionMode]);

  const value = useMemo(
    () => ({
      motionMode,
      setMotionMode,
      motionModeOptions: MOTION_MODE_OPTIONS,
      effectiveMotionMode,
      autoDowngraded,
      performanceProfile: {
        deviceTier: deviceProfile.tier,
        runtimeTier: 'disabled',
        reducedMotion: deviceProfile.reducedMotion,
        saveData: deviceProfile.saveData,
      },
      cycleMotionMode: () => {
        setMotionModeState((prev) => {
          const currentIndex = MODES.indexOf(prev);
          return MODES[(currentIndex + 1) % MODES.length];
        });
      },
    }),
    [
      autoDowngraded,
      deviceProfile.reducedMotion,
      deviceProfile.saveData,
      deviceProfile.tier,
      effectiveMotionMode,
      motionMode,
    ]
  );

  return <MotionModeContext.Provider value={value}>{children}</MotionModeContext.Provider>;
}

export function useMotionMode() {
  const context = useContext(MotionModeContext);
  if (!context) {
    throw new Error('useMotionMode must be used inside MotionModeProvider');
  }
  return context;
}
