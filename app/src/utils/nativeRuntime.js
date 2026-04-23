const hasWindow = () => typeof window !== 'undefined';

const getCapacitorBridge = () => (
  hasWindow() && window.Capacitor && typeof window.Capacitor === 'object'
    ? window.Capacitor
    : null
);

export const getNativeMobilePlatform = () => {
  const bridge = getCapacitorBridge();
  if (!bridge) return '';

  try {
    if (typeof bridge.getPlatform === 'function') {
      const platform = String(bridge.getPlatform() || '').trim().toLowerCase();
      if (platform === 'ios' || platform === 'android') {
        return platform;
      }
    }
  } catch {
    // Fall through to other signals.
  }

  return '';
};

export const isCapacitorNativeRuntime = () => {
  const bridge = getCapacitorBridge();
  if (!bridge) return false;

  try {
    if (typeof bridge.isNativePlatform === 'function') {
      return Boolean(bridge.isNativePlatform());
    }
  } catch {
    // Fall through to platform fallback.
  }

  return Boolean(getNativeMobilePlatform());
};

export default isCapacitorNativeRuntime;
