/**
 * ProductPageSkeleton — dark-mode skeleton matching the ProductDetails 2-column layout.
 *
 * Replaces the single blank pulse div shown during initial product load.
 * Mirrors the actual card structure so users understand what's loading
 * without a disorienting flash of blank space.
 */

const Shimmer = ({ className = '' }) => (
  <div className={`animate-pulse rounded-xl bg-white/5 ${className}`} />
);

const ProductPageSkeleton = () => (
  <div className="container-custom max-w-7xl mx-auto px-4 md:px-6 py-6">
    {/* Breadcrumb */}
    <div className="flex items-center gap-2 mb-8">
      <Shimmer className="h-3 w-10" />
      <Shimmer className="h-3 w-2" />
      <Shimmer className="h-3 w-20" />
      <Shimmer className="h-3 w-2" />
      <Shimmer className="h-3 w-40" />
    </div>

    <div className="grid lg:grid-cols-12 gap-8 lg:gap-12">
      {/* Left: Product Image */}
      <div className="lg:col-span-5">
        <div className="rounded-3xl border border-white/10 bg-white/[0.045] p-6 animate-pulse">
          <Shimmer className="aspect-square w-full !rounded-2xl" />
          {/* Thumbnail strip */}
          <div className="mt-4 flex gap-2">
            {[1, 2, 3, 4].map((i) => (
              <Shimmer key={i} className="h-14 w-14 flex-shrink-0" />
            ))}
          </div>
        </div>
      </div>

      {/* Right: Details */}
      <div className="lg:col-span-7">
        <div className="rounded-3xl border border-white/10 bg-white/[0.045] p-6 md:p-10 space-y-6 animate-pulse">
          {/* Brand */}
          <Shimmer className="h-3 w-20" />
          {/* Title */}
          <div className="space-y-2">
            <Shimmer className="h-9 w-4/5" />
            <Shimmer className="h-9 w-3/5" />
          </div>
          {/* Rating row */}
          <div className="flex items-center gap-3">
            <Shimmer className="h-7 w-14 !rounded-full" />
            <Shimmer className="h-5 w-24 !rounded-full" />
            <Shimmer className="h-5 w-28 !rounded-full" />
          </div>
          {/* Price block */}
          <div className="rounded-2xl border border-white/5 bg-zinc-950/50 p-6">
            <div className="flex items-end gap-4">
              <Shimmer className="h-12 w-36" />
              <div className="space-y-1 pb-1">
                <Shimmer className="h-5 w-24" />
                <Shimmer className="h-4 w-20" />
              </div>
            </div>
          </div>
          {/* Stock indicator */}
          <div className="flex items-center gap-2">
            <Shimmer className="h-3 w-3 !rounded-full" />
            <Shimmer className="h-3 w-28" />
          </div>
          {/* Action buttons */}
          <div className="hidden lg:flex gap-4">
            <Shimmer className="h-14 w-44 !rounded-2xl" />
            <Shimmer className="h-14 w-44 !rounded-2xl" />
          </div>
          {/* Feature grid */}
          <div className="grid grid-cols-2 gap-3">
            {[1, 2, 3, 4].map((i) => (
              <Shimmer key={i} className="h-12 !rounded-xl" />
            ))}
          </div>
          {/* Trust signals */}
          <div className="grid lg:grid-cols-2 gap-4">
            <Shimmer className="h-36 !rounded-2xl" />
            <Shimmer className="h-36 !rounded-2xl" />
          </div>
        </div>
      </div>
    </div>

    {/* Tabs skeleton */}
    <div className="mt-8 rounded-3xl border border-white/10 bg-white/[0.045] p-6 space-y-4 animate-pulse">
      <div className="flex gap-4 border-b border-white/10 pb-4">
        {[1, 2, 3, 4].map((i) => (
          <Shimmer key={i} className="h-8 w-24 !rounded-full" />
        ))}
      </div>
      <div className="space-y-3 pt-2">
        <Shimmer className="h-4 w-full" />
        <Shimmer className="h-4 w-5/6" />
        <Shimmer className="h-4 w-4/5" />
        <Shimmer className="h-4 w-3/4" />
      </div>
    </div>
  </div>
);

export default ProductPageSkeleton;
