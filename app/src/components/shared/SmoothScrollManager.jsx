import { useEffect, useMemo, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useMotionMode } from '@/context/MotionModeContext';

const ENABLED_PREFIXES = [
  '/',
  '/products',
  '/category/',
  '/search',
  '/deals',
  '/trending',
  '/new-arrivals',
  '/marketplace',
  '/product/',
  '/visual-search',
  '/compare',
  '/bundles',
];

const isRouteEnabled = (pathname = '') => {
  if (pathname === '/') return true;
  return ENABLED_PREFIXES.some((prefix) => prefix !== '/' && pathname.startsWith(prefix));
};

const destroyLenis = (lenisRef, frameRef) => {
  if (frameRef.current) {
    cancelAnimationFrame(frameRef.current);
    frameRef.current = 0;
  }
  if (lenisRef.current) {
    lenisRef.current.destroy();
    lenisRef.current = null;
  }
  if (typeof window !== 'undefined') {
    window.__AURA_LENIS__ = null;
  }
};

const SmoothScrollManager = () => {
  const location = useLocation();
  const { effectiveMotionMode } = useMotionMode();
  const lenisRef = useRef(null);
  const frameRef = useRef(0);

  const routeEnabled = useMemo(() => isRouteEnabled(location.pathname), [location.pathname]);
  const lenisEnabled = import.meta.env.VITE_LENIS_ENABLED !== 'false';

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const html = document.documentElement;

    const modeAllowsLenis = effectiveMotionMode === 'cinematic';
    if (!lenisEnabled || !routeEnabled || !modeAllowsLenis) {
      destroyLenis(lenisRef, frameRef);
      html.dataset.smoothScroll = effectiveMotionMode === 'minimal' ? 'minimal' : 'native';
      return undefined;
    }

    const reducedMotionMedia = window.matchMedia('(prefers-reduced-motion: reduce)');
    const desktopMotionMedia = window.matchMedia('(min-width: 1024px) and (pointer: fine)');
    let cancelled = false;

    const boot = async () => {
      if (cancelled) return;
      if (!desktopMotionMedia.matches) {
        destroyLenis(lenisRef, frameRef);
        html.dataset.smoothScroll = 'native';
        return;
      }

      if (reducedMotionMedia.matches) {
        destroyLenis(lenisRef, frameRef);
        html.dataset.smoothScroll = 'reduced';
        return;
      }

      try {
        const mod = await import('lenis');
        if (cancelled) return;

        const Lenis = mod.default || mod.Lenis;
        if (!Lenis) {
          html.dataset.smoothScroll = 'native';
          return;
        }

        destroyLenis(lenisRef, frameRef);

        const lenis = new Lenis({
          duration: effectiveMotionMode === 'cinematic' ? 1.3 : 0.96,
          smoothWheel: true,
          wheelMultiplier: effectiveMotionMode === 'cinematic' ? 1.04 : 1,
          touchMultiplier: effectiveMotionMode === 'cinematic' ? 1.08 : 1.02,
          autoResize: true,
        });

        const tick = (time) => {
          if (!lenisRef.current) return;
          lenisRef.current.raf(time);
          frameRef.current = requestAnimationFrame(tick);
        };

        lenisRef.current = lenis;
        window.__AURA_LENIS__ = lenis;
        html.dataset.smoothScroll = 'lenis';
        frameRef.current = requestAnimationFrame(tick);
      } catch {
        destroyLenis(lenisRef, frameRef);
        html.dataset.smoothScroll = 'native';
      }
    };

    const syncLenisEligibility = () => {
      if (!desktopMotionMedia.matches) {
        destroyLenis(lenisRef, frameRef);
        html.dataset.smoothScroll = 'native';
        return;
      }

      if (reducedMotionMedia.matches) {
        destroyLenis(lenisRef, frameRef);
        html.dataset.smoothScroll = 'reduced';
        return;
      }

      boot();
    };

    if (typeof reducedMotionMedia.addEventListener === 'function') {
      reducedMotionMedia.addEventListener('change', syncLenisEligibility);
    } else {
      reducedMotionMedia.addListener(syncLenisEligibility);
    }

    if (typeof desktopMotionMedia.addEventListener === 'function') {
      desktopMotionMedia.addEventListener('change', syncLenisEligibility);
    } else {
      desktopMotionMedia.addListener(syncLenisEligibility);
    }

    syncLenisEligibility();

    return () => {
      cancelled = true;
      if (typeof reducedMotionMedia.removeEventListener === 'function') {
        reducedMotionMedia.removeEventListener('change', syncLenisEligibility);
      } else {
        reducedMotionMedia.removeListener(syncLenisEligibility);
      }
      if (typeof desktopMotionMedia.removeEventListener === 'function') {
        desktopMotionMedia.removeEventListener('change', syncLenisEligibility);
      } else {
        desktopMotionMedia.removeListener(syncLenisEligibility);
      }
      destroyLenis(lenisRef, frameRef);
      html.dataset.smoothScroll = 'native';
    };
  }, [effectiveMotionMode, lenisEnabled, routeEnabled]);

  return null;
};

export default SmoothScrollManager;
