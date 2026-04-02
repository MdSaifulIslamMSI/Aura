import { ShoppingCart, Wallet } from 'lucide-react';
import { formatMoney } from '../workspaceModels';

const AssistantContextRail = ({
    cartSummary,
    formatPrice,
    originContext,
    originProduct,
}) => (
    <aside className="space-y-4">
        <div className="rounded-[1.75rem] border border-white/10 bg-white/[0.03] p-5">
            <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">Launch context</p>
            <p className="mt-3 text-xl font-black text-white">{originContext.label}</p>
            <p className="mt-2 text-sm leading-6 text-slate-400">{originContext.path}</p>
            {originProduct ? (
                <div className="mt-4 rounded-[1rem] border border-white/10 bg-slate-950/40 p-3">
                    <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Active product</p>
                    <p className="mt-2 text-sm font-bold text-white">{originProduct.displayTitle || originProduct.title}</p>
                    <p className="mt-1 text-xs text-slate-400">
                        {formatPrice ? formatPrice(originProduct.price) : formatMoney(originProduct.price)}
                    </p>
                </div>
            ) : null}
        </div>

        <div className="rounded-[1.75rem] border border-white/10 bg-white/[0.03] p-5">
            <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">Commerce snapshot</p>
            <div className="mt-4 space-y-3">
                <div className="rounded-[1rem] border border-white/10 bg-slate-950/40 p-3">
                    <div className="flex items-center gap-2 text-slate-300">
                        <ShoppingCart className="h-4 w-4" />
                        <span className="text-xs uppercase tracking-[0.16em]">Cart items</span>
                    </div>
                    <p className="mt-2 text-2xl font-black text-white">{cartSummary.totalItems}</p>
                </div>
                <div className="rounded-[1rem] border border-white/10 bg-slate-950/40 p-3">
                    <div className="flex items-center gap-2 text-slate-300">
                        <Wallet className="h-4 w-4" />
                        <span className="text-xs uppercase tracking-[0.16em]">Cart value</span>
                    </div>
                    <p className="mt-2 text-2xl font-black text-white">
                        {formatMoney(cartSummary.totalPrice, cartSummary.currency)}
                    </p>
                </div>
            </div>
        </div>
    </aside>
);

export default AssistantContextRail;
