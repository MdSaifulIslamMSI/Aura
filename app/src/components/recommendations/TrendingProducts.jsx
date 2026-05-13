import { useEffect, useState } from 'react';
import { recommendationApi } from '@/services/api';
import ProductCarousel from './ProductCarousel';
import RecommendationSection from './RecommendationSection';

const TrendingProducts = ({ limit = 8, sourcePage = 'home' }) => {
  const [recommendations, setRecommendations] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    recommendationApi.getTrendingProducts({ limit })
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
  }, [limit]);

  if (!loading && recommendations.length === 0) return null;

  return (
    <RecommendationSection
      eyebrow="Live momentum"
      title="Trending Now"
      description="Ranked from recent product views, cart adds, wishlist saves, purchases, and recommendation clicks."
      actionHref="/trending"
    >
      <ProductCarousel recommendations={recommendations} loading={loading} sourcePage={sourcePage} />
    </RecommendationSection>
  );
};

export default TrendingProducts;
