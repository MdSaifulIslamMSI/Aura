import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useMotionMode } from '@/context/MotionModeContext';

const RouteTransitionShell = ({ children }) => {
  const location = useLocation();
  const { effectiveMotionMode } = useMotionMode();
  const [active, setActive] = useState(false);

  useEffect(() => {
    setActive(false);
    const raf = requestAnimationFrame(() => setActive(true));
    return () => cancelAnimationFrame(raf);
  }, [location.pathname, location.search, effectiveMotionMode]);

  return (
    <div
      className={cn(
        'aura-route-shell',
        `aura-route-shell-${effectiveMotionMode}`,
        active && 'aura-route-shell-active'
      )}
    >
      {children}
    </div>
  );
};

export default RouteTransitionShell;
