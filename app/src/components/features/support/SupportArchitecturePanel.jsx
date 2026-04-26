import {
    Activity,
    CheckCircle2,
    Clock3,
    MessageSquare,
    PhoneCall,
    Sparkles,
    Video,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const ICON_MAP = {
    queue: Activity,
    chat: MessageSquare,
    voice: PhoneCall,
    video: Video,
    resolution: CheckCircle2,
    insight: Sparkles,
};

const METRIC_TONES = {
    cyan: 'border-cyan-300/20 bg-cyan-500/12 text-cyan-100',
    emerald: 'border-emerald-300/20 bg-emerald-500/12 text-emerald-100',
    amber: 'border-amber-300/20 bg-amber-500/12 text-amber-100',
    rose: 'border-rose-300/20 bg-rose-500/12 text-rose-100',
    slate: 'border-white/10 bg-white/[0.05] text-slate-100',
};

const STAGE_TONES = {
    active: 'border-emerald-300/20 bg-emerald-500/12 text-emerald-100',
    complete: 'border-cyan-300/20 bg-cyan-500/12 text-cyan-100',
    queued: 'border-amber-300/20 bg-amber-500/12 text-amber-100',
    warning: 'border-rose-300/20 bg-rose-500/12 text-rose-100',
    pending: 'border-white/10 bg-white/[0.04] text-slate-200',
};

const renderIcon = (iconName = 'queue') => {
    const Icon = ICON_MAP[iconName] || Activity;
    return <Icon className="h-4 w-4" />;
};

const SupportArchitecturePanel = ({
    eyebrow = 'Support architecture',
    title = 'Omnichannel support',
    description = '',
    metrics = [],
    insight = null,
    stages = [],
    badges = [],
    className = '',
}) => (
    <section className={cn('support-architecture-panel rounded-[1.35rem] border border-white/10 bg-[linear-gradient(135deg,rgba(6,10,24,0.92),rgba(10,18,34,0.96))] p-4 shadow-[0_24px_58px_rgba(2,8,23,0.28)] sm:p-5', className)}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 flex-1">
                <p className="text-[11px] font-black uppercase tracking-[0.24em] text-cyan-200">{eyebrow}</p>
                <h3 className="mt-2 text-2xl font-black text-white">{title}</h3>
                {description ? (
                    <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">{description}</p>
                ) : null}
            </div>

            {badges.length > 0 ? (
                <div className="flex flex-wrap gap-2 lg:max-w-[20rem] lg:justify-end">
                    {badges.map((badge) => (
                        <span
                            key={`${badge.label}-${badge.tone || 'slate'}`}
                            className={cn(
                                'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-bold',
                                METRIC_TONES[badge.tone] || METRIC_TONES.slate
                            )}
                        >
                            {badge.icon ? renderIcon(badge.icon) : null}
                            {badge.label}
                        </span>
                    ))}
                </div>
            ) : null}
        </div>

        {metrics.length > 0 ? (
            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {metrics.map((metric) => (
                    <div
                        key={metric.label}
                        className={cn(
                            'rounded-[1.45rem] border px-4 py-4',
                            METRIC_TONES[metric.tone] || METRIC_TONES.slate
                        )}
                    >
                        <div className="flex items-center justify-between gap-3">
                            <div className="text-[11px] font-black uppercase tracking-[0.18em]">{metric.label}</div>
                            <div className="rounded-full border border-current/15 bg-black/10 p-2">
                                {renderIcon(metric.icon)}
                            </div>
                        </div>
                        <div className="mt-3 text-3xl font-black tracking-tight text-white">{metric.value}</div>
                        {metric.detail ? (
                            <div className="mt-2 text-xs leading-5 text-inherit/85">{metric.detail}</div>
                        ) : null}
                    </div>
                ))}
            </div>
        ) : null}

        {insight ? (
            <div className={cn(
                'mt-5 rounded-[1.6rem] border p-4',
                METRIC_TONES[insight.tone] || METRIC_TONES.slate
            )}>
                <div className="flex items-start gap-3">
                    <div className="rounded-full border border-current/15 bg-black/10 p-2">
                        {renderIcon(insight.icon || 'insight')}
                    </div>
                    <div className="min-w-0 flex-1">
                        <div className="text-[11px] font-black uppercase tracking-[0.18em] text-inherit/80">{insight.label}</div>
                        <div className="mt-1 text-lg font-black text-white">{insight.title}</div>
                        {insight.body ? (
                            <div className="mt-2 text-sm leading-6 text-inherit/85">{insight.body}</div>
                        ) : null}
                    </div>
                </div>
            </div>
        ) : null}

        {stages.length > 0 ? (
            <div className="mt-5 rounded-[1.6rem] border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">
                    <Clock3 className="h-3.5 w-3.5" />
                    Channel Timeline
                </div>
                <div className="mt-4 grid gap-3 lg:grid-cols-4">
                    {stages.map((stage) => (
                        <div
                            key={stage.key}
                            className={cn(
                                'rounded-[1.35rem] border p-4',
                                STAGE_TONES[stage.state] || STAGE_TONES.pending
                            )}
                        >
                            <div className="flex items-center justify-between gap-3">
                                <div className="text-sm font-black text-white">{stage.label}</div>
                                <div className="rounded-full border border-current/15 bg-black/10 p-2">
                                    {renderIcon(stage.icon)}
                                </div>
                            </div>
                            {stage.detail ? (
                                <div className="mt-3 text-xs leading-5 text-inherit/85">{stage.detail}</div>
                            ) : null}
                        </div>
                    ))}
                </div>
            </div>
        ) : null}
    </section>
);

export default SupportArchitecturePanel;
