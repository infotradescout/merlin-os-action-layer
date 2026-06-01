import { searchLisaSignals } from './lisa.js';
import { searchMerlinActionCards } from './merlin/actionCardRuntime.js';

export function getSearchPayload(query = '') {
  const signalResults = searchLisaSignals(query, 10).changes.map((item, index) => ({
    id: item.id || `search-${index + 1}`,
    title: item.title,
    summary: item.summary,
    source: item.source,
    observed_at: item.observed_at,
    confidence: item.truth_score
  }));
  const cardResults = searchMerlinActionCards(query, 10).map((card, index) => ({
    id: card.id || `action-card-${index + 1}`,
    title: `[Action Card] ${card.intent}`,
    summary: `${card.brand} · ${card.kpi} · status:${card.status} · action:${card.action}`,
    source: 'merlin_action_card',
    observed_at: card.updated_at,
    confidence: card.policy_result.blocked ? 0.1 : 0.8
  }));
  const results = [...cardResults, ...signalResults].slice(0, 20);

  return {
    source: 'lisa+merlin_action_cards',
    query,
    results
  };
}
