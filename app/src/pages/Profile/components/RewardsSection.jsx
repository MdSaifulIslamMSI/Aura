import { Link } from 'react-router-dom';
import { Sparkles, Trophy, Activity } from 'lucide-react';

export default function RewardsSection({ 
    auraTier, auraPoints, rewardSnapshot, nextMilestone, handleOptimizeRewards, 
    optimizing, intelligenceLoading, intelligenceData, rewardActivity, rewardsLoading 
}) {
    return (
        <div className="max-w-3xl space-y-5">
            <div className="bg-white rounded-2xl border shadow-sm p-6">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                        <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                            <Sparkles className="w-5 h-5 text-amber-500" />
                            Aura Points Command Center
                        </h3>
                        <p className="text-xs text-gray-500 mt-1">Earn points from secure login, orders, and marketplace actions.</p>
                    </div>
                    <span className="px-3 py-1 rounded-full bg-amber-100 text-amber-700 text-xs font-black uppercase tracking-wider">
                        {auraTier} Tier
                    </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-5">
                    <div className="rounded-xl border bg-amber-50 border-amber-200 p-4">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-amber-600">Balance</p>
                        <p className="text-2xl font-black text-amber-700 mt-1">{auraPoints.toLocaleString('en-IN')}</p>
                        <p className="text-xs text-amber-600 mt-1">Aura Points available</p>
                    </div>
                    <div className="rounded-xl border bg-indigo-50 border-indigo-200 p-4">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-indigo-600">Lifetime Earned</p>
                        <p className="text-2xl font-black text-indigo-700 mt-1">{Number(rewardSnapshot.lifetimeEarned || 0).toLocaleString('en-IN')}</p>
                        <p className="text-xs text-indigo-600 mt-1">Total reward accumulation</p>
                    </div>
                    <div className="rounded-xl border bg-emerald-50 border-emerald-200 p-4">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">Login Streak</p>
                        <p className="text-2xl font-black text-emerald-700 mt-1">{Number(rewardSnapshot.streakDays || 0)}</p>
                        <p className="text-xs text-emerald-600 mt-1">Consecutive reward days</p>
                    </div>
                </div>

                {nextMilestone !== null && Number.isFinite(nextMilestone) && (
                    <div className="mt-4 p-3 rounded-xl border border-gray-200 bg-gray-50">
                        <p className="text-xs text-gray-600">
                            Next tier unlock at <span className="font-bold text-gray-900">{nextMilestone.toLocaleString('en-IN')}</span> lifetime points.
                        </p>
                    </div>
                )}
            </div>

            {/* --- Aura Smart Insights (NP-Hard Smart Rewards) --- */}
            <div className="bg-white rounded-2xl border shadow-sm p-6">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center">
                            <Trophy className="w-4 h-4 text-white" />
                        </div>
                        <div>
                            <h4 className="font-bold text-gray-900 text-sm">Aura Smart Insights</h4>
                            <p className="text-[10px] text-gray-400">NP-Hard Optimized Personalized Offers</p>
                        </div>
                    </div>
                    <button
                        onClick={handleOptimizeRewards}
                        disabled={optimizing}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all flex items-center gap-2
                            ${optimizing ? 'bg-gray-50 text-gray-400 border-gray-200' : 'bg-white text-indigo-600 border-indigo-200 hover:bg-indigo-50'}`}
                    >
                        {optimizing ? (
                            <div className="w-3 h-3 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                        ) : (
                            <Activity className="w-3 h-3" />
                        )}
                        {optimizing ? 'Optimizing...' : 'Re-calc Rewards'}
                    </button>
                </div>

                {intelligenceLoading ? (
                    <div className="animate-pulse space-y-3">
                        <div className="h-20 bg-gray-50 rounded-xl" />
                    </div>
                ) : intelligenceData?.insights ? (
                    <div className="bg-gradient-to-br from-indigo-900 via-indigo-800 to-indigo-950 rounded-2xl p-5 relative overflow-hidden text-white shadow-xl">
                        <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
                            <Sparkles className="w-24 h-24" />
                        </div>
                        <div className="relative z-10">
                            <div className="flex items-center gap-2 mb-3">
                                <span className="px-2 py-0.5 bg-neo-cyan text-[#0a0a0a] text-[10px] font-black rounded-md uppercase tracking-wider">Optimal Match</span>
                                <span className="text-[10px] text-indigo-300 opacity-80 uppercase tracking-widest font-bold">Knapsack Engine v1.0</span>
                            </div>
                            <div className="space-y-4">
                                {intelligenceData.insights.optimizedOffers?.slice(0, 3).map((offer, idx) => (
                                    <div key={idx} className="flex items-center justify-between border-b border-indigo-700/50 pb-3 last:border-0 last:pb-0">
                                        <div>
                                            <p className="text-sm font-bold text-white">{offer.rewardTitle}</p>
                                            <p className="text-[10px] text-indigo-300 font-medium">Cost: {offer.cost} Aura Points | Prob: {Math.round(offer.probability * 100)}%</p>
                                        </div>
                                        <div className="text-right">
                                            <span className="text-xs font-black text-neo-cyan">SAVE {offer.maxDiscount}%</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <div className="mt-5 flex items-center justify-between border-t border-indigo-700/50 pt-4">
                                <div>
                                    <p className="text-[10px] font-bold text-indigo-300 uppercase tracking-widest">Predicted Savings</p>
                                    <p className="text-lg font-black text-white">₹{(intelligenceData.insights.totalValue || 0).toLocaleString()}</p>
                                </div>
                                <Link to="/products" className="px-4 py-2 bg-neo-cyan text-[#0a0a0a] text-[10px] font-black rounded-lg uppercase tracking-widest hover:brightness-110 transition-all">
                                    Redeem Now
                                </Link>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="bg-gray-50 border border-dashed border-gray-200 rounded-2xl p-8 text-center">
                        <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
                            <Sparkles className="w-6 h-6 text-gray-300" />
                        </div>
                        <p className="text-sm font-bold text-gray-700">No Intelligence Insights Yet</p>
                        <p className="text-xs text-gray-400 mt-1 max-w-[240px] mx-auto">Click 'Re-calc Rewards' to run our optimization engine over your historical data.</p>
                    </div>
                )}
            </div>

            <div className="bg-white rounded-2xl border shadow-sm p-6">
                <div className="flex items-center justify-between mb-4">
                    <h4 className="font-bold text-gray-900">Recent Rewards Activity</h4>
                    {rewardsLoading && <span className="text-xs text-gray-400">Syncing...</span>}
                </div>
                {rewardActivity.length === 0 ? (
                    <div className="text-center py-8">
                        <Sparkles className="w-10 h-10 text-gray-200 mx-auto mb-2" />
                        <p className="text-sm text-gray-500">No rewards activity yet.</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {rewardActivity.slice(0, 12).map((entry, idx) => (
                            <div key={`${entry.createdAt || idx}-${entry.eventType || 'reward'}`} className="flex items-start justify-between gap-3 border rounded-xl p-3">
                                <div className="min-w-0">
                                    <p className="text-sm font-semibold text-gray-900">
                                        {entry.reason || String(entry.eventType || 'Reward').replace(/_/g, ' ')}
                                    </p>
                                    <p className="text-xs text-gray-500 mt-0.5">
                                        {entry.createdAt ? new Date(entry.createdAt).toLocaleString('en-IN') : 'Recently'}
                                    </p>
                                </div>
                                <span className="text-sm font-black text-emerald-600 whitespace-nowrap">
                                    +{Number(entry.points || 0).toLocaleString('en-IN')} AP
                                </span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
