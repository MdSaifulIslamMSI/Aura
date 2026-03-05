import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useMotionMode } from '@/context/MotionModeContext';

const computeProgress = () => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return 0;
  const scrollTop = window.scrollY || window.pageYOffset || 0;
  const doc = document.documentElement;
  const track = Math.max((doc.scrollHeight || 0) - window.innerHeight, 1);
  return Math.min(1, Math.max(0, scrollTop / track));
};

const ScrollProgressBar = () => {
  const location = useLocation();
  const { effectiveMotionMode } = useMotionMode();
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    let ticking = false;
    const update = () => {
      setProgress(computeProgress());
      ticking = false;
    };

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    };

    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [location.pathname, location.search]);

  return (
    <div className="aura-scroll-progress" aria-hidden="true">
      <div
        className={cn(
          'aura-scroll-progress-bar',
          effectiveMotionMode === 'minimal' && 'aura-scroll-progress-bar-minimal'
        )}
        style={{ transform: `scaleX(${progress || 0})` }}
      />
    </div>
  );
};

export default ScrollProgressBar;
