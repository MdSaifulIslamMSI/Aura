import { useEffect, useState } from 'react';
import { recommendationApi } from '@/services/api';
import ProductCarousel from './ProductCarousel';
import RecommendationSection from './RecommendationSection';

const RecommendedForYou = ({ limit = 8, sourcePage = 'home' }) => {
  const [recommendations, setRecommendations] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    recommendationApi.getHomeRecommendations({ limit })
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
      eyebrow="Hybrid AI"
      title="Recommended for You"
      description="Personalized from browsing, cart, wishlist, search, and catalog quality signals."
      actionHref="/search"
    >
      <ProductCarousel
        recommendations={recommendations}
        loading={loading}
        sourcePage={sourcePage}
        emptyMessage="No personalized picks yet. Trending products will appear once the catalog has enough signal."
      />
    </RecommendationSection>
  );
};

export default RecommendedForYou;
