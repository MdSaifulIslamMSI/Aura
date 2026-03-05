// Hyperscale-optimized formatter (Singleton)
// Prevents garbage collection churn on list renders
export const priceFormatter = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
});

export const formatPrice = (price) => priceFormatter.format(price);
