import { useContext } from 'react';
import { Link } from 'react-router-dom';
import { Heart, ShoppingCart, Trash2, Zap } from 'lucide-react';
import { WishlistContext } from '@/context/WishlistContext';
import ProductCard from '@/components/features/product/ProductCard';

const Wishlist = () => {
  const { wishlistItems, removeFromWishlist, moveToCart } = useContext(WishlistContext);
  const handleMoveToCart = (productId) => {
    moveToCart(productId);
  };

  if (wishlistItems.length === 0) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center relative overflow-hidden">
        {/* Background Decor */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(80vw,600px)] h-[min(80vw,600px)] bg-neo-rose/5 rounded-full blur-[150px] pointer-events-none -z-10" />

        <div className="container-custom py-10">
          <div className="bg-white/5 border border-white/10 rounded-3xl p-12 text-center max-w-lg mx-auto shadow-glass relative group overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-transparent to-neo-rose/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />

            <div className="w-24 h-24 rounded-full bg-zinc-950/50 border border-white/10 flex items-center justify-center mx-auto mb-6 shadow-[0_0_30px_rgba(0,0,0,0.5)]">
              <Heart className="w-10 h-10 text-slate-500 group-hover:text-neo-rose transition-colors duration-300" />
            </div>

            <h2 className="text-3xl font-black mb-4 text-white tracking-tight">Your Wishlist is Empty</h2>
            <p className="text-slate-400 mb-8 max-w-sm mx-auto font-medium leading-relaxed">
              You haven't saved any items yet.
            </p>
            <Link to="/" className="btn-primary inline-flex items-center gap-2 px-10 py-3 shadow-[0_0_15px_rgba(244,63,94,0.3)]">
              <Zap className="w-4 h-4 fill-white" /> Explore Aura
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-16 pt-4 relative">
      {/* Background Decor */}
      <div className="absolute top-0 right-0 w-[min(70vw,500px)] h-[min(70vw,500px)] bg-neo-fuchsia/10 rounded-full blur-[150px] pointer-events-none -z-10" />
      <div className="absolute bottom-40 left-0 w-[min(70vw,500px)] h-[min(70vw,500px)] bg-neo-rose/10 rounded-full blur-[150px] pointer-events-none -z-10" />

      <div className="container-custom max-w-7xl mx-auto px-4 lg:px-8 py-6">
        {/* Breadcrumb */}
        <nav className="text-xs md:text-sm text-slate-500 font-bold uppercase tracking-widest mb-8 flex items-center flex-wrap gap-y-2">
          <Link to="/" className="hover:text-neo-rose transition-colors">Aura</Link>
          <span className="mx-2 text-slate-700">/</span>
          <span className="text-white">Wishlist</span>
        </nav>

        {/* Header */}
        <div className="flex items-center justify-between mb-8 pb-4 border-b border-white/10">
          <h1 className="text-2xl md:text-3xl font-black text-white tracking-tighter flex items-center gap-3">
            <Heart className="w-7 h-7 text-neo-rose drop-shadow-[0_0_8px_rgba(244,63,94,0.6)] fill-neo-rose" />
            Saved Items
            <span className="bg-neo-rose/20 text-neo-rose text-sm px-3 py-1 rounded-full border border-neo-rose/30 mt-1">
              {wishlistItems.length} {wishlistItems.length === 1 ? 'item' : 'items'}
            </span>
          </h1>
        </div>

        {/* Wishlist Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 lg:gap-8 gap-6">
          {wishlistItems.map((item) => (
            <div key={item.id} className="relative group">
              <ProductCard product={item} />

              {/* Action Buttons */}
              <div className="absolute top-3 right-3 flex flex-col gap-2 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity duration-300 z-30 md:translate-x-2 md:group-hover:translate-x-0">
                <button
                  type="button"
                  onClick={() => removeFromWishlist(item.id)}
                  aria-label={`Remove ${item.title} from Wishlist`}
                  className="p-3 bg-zinc-950/80 rounded-full border border-white/10 shadow-[0_0_15px_rgba(0,0,0,0.5)] hover:border-neo-rose hover:bg-neo-rose/20 text-slate-400 hover:text-neo-rose transition-all"
                  title="Remove from Wishlist"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              {/* Move to Cart Button */}
              <button
                type="button"
                onClick={() => handleMoveToCart(item.id)}
                className="absolute bottom-4 left-4 right-4 bg-neo-cyan/20 hover:bg-neo-cyan/40 border border-neo-cyan/50 text-white font-bold py-3 text-sm rounded-xl flex items-center justify-center gap-2 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-all duration-300 md:translate-y-2 md:group-hover:translate-y-0 z-30 shadow-[0_0_15px_rgba(6,182,212,0.3)] group/btn"
              >
                <ShoppingCart className="w-4 h-4 group-hover/btn:-translate-x-1 transition-transform" />
                Add to Bag
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Wishlist;

