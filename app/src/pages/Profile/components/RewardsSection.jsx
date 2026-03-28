import { Link } from 'react-router-dom';
import { Sparkles, Trophy, Activity } from 'lucide-react';
import { useMarket } from '@/context/MarketContext';

export default function RewardsSection({
    auraTier, auraPoints, rewardSnapshot, nextMilestone, handleOptimizeRewards,
    optimizing, intelligenceLoading, intelligenceData, rewardActivity, rewardsLoading,
}) {
    const { t, formatPrice } = useMarket();

    return (
        <div className="max-w-3xl space-y-5">
            <div className="rounded-2xl border bg-white p-6 shadow-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h3 className="flex items-center gap-2 text-lg font-bold text-gray-900">
                            <Sparkles className="h-5 w-5 text-amber-500" />
                            {t('profile.rewards.title', {}, 'Aura Points Command Center')}
                        </h3>
                        <p className="mt-1 text-xs text-gray-500">{t('profile.rewards.body', {}, 'Earn points from secure login, orders, and marketplace actions.')}</p>
                    </div>
                    <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-black uppercase tracking-wider text-amber-700">
                        {t('profile.rewards.tierBadge', { tier: auraTier }, `${auraTier} Tier`)}
                    </span>
                </div>

                <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-amber-600">{t('profile.rewards.balance.label', {}, 'Balance')}</p>
                        <p className="mt-1 text-2xl font-black text-amber-700">{auraPoints.toLocaleString('en-IN')}</p>
                        <p className="mt-1 text-xs text-amber-600">{t('profile.rewards.balance.body', {}, 'Aura Points available')}</p>
                    </div>
                    <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-indigo-600">{t('profile.rewards.lifetime.label', {}, 'Lifetime Earned')}</p>
                        <p className="mt-1 text-2xl font-black text-indigo-700">{Number(rewardSnapshot.lifetimeEarned || 0).toLocaleString('en-IN')}</p>
                        <p className="mt-1 text-xs text-indigo-600">{t('profile.rewards.lifetime.body', {}, 'Total reward accumulation')}</p>
                    </div>
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">{t('profile.rewards.streak.label', {}, 'Login Streak')}</p>
                        <p className="mt-1 text-2xl font-black text-emerald-700">{Number(rewardSnapshot.streakDays || 0)}</p>
                        <p className="mt-1 text-xs text-emerald-600">{t('profile.rewards.streak.body', {}, 'Consecutive reward days')}</p>
                    </div>
                </div>

                {nextMilestone !== null && Number.isFinite(nextMilestone) ? (
                    <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-3">
                        <p className="text-xs text-gray-600">
                            {t('profile.rewards.nextTier', { points: nextMilestone.toLocaleString('en-IN') }, `Next tier unlock at ${nextMilestone.toLocaleString('en-IN')} lifetime points.`)}
                        </p>
                    </div>
                ) : null}
            </div>

            <div className="rounded-2xl border bg-white p-6 shadow-sm">
                <div className="mb-4 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600">
                            <Trophy className="h-4 w-4 text-white" />
                        </div>
                        <div>
                            <h4 className="text-sm font-bold text-gray-900">{t('profile.rewards.insights.title', {}, 'Aura Smart Insights')}</h4>
                            <p className="text-[10px] text-gray-400">{t('profile.rewards.insights.kicker', {}, 'NP-Hard Optimized Personalized Offers')}</p>
                        </div>
                    </div>
                    <button
                        onClick={handleOptimizeRewards}
                        disabled={optimizing}
                        className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-bold transition-all
                            ${optimizing ? 'border-gray-200 bg-gray-50 text-gray-400' : 'border-indigo-200 bg-white text-indigo-600 hover:bg-indigo-50'}`}
                    >
                        {optimizing ? (
                            <div className="h-3 w-3 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
                        ) : (
                            <Activity className="h-3 w-3" />
                        )}
                        {optimizing
                            ? t('profile.rewards.insights.optimizing', {}, 'Optimizing...')
                            : t('profile.rewards.insights.recalc', {}, 'Re-calc Rewards')}
                    </button>
                </div>

                {intelligenceLoading ? (
                    <div className="animate-pulse space-y-3">
                        <div className="h-20 rounded-xl bg-gray-50" />
                    </div>
                ) : intelligenceData?.insights ? (
                    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-900 via-indigo-800 to-indigo-950 p-5 text-white shadow-xl">
                        <div className="pointer-events-none absolute right-0 top-0 p-8 opacity-10">
                            <Sparkles className="h-24 w-24" />
                        </div>
                        <div className="relative z-10">
                            <div className="mb-3 flex items-center gap-2">
                                <span className="rounded-md bg-neo-cyan px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-[#0a0a0a]">{t('profile.rewards.insights.optimalMatch', {}, 'Optimal Match')}</span>
                                <span className="text-[10px] font-bold uppercase tracking-widest text-indigo-300 opacity-80">{t('profile.rewards.insights.engine', {}, 'Knapsack Engine v1.0')}</span>
                            </div>
                            <div className="space-y-4">
                                {intelligenceData.insights.optimizedOffers?.slice(0, 3).map((offer, index) => (
                                    <div key={index} className="flex items-center justify-between border-b border-indigo-700/50 pb-3 last:border-0 last:pb-0">
                                        <div>
                                            <p className="text-sm font-bold text-white">{offer.rewardTitle}</p>
                                            <p className="text-[10px] font-medium text-indigo-300">
                                                {t('profile.rewards.insights.offerMeta', { cost: offer.cost, probability: Math.round(offer.probability * 100) }, `Cost: ${offer.cost} Aura Points | Prob: ${Math.round(offer.probability * 100)}%`)}
                                            </p>
                                        </div>
                                        <div className="text-right">
                                            <span className="text-xs font-black text-neo-cyan">{t('profile.rewards.insights.save', { discount: offer.maxDiscount }, `SAVE ${offer.maxDiscount}%`)}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <div className="mt-5 flex items-center justify-between border-t border-indigo-700/50 pt-4">
                                <div>
                                    <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-300">{t('profile.rewards.insights.predictedSavings', {}, 'Predicted Savings')}</p>
                                    <p className="text-lg font-black text-white">{formatPrice(intelligenceData.insights.totalValue || 0, 'INR', undefined, { presentmentCurrency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 0 })}</p>
                                </div>
                                <Link to="/products" className="rounded-lg bg-neo-cyan px-4 py-2 text-[10px] font-black uppercase tracking-widest text-[#0a0a0a] transition-all hover:brightness-110">
                                    {t('profile.rewards.insights.redeemNow', {}, 'Redeem Now')}
                                </Link>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-8 text-center">
                        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
                            <Sparkles className="h-6 w-6 text-gray-300" />
                        </div>
                        <p className="text-sm font-bold text-gray-700">{t('profile.rewards.insights.emptyTitle', {}, 'No Intelligence Insights Yet')}</p>
                        <p className="mx-auto mt-1 max-w-[240px] text-xs text-gray-400">{t('profile.rewards.insights.emptyBody', {}, "Click 'Re-calc Rewards' to run our optimization engine over your historical data.")}</p>
                    </div>
                )}
            </div>

            <div className="rounded-2xl border bg-white p-6 shadow-sm">
                <div className="mb-4 flex items-center justify-between">
                    <h4 className="font-bold text-gray-900">{t('profile.rewards.activity.title', {}, 'Recent Rewards Activity')}</h4>
                    {rewardsLoading ? <span className="text-xs text-gray-400">{t('profile.rewards.activity.syncing', {}, 'Syncing...')}</span> : null}
                </div>
                {rewardActivity.length === 0 ? (
                    <div className="py-8 text-center">
                        <Sparkles className="mx-auto mb-2 h-10 w-10 text-gray-200" />
                        <p className="text-sm text-gray-500">{t('profile.rewards.activity.empty', {}, 'No rewards activity yet.')}</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {rewardActivity.slice(0, 12).map((entry, index) => (
                            <div key={`${entry.createdAt || index}-${entry.eventType || 'reward'}`} className="flex items-start justify-between gap-3 rounded-xl border p-3">
                                <div className="min-w-0">
                                    <p className="text-sm font-semibold text-gray-900">
                                        {entry.reason || String(entry.eventType || t('profile.rewards.activity.rewardFallback', {}, 'Reward')).replace(/_/g, ' ')}
                                    </p>
                                    <p className="mt-0.5 text-xs text-gray-500">
                                        {entry.createdAt ? new Date(entry.createdAt).toLocaleString('en-IN') : t('profile.rewards.activity.recently', {}, 'Recently')}
                                    </p>
                                </div>
                                <span className="whitespace-nowrap text-sm font-black text-emerald-600">
                                    {t('profile.rewards.activity.points', { points: Number(entry.points || 0).toLocaleString('en-IN') }, `+${Number(entry.points || 0).toLocaleString('en-IN')} AP`)}
                                </span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
