import { getHealthPayload } from './health.js';
import { getDailyPayload } from './daily.js';
import { getSearchPayload } from './search.js';

export function getRuntimeStatus() {
  return getHealthPayload();
}

export function getRuntimeDaily() {
  return getDailyPayload();
}

export function getRuntimeSearch(query = '') {
  return getSearchPayload(query);
}

console.log(JSON.stringify(getRuntimeStatus(), null, 2));
