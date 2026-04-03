import { Link } from 'react-router-dom';
import { Brain, ExternalLink, Sparkles } from 'lucide-react';

const AssistantHero = ({ originContext }) => (
    <div className="relative overflow-hidden border-b border-white/10">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.18),transparent_36%),radial-gradient(circle_at_bottom_right,rgba(16,185,129,0.12),transparent_34%)]" />
        <div className="relative z-10 mx-auto max-w-7xl px-4 py-12 sm:py-14">
            <div className="flex flex-wrap items-center gap-3">
                <span className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-400/12 px-3 py-1 text-[11px] font-black uppercase tracking-[0.22em] text-cyan-100">
                    <Brain className="h-3.5 w-3.5" />
                    Commerce Assistant V2
                </span>
                <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-black uppercase tracking-[0.22em] text-slate-300">
                    <Sparkles className="h-3.5 w-3.5" />
                    Text-first workspace
                </span>
            </div>
            <h1 className="mt-5 max-w-4xl text-4xl font-black tracking-tight text-white sm:text-5xl">
                A focused commerce copilot that stays inside shopping until you explicitly hand off to support.
            </h1>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300 sm:text-base">
                This workspace is session-based and recommendation-driven. It suggests the next move, but the actual cart,
                checkout, and support flows still run through the normal product surfaces.
            </p>
            <div className="mt-6 flex flex-wrap gap-3 text-sm text-slate-300">
                <Link
                    to={originContext.path}
                    className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 font-semibold text-white transition-colors hover:bg-white/10"
                >
                    <ExternalLink className="h-4 w-4" />
                    Return to {originContext.label}
                </Link>
            </div>
        </div>
    </div>
);

export default AssistantHero;
