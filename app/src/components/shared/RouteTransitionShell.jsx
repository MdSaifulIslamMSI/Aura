import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useMotionMode } from '@/context/MotionModeContext';

const RouteTransitionShell = ({ children }) => {
  const location = useLocation();
  const { effectiveMotionMode } = useMotionMode();
  const [active, setActive] = useState(true);
  const shouldAnimate = effectiveMotionMode === 'cinematic';
  const routeKey = `${location.pathname}${location.search}`;

  useEffect(() => {
    if (!shouldAnimate) {
      setActive(true);
      return undefined;
    }

    setActive(false);
    const raf = requestAnimationFrame(() => setActive(true));
    return () => cancelAnimationFrame(raf);
  }, [location.pathname, location.search, shouldAnimate]);

  return (
    <div
      className={cn(
        'aura-route-shell',
        `aura-route-shell-${effectiveMotionMode}`,
        active && 'aura-route-shell-active'
      )}
    >
      <div key={routeKey} className="contents">
        {children}
      </div>
    </div>
  );
};

export default RouteTransitionShell;
