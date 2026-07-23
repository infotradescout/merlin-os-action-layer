import type { IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import { isMerlinIntakeEnabled, isMerlinSearchEnabled } from '../intake/intakeFeatureFlags.js';
import type { MerlinBrand } from '../intake/intakeTypes.js';
import { runMerlinSearch } from '../search/merlinSearch.js';

function responseJson(res: ServerResponse, payload: unknown, status = 200): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

export async function handleMerlinSearchRoute(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
  const method = (req.method || 'GET').toUpperCase();
  if (method !== 'GET' || pathname !== '/api/merlin/search') return false;

  if (!isMerlinIntakeEnabled()) {
    responseJson(res, { error: 'MERLIN_INTAKE_DISABLED', mutationAllowed: false, implementationAllowed: false }, 503);
    return true;
  }
  if (!isMerlinSearchEnabled()) {
    responseJson(res, { error: 'MERLIN_SEARCH_DISABLED', mutationAllowed: false, implementationAllowed: false }, 503);
    return true;
  }

  const url = new URL(req.url || '', 'http://localhost');
  const brand = (url.searchParams.get('brand') || '').trim().toUpperCase() as MerlinBrand;
  const q = (url.searchParams.get('q') || '').trim();
  if (!brand) {
    responseJson(res, { error: 'brand is required', mutationAllowed: false, implementationAllowed: false }, 400);
    return true;
  }

  const results = runMerlinSearch(brand, q);
  responseJson(res, {
    status: 'ok',
    brand,
    query: q,
    resultCount: results.length,
    results,
    mutationAllowed: false,
    implementationAllowed: false
  });
  return true;
}
