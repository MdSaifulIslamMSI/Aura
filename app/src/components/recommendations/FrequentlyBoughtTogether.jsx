import { useEffect, useState } from 'react';
import { recommendationApi } from '@/services/api';
import ProductCarousel from './ProductCarousel';
import RecommendationSection from './RecommendationSection';

const FrequentlyBoughtTogether = ({ productId, limit = 6, sourcePage = 'product_detail' }) => {
  const [recommendations, setRecommendations] = useState([]);
  const [loading, setLoading] = useState(Boolean(productId));

  useEffect(() => {
    if (!productId) return undefined;
    let active = true;
    setLoading(true);
    recommendationApi.getFrequentlyBoughtTogether(productId, { limit })
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
  }, [limit, productId]);

  if (!loading && recommendations.length === 0) return null;

  return (
    <RecommendationSection
      eyebrow="Bought together"
      title="Frequently Bought Together"
      description="Order-history co-occurrence first, then category and accessory fallbacks."
      actionHref="/search"
    >
      <ProductCarousel recommendations={recommendations} loading={loading} sourcePage={sourcePage} />
    </RecommendationSection>
  );
};

export default FrequentlyBoughtTogether;
