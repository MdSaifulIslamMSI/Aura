import { useEffect, useMemo, useState } from 'react';
import { Navigation } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';

const SECTION_SELECTOR = '[data-scroll-anchor]';

const slugify = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const toSectionMeta = (element, index) => {
  const label = element.dataset.scrollAnchorLabel || element.getAttribute('aria-label') || `Section ${index + 1}`;
  const generatedId = `anchor-${slugify(label)}-${index + 1}`;
  if (!element.id) {
    element.id = generatedId;
  }
  return {
    id: element.id,
    label,
  };
};

const scrollToTarget = (targetId) => {
  if (typeof document === 'undefined') return;
  const target = document.getElementById(targetId);
  if (!target) return;

  const lenis = window.__AURA_LENIS__;
  if (lenis && typeof lenis.scrollTo === 'function') {
    lenis.scrollTo(target, { offset: -110 });
    return;
  }

  const top = window.scrollY + target.getBoundingClientRect().top - 110;
  window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
};

const SectionAnchorRail = () => {
  const location = useLocation();
  const [sections, setSections] = useState([]);
  const [activeId, setActiveId] = useState('');

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;

    const collect = () => {
      const nodes = [...document.querySelectorAll(SECTION_SELECTOR)];
      const nextSections = nodes.map(toSectionMeta).filter((item) => item?.id);
      setSections(nextSections);
      setActiveId((previous) => {
        if (nextSections.length === 0) return '';
        if (nextSections.some((entry) => entry.id === previous)) return previous;
        return nextSections[0].id;
      });
    };

    collect();
    const timers = [window.setTimeout(collect, 180), window.setTimeout(collect, 680)];
    return () => timers.forEach((timerId) => window.clearTimeout(timerId));
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (typeof document === 'undefined' || sections.length === 0) return undefined;

    const observers = [];
    const ids = sections.map((section) => section.id);

    const onIntersect = (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
      if (visible[0]?.target?.id) {
        setActiveId(visible[0].target.id);
      }
    };

    const observer = new IntersectionObserver(onIntersect, {
      root: null,
      rootMargin: '-40% 0px -45% 0px',
      threshold: [0.1, 0.25, 0.45, 0.65],
    });
    observers.push(observer);

    ids.forEach((id) => {
      const node = document.getElementById(id);
      if (node) observer.observe(node);
    });

    return () => observers.forEach((instance) => instance.disconnect());
  }, [sections]);

  const visibleSections = useMemo(() => sections.filter((section) => section.label), [sections]);

  if (visibleSections.length < 2) return null;

  return (
    <aside className="aura-anchor-rail" aria-label="Section navigation">
      <div className="aura-anchor-rail-shell">
        <div className="aura-anchor-rail-title">
          <Navigation className="w-3.5 h-3.5" />
          <span className="aura-anchor-rail-title__text">Jump</span>
        </div>
        <div className="aura-anchor-list">
          {visibleSections.map((section) => {
            const active = section.id === activeId;
            return (
              <button
                key={section.id}
                type="button"
                onClick={() => scrollToTarget(section.id)}
                className={cn('aura-anchor-item', active && 'is-active')}
                title={section.label}
                aria-current={active ? 'true' : 'false'}
              >
                <span className="aura-anchor-dot" />
                <span className="aura-anchor-label">{section.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
};

export default SectionAnchorRail;
