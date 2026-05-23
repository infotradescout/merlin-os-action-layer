import { searchLisaSignals } from './lisa.js';

export function getSearchPayload(query = '') {
  const results = searchLisaSignals(query, 10).changes.map((item, index) => ({
    id: item.id || `search-${index + 1}`,
    title: item.title,
    summary: item.summary,
    source: item.source,
    observed_at: item.observed_at,
    confidence: item.truth_score
  }));

  return {
    source: 'lisa',
    query,
    results
  };
}
