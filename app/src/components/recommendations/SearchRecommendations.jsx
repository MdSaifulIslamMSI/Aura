import { useEffect, useState } from 'react';
import { FormattedMessage } from 'react-intl';
import { recommendationApi } from '@/services/api';
import ProductCarousel from './ProductCarousel';
import RecommendationSection from './RecommendationSection';

const SearchRecommendations = ({ query = '', limit = 8, sourcePage = 'search' }) => {
  const [recommendations, setRecommendations] = useState([]);
  const [loading, setLoading] = useState(Boolean(query));

  useEffect(() => {
    if (!query) return undefined;
    let active = true;
    setLoading(true);
    recommendationApi.getSearchRecommendations({ query, limit })
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
  }, [limit, query]);

  if (!query || (!loading && recommendations.length === 0)) return null;

  return (
    <RecommendationSection
      eyebrow="Search intent"
      title={<FormattedMessage id="recommendations.search.title" defaultMessage="Related to Your Search" />}
      description={<FormattedMessage id="recommendations.search.description" defaultMessage={'Products connected to "{query}" and reranked with live recommendation signals.'} values={{ query }} />}
      actionHref={`/search?q=${encodeURIComponent(query)}`}
    >
      <ProductCarousel recommendations={recommendations} loading={loading} sourcePage={sourcePage} />
    </RecommendationSection>
  );
};

export default SearchRecommendations;
