import { Clock3, ShieldCheck, Sparkles } from 'lucide-react';

const ICON_MAP = {
    resume: Clock3,
    identity: ShieldCheck,
    lane: Sparkles,
};

export const AuthAccelerationRail = ({ cards = [], busy = false }) => {
    if (!Array.isArray(cards) || cards.length === 0) {
        return null;
    }

    return (
        <div className="auth-acceleration-rail mb-6 grid gap-3">
            {cards.map((card) => {
                const Icon = ICON_MAP[card.icon] || Sparkles;
                return (
                    <div
                        key={card.key}
                        className="auth-acceleration-card rounded-[24px] border border-white/10 bg-white/[0.04] p-4 shadow-[0_18px_45px_rgba(2,8,23,0.22)]"
                    >
                        <div className="flex items-start gap-3">
                            <div className="auth-acceleration-card__icon mt-0.5 flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-zinc-950/65 text-neo-cyan">
                                <Icon className="h-4 w-4" />
                            </div>
                            <div className="min-w-0 flex-1">
                                <div className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-500">
                                    {card.eyebrow}
                                </div>
                                <div className="mt-1 text-sm font-black uppercase tracking-[0.14em] text-white">
                                    {card.title}
                                </div>
                                <p className="mt-2 text-sm leading-6 text-slate-300">
                                    {card.body}
                                </p>
                                {card.meta ? (
                                    <p className="mt-2 text-[11px] uppercase tracking-[0.18em] text-slate-500">
                                        {card.meta}
                                    </p>
                                ) : null}
                                {card.actionLabel && typeof card.onAction === 'function' ? (
                                    <button
                                        type="button"
                                        disabled={busy}
                                        onClick={card.onAction}
                                    className="auth-acceleration-card__action mt-3 inline-flex items-center justify-center rounded-full border border-white/10 bg-white/[0.06] px-4 py-2 text-[11px] font-black uppercase tracking-[0.2em] text-neo-cyan transition-colors hover:bg-white/[0.1] disabled:cursor-wait disabled:opacity-70"
                                    >
                                        {card.actionLabel}
                                    </button>
                                ) : null}
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

export default AuthAccelerationRail;

