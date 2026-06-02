import { searchLisaSignals } from './lisa.js';
import { searchMerlinActionCards } from './merlin/actionCardRuntime.js';
import { searchMerlinIntakeItems } from './merlin/intakeRuntime.js';

export function getSearchPayload(query = '') {
  const intakeResults = searchMerlinIntakeItems(query, 10).map((item, index) => ({
    id: item.id || `intake-item-${index + 1}`,
    title: `[Intake] ${item.intent_text || item.raw_text || item.source_reference}`,
    summary: `${item.brand_lane} · ${item.source_type} · status:${item.status} · source:${item.source_reference}`,
    source: 'merlin_intake_item',
    observed_at: item.updated_at,
    confidence: item.confidence
  }));
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
  const results = [...intakeResults, ...cardResults, ...signalResults].slice(0, 20);

  return {
    source: 'lisa+merlin_intake+merlin_action_cards',
    query,
    results
  };
}
