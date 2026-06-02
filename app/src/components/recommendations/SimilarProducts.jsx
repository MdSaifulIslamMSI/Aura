import { useEffect, useState } from 'react';
import { FormattedMessage } from 'react-intl';
import { recommendationApi } from '@/services/api';
import ProductCarousel from './ProductCarousel';
import RecommendationSection from './RecommendationSection';

const SimilarProducts = ({ productId, limit = 8, sourcePage = 'product_detail' }) => {
  const [recommendations, setRecommendations] = useState([]);
  const [loading, setLoading] = useState(Boolean(productId));

  useEffect(() => {
    if (!productId) return undefined;
    let active = true;
    setLoading(true);
    recommendationApi.getSimilarProducts(productId, { limit })
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
      eyebrow="Similar Products"
      title={<FormattedMessage id="recommendations.similarProducts.title" defaultMessage="More Like This" />}
      description={<FormattedMessage id="recommendations.similarProducts.description" defaultMessage="Based on category, brand, tags, price range, rating, stock, and freshness." />}
      actionHref="/search"
    >
      <ProductCarousel recommendations={recommendations} loading={loading} sourcePage={sourcePage} />
    </RecommendationSection>
  );
};

export default SimilarProducts;
