import { useEffect, useState } from 'react';
import { FormattedMessage } from 'react-intl';
import { recommendationApi } from '@/services/api';
import ProductCarousel from './ProductCarousel';
import RecommendationSection from './RecommendationSection';

const CartRecommendations = ({ cartItems = [], limit = 8, sourcePage = 'cart' }) => {
  const [recommendations, setRecommendations] = useState([]);
  const [loading, setLoading] = useState(cartItems.length > 0);

  useEffect(() => {
    if (!cartItems.length) return undefined;
    let active = true;
    setLoading(true);
    const compactItems = cartItems.map((item) => ({
      productId: item?.id || item?._id || item?.productId || '',
      quantity: Math.max(1, Number(item?.quantity || 1)),
    })).filter((item) => item.productId);

    recommendationApi.getCartRecommendations({ cartItems: compactItems, limit })
      .then((payload) => {
        if (active) setRecommendations(payload.recommendations || []);
      })
      .catch(() => {
        if (active) setRecommendations([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [cartItems, limit]);

  if (!cartItems.length || (!loading && recommendations.length === 0)) return null;

  return (
    <RecommendationSection
      eyebrow="Cart intelligence"
      title={<FormattedMessage id="recommendations.cart.title" defaultMessage="Complete Your Cart" />}
      description={<FormattedMessage id="recommendations.cart.description" defaultMessage="Add-ons and frequently bought together picks, excluding what is already in your bag." />}
      actionHref="/search"
    >
      <ProductCarousel recommendations={recommendations} loading={loading} sourcePage={sourcePage} />
    </RecommendationSection>
  );
};

export default CartRecommendations;
