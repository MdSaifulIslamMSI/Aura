import { ChevronRight, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

const RecommendationSection = ({
  eyebrow = 'Recommendations',
  title = '',
  description = '',
  children,
  actionHref = '',
  actionLabel = 'Explore',
  className = '',
}) => (
  <section className={cn('aura-product-shelf premium-grid-backdrop mb-8 overflow-hidden', className)}>
    <div className="aura-product-shelf__header flex flex-col gap-4 border-b border-white/5 p-5 sm:p-6 lg:flex-row lg:items-end lg:justify-between">
      <div className="max-w-2xl">
        {eyebrow ? (
          <div className="premium-kicker mb-2 inline-flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5" />
            {eyebrow}
          </div>
        ) : null}
        {title ? <h2 className="text-xl font-black tracking-tight text-white md:text-2xl">{title}</h2> : null}
        {description ? <p className="mt-2 text-sm leading-6 text-slate-300 md:text-base">{description}</p> : null}
      </div>
      {actionHref ? (
        <Link
          to={actionHref}
          className="inline-flex items-center gap-2 self-start rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-bold uppercase tracking-[0.18em] text-slate-200 transition-colors hover:border-neo-cyan/40 hover:text-neo-cyan"
        >
          {actionLabel}
          <ChevronRight className="h-4 w-4" />
        </Link>
      ) : null}
    </div>
    <div className="p-4 sm:p-6">
      {children}
    </div>
  </section>
);

export default RecommendationSection;
