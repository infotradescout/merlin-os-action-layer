import { getHealthPayload } from './health.js';
import { getDailyPayload } from './daily.js';
import { getSearchPayload } from './search.js';
import { getEntityState, getEntityTimeline, getRecentChanges, ingestTradeScoutEvent } from './lisa.js';

export function getRuntimeStatus() {
  return getHealthPayload();
}

export function getRuntimeDaily() {
  return getDailyPayload();
}

export function getRuntimeSearch(query = '') {
  return getSearchPayload(query);
}

export function getRuntimeEntityState(entityId: string) {
  return getEntityState(entityId);
}

export function getRuntimeEntityTimeline(entityId: string, limit = 20) {
  return getEntityTimeline(entityId, limit);
}

export function getRuntimeRecentChanges(limit = 20) {
  return getRecentChanges(limit);
}

export function postRuntimeTradeScoutEvent(payload: unknown) {
  return ingestTradeScoutEvent(payload as { entity_id: string });
}
