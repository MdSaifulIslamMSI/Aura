import { useEffect, useMemo } from 'react';
import ProductCard from '@/components/features/product/ProductCard';
import SkeletonLoader from '@/components/shared/SkeletonLoader';
import { decorateRecommendedProduct, trackRecommendationEvent } from '@/services/api';

const getProductId = (product = {}) => product?.id || product?._id || product?.productId || '';

const normalizeRecommendationEntries = (items = []) => (
  (Array.isArray(items) ? items : [])
    .map((entry) => (
      entry?.product
        ? decorateRecommendedProduct(entry)
        : entry
    ))
    .filter((product) => getProductId(product))
);

const ProductCarousel = ({
  recommendations = [],
  loading = false,
  sourcePage = '',
  emptyMessage = 'No recommendations are available right now.',
  skeletonCount = 4,
}) => {
  const products = useMemo(() => (
    normalizeRecommendationEntries(recommendations).map((product) => ({
      ...product,
      recommendationMeta: {
        ...(product.recommendationMeta || {}),
        sourcePage,
      },
    }))
  ), [recommendations, sourcePage]);

  useEffect(() => {
    if (loading || products.length === 0) return;
    const timer = window.setTimeout(() => {
      products.slice(0, 8).forEach((product, index) => {
        void trackRecommendationEvent({
          eventType: 'recommendation_impression',
          productId: getProductId(product),
          category: product.category || '',
          sourcePage,
          recommendationSource: product.recommendationMeta?.source || '',
          metadata: {
            position: index + 1,
            reason: product.recommendationMeta?.reason || '',
          },
        });
      });
    }, 500);

    return () => window.clearTimeout(timer);
  }, [loading, products, sourcePage]);

  if (loading) {
    return (
      <div className="aura-home-product-grid grid gap-4">
        <SkeletonLoader type="card" count={skeletonCount} />
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 text-center text-sm text-slate-400">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="aura-home-product-grid grid gap-4">
      {products.map((product, index) => (
        <div key={getProductId(product)} className="relative h-full">
          {product.recommendationMeta?.reason ? (
            <div className="pointer-events-none absolute left-3 top-3 z-30 max-w-[calc(100%-1.5rem)] rounded-full border border-neo-cyan/25 bg-zinc-950/82 px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-neo-cyan shadow-lg">
              {product.recommendationMeta.reason}
            </div>
          ) : null}
          <ProductCard product={product} harmonyIndex={index} />
        </div>
      ))}
    </div>
  );
};

export default ProductCarousel;
