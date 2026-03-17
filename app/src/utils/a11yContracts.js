const isDevelopment = import.meta.env.DEV;

export function assertRouteA11yContracts(pathname) {
  if (!isDevelopment || typeof document === 'undefined') {
    return;
  }

  const mainCount = document.querySelectorAll('main').length;
  const h1Count = document.querySelectorAll('h1').length;

  if (mainCount !== 1 || h1Count < 1) {
    console.warn(
      `[a11y-contract] Route "${pathname}" violates heading landmarks: main=${mainCount}, h1=${h1Count}`
    );
  }
}
