import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { useMotionMode } from '@/context/MotionModeContext';

const RevealOnScroll = ({
  as: Element = 'div',
  children,
  className,
  delay = 0,
  once = true,
  threshold = 0.14,
  distance = 18,
  anchorId,
  anchorLabel,
}) => {
  const ref = useRef(null);
  const { effectiveMotionMode } = useMotionMode();
  const [visible, setVisible] = useState(effectiveMotionMode === 'minimal');

  useEffect(() => {
    if (effectiveMotionMode === 'minimal') {
      setVisible(true);
      return undefined;
    }

    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        if (entry.isIntersecting) {
          setVisible(true);
          if (once) observer.disconnect();
        } else if (!once) {
          setVisible(false);
        }
      },
      { threshold }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [effectiveMotionMode, once, threshold]);

  return (
    <Element
      ref={ref}
      id={anchorId}
      data-scroll-anchor={anchorId ? 'true' : undefined}
      data-scroll-anchor-label={anchorLabel}
      className={cn('aura-reveal', visible && 'is-visible', className)}
      style={{
        '--aura-reveal-delay': `${delay}ms`,
        '--aura-reveal-distance': `${distance}px`,
      }}
    >
      {children}
    </Element>
  );
};

export default RevealOnScroll;
