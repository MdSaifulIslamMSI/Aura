import { formatMoney } from '../workspaceModels';

const AssistantCardRenderer = ({ card, onAction, isBusy = false }) => {
    if (card?.type === 'product' && card?.product) {
        return (
            <div className="rounded-[1.35rem] border border-white/10 bg-white/[0.04] p-4">
                <p className="text-[11px] font-black uppercase tracking-[0.2em] text-cyan-200">{card.title || 'Product option'}</p>
                <div className="mt-3 flex gap-4">
                    <div className="h-20 w-20 overflow-hidden rounded-2xl border border-white/10 bg-slate-950/50">
                        {card.product.image ? (
                            <img src={card.product.image} alt={card.product.title} className="h-full w-full object-cover" />
                        ) : null}
                    </div>
                    <div className="min-w-0 flex-1">
                        <p className="text-base font-black text-white">{card.product.title}</p>
                        <p className="mt-1 text-sm text-slate-300">{card.product.brand || card.product.category || 'Grounded catalog match'}</p>
                        <p className="mt-3 text-sm font-semibold text-emerald-200">{formatMoney(card.product.price)}</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                            <button
                                type="button"
                                onClick={() => onAction?.({
                                    type: 'open_product',
                                    productId: card.product.id,
                                    label: 'Open product',
                                })}
                                disabled={isBusy}
                                className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold uppercase tracking-[0.14em] text-white transition-colors hover:bg-white/10 disabled:opacity-60"
                            >
                                View
                            </button>
                            <button
                                type="button"
                                onClick={() => onAction?.({
                                    type: 'add_to_cart',
                                    productId: card.product.id,
                                    quantity: 1,
                                    label: 'Add to cart',
                                })}
                                disabled={isBusy}
                                className="rounded-full border border-cyan-300/20 bg-cyan-400/12 px-3 py-2 text-xs font-bold uppercase tracking-[0.14em] text-cyan-100 transition-colors hover:bg-cyan-400/18 disabled:opacity-60"
                            >
                                Add
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    if (card?.type === 'comparison' && Array.isArray(card?.products)) {
        return (
            <div className="rounded-[1.35rem] border border-white/10 bg-white/[0.04] p-4">
                <p className="text-[11px] font-black uppercase tracking-[0.2em] text-cyan-200">{card.title || 'Comparison'}</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {card.products.map((product) => (
                        <div key={product.id} className="rounded-[1rem] border border-white/10 bg-slate-950/30 p-3">
                            <p className="text-sm font-black text-white">{product.title}</p>
                            <p className="mt-1 text-xs text-slate-400">{product.brand || product.category}</p>
                            <p className="mt-3 text-sm font-semibold text-emerald-200">{formatMoney(product.price)}</p>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    if (card?.type === 'cart_summary' && card?.cartSummary) {
        return (
            <div className="rounded-[1.35rem] border border-white/10 bg-white/[0.04] p-4">
                <p className="text-[11px] font-black uppercase tracking-[0.2em] text-cyan-200">{card.title || 'Cart summary'}</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-[1rem] border border-white/10 bg-slate-950/30 p-3">
                        <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Items</p>
                        <p className="mt-2 text-lg font-black text-white">{card.cartSummary.totalItems}</p>
                    </div>
                    <div className="rounded-[1rem] border border-white/10 bg-slate-950/30 p-3">
                        <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Subtotal</p>
                        <p className="mt-2 text-lg font-black text-white">
                            {formatMoney(card.cartSummary.totalPrice, card.cartSummary.currency)}
                        </p>
                    </div>
                    <div className="rounded-[1rem] border border-white/10 bg-slate-950/30 p-3">
                        <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Saved</p>
                        <p className="mt-2 text-lg font-black text-emerald-200">
                            {formatMoney(card.cartSummary.totalDiscount, card.cartSummary.currency)}
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="rounded-[1.35rem] border border-dashed border-white/10 bg-white/[0.02] p-4">
            <p className="text-sm font-bold text-white">{card?.title || 'No grounded result yet'}</p>
            <p className="mt-2 text-sm text-slate-400">
                {card?.description || 'Refine the brief with a tighter product clue, price range, or compare target.'}
            </p>
        </div>
    );
};

export default AssistantCardRenderer;
