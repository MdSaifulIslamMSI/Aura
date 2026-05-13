import { useEffect, useState } from 'react';
import { recommendationApi } from '@/services/api';
import ProductCarousel from './ProductCarousel';
import RecommendationSection from './RecommendationSection';

const RecentlyViewedRecommendations = ({ limit = 8, sourcePage = 'product_detail' }) => {
  const [recommendations, setRecommendations] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    recommendationApi.getRecentlyViewedRecommendations({ limit })
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
      eyebrow="Recently viewed"
      title="Inspired by Your Recent Views"
      description="A session-aware lane for guests and signed-in shoppers."
      actionHref="/search"
    >
      <ProductCarousel recommendations={recommendations} loading={loading} sourcePage={sourcePage} />
    </RecommendationSection>
  );
};

export default RecentlyViewedRecommendations;
