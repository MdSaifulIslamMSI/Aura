import { useEffect, useMemo } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

const STORAGE_KEY = 'aura_scroll_memory_v1';

const isBrowser = typeof window !== 'undefined';
const memory = new Map();

const getRouteKey = (pathname = '', search = '') => `${pathname || ''}${search || ''}`;

const loadMemory = () => {
  if (!isBrowser) return;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    const parsed = JSON.parse(raw || '{}');
    Object.entries(parsed || {}).forEach(([key, value]) => {
      if (typeof value === 'number' && Number.isFinite(value)) {
        memory.set(key, Math.max(0, value));
      }
    });
  } catch {
    // ignore read failures
  }
};

const persistMemory = () => {
  if (!isBrowser) return;
  try {
    const serializable = Object.fromEntries(memory.entries());
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(serializable));
  } catch {
    // ignore storage write failures
  }
};

const getCurrentScrollY = () => {
  if (!isBrowser) return 0;
  const lenis = window.__AURA_LENIS__;
  if (lenis && Number.isFinite(lenis.scroll)) {
    return Math.max(0, Number(lenis.scroll));
  }
  return Math.max(0, window.scrollY || window.pageYOffset || 0);
};

const scrollToY = (top = 0) => {
  if (!isBrowser) return;
  const target = Math.max(0, Number(top) || 0);
  const lenis = window.__AURA_LENIS__;
  if (lenis && typeof lenis.scrollTo === 'function') {
    lenis.scrollTo(target, { immediate: true });
    return;
  }
  window.scrollTo(0, target);
};

if (isBrowser && memory.size === 0) {
  loadMemory();
}

const ScrollToTop = () => {
  const location = useLocation();
  const navigationType = useNavigationType();
  const routeKey = useMemo(
    () => getRouteKey(location.pathname, location.search),
    [location.pathname, location.search]
  );

  useEffect(() => {
    if (!isBrowser) return undefined;

    let frameId = 0;
    const capture = () => {
      memory.set(routeKey, getCurrentScrollY());
      persistMemory();
      frameId = 0;
    };

    const onScroll = () => {
      if (frameId) return;
      frameId = window.requestAnimationFrame(capture);
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
      memory.set(routeKey, getCurrentScrollY());
      persistMemory();
    };
  }, [routeKey]);

  useEffect(() => {
    if (!isBrowser) return;

    const rememberedY = memory.get(routeKey);
    if (navigationType === 'POP' && Number.isFinite(rememberedY)) {
      scrollToY(rememberedY);
      return;
    }

    scrollToY(0);
  }, [navigationType, routeKey]);

  return null;
};

export default ScrollToTop;
