import { cn } from '@/lib/utils';

const SkeletonLoader = ({ type = 'card', count = 1, className }) => {
  const CardSkeleton = () => (
    <div className={cn('bg-white rounded shadow-card overflow-hidden animate-pulse', className)}>
      {/* Image */}
      <div className="aspect-square bg-gray-200" />
      
      {/* Content */}
      <div className="p-4 space-y-3">
        {/* Title */}
        <div className="h-4 bg-gray-200 rounded w-3/4" />
        <div className="h-4 bg-gray-200 rounded w-1/2" />
        
        {/* Rating */}
        <div className="flex gap-2">
          <div className="h-4 bg-gray-200 rounded w-12" />
          <div className="h-4 bg-gray-200 rounded w-16" />
        </div>
        
        {/* Price */}
        <div className="flex gap-2 items-center">
          <div className="h-5 bg-gray-200 rounded w-20" />
          <div className="h-4 bg-gray-200 rounded w-16" />
        </div>
        
        {/* Discount */}
        <div className="h-4 bg-gray-200 rounded w-24" />
      </div>
    </div>
  );

  const ListSkeleton = () => (
    <div className={cn('bg-white rounded shadow-card p-4 flex gap-4 animate-pulse', className)}>
      {/* Image */}
      <div className="w-32 h-32 md:w-48 md:h-48 bg-gray-200 rounded flex-shrink-0" />
      
      {/* Content */}
      <div className="flex-1 space-y-3">
        {/* Title */}
        <div className="h-5 bg-gray-200 rounded w-3/4" />
        <div className="h-4 bg-gray-200 rounded w-1/3" />
        
        {/* Rating */}
        <div className="flex gap-2">
          <div className="h-4 bg-gray-200 rounded w-12" />
          <div className="h-4 bg-gray-200 rounded w-20" />
        </div>
        
        {/* Price */}
        <div className="flex gap-2 items-center">
          <div className="h-6 bg-gray-200 rounded w-24" />
          <div className="h-5 bg-gray-200 rounded w-20" />
          <div className="h-5 bg-gray-200 rounded w-16" />
        </div>
        
        {/* Highlights */}
        <div className="space-y-2 pt-2">
          <div className="h-3 bg-gray-200 rounded w-full" />
          <div className="h-3 bg-gray-200 rounded w-5/6" />
          <div className="h-3 bg-gray-200 rounded w-4/6" />
        </div>
      </div>
    </div>
  );

  const ProductDetailSkeleton = () => (
    <div className={cn('bg-white rounded shadow-card p-4 md:p-6 animate-pulse', className)}>
      <div className="grid md:grid-cols-2 gap-6 md:gap-10">
        {/* Image */}
        <div className="aspect-square bg-gray-200 rounded" />
        
        {/* Content */}
        <div className="space-y-4">
          {/* Title */}
          <div className="h-6 bg-gray-200 rounded w-3/4" />
          <div className="h-5 bg-gray-200 rounded w-1/2" />
          
          {/* Rating */}
          <div className="flex gap-2">
            <div className="h-5 bg-gray-200 rounded w-16" />
            <div className="h-5 bg-gray-200 rounded w-24" />
          </div>
          
          {/* Price */}
          <div className="flex gap-3 items-center">
            <div className="h-8 bg-gray-200 rounded w-28" />
            <div className="h-6 bg-gray-200 rounded w-24" />
            <div className="h-6 bg-gray-200 rounded w-20" />
          </div>
          
          {/* Buttons */}
          <div className="flex gap-4 pt-4">
            <div className="h-12 bg-gray-200 rounded w-40" />
            <div className="h-12 bg-gray-200 rounded w-40" />
          </div>
          
          {/* Highlights */}
          <div className="space-y-2 pt-4">
            <div className="h-5 bg-gray-200 rounded w-32" />
            <div className="h-4 bg-gray-200 rounded w-full" />
            <div className="h-4 bg-gray-200 rounded w-5/6" />
            <div className="h-4 bg-gray-200 rounded w-4/6" />
            <div className="h-4 bg-gray-200 rounded w-3/4" />
          </div>
        </div>
      </div>
    </div>
  );

  const CartSkeleton = () => (
    <div className={cn('bg-white rounded shadow-card p-4 animate-pulse', className)}>
      <div className="space-y-4">
        {/* Header */}
        <div className="h-6 bg-gray-200 rounded w-48" />
        
        {/* Cart Items */}
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex gap-4 py-4 border-b">
            <div className="w-24 h-24 bg-gray-200 rounded flex-shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-5 bg-gray-200 rounded w-3/4" />
              <div className="h-4 bg-gray-200 rounded w-1/3" />
              <div className="h-5 bg-gray-200 rounded w-24" />
              <div className="flex gap-2 pt-2">
                <div className="h-8 bg-gray-200 rounded w-24" />
                <div className="h-8 bg-gray-200 rounded w-20" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const renderSkeleton = () => {
    switch (type) {
      case 'list':
        return <ListSkeleton />;
      case 'detail':
        return <ProductDetailSkeleton />;
      case 'cart':
        return <CartSkeleton />;
      case 'card':
      default:
        return <CardSkeleton />;
    }
  };

  return (
    <>
      {Array.from({ length: count }).map((_, index) => (
        <div key={index}>{renderSkeleton()}</div>
      ))}
    </>
  );
};

export default SkeletonLoader;
