import type { IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import { buildMerlinWeeklyScoreboardSnapshot, getMerlinWeeklyScoreboardContract } from '../weeklyScoreboardContract.js';

function responseJson(res: ServerResponse, payload: unknown, status = 200): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

function asText(value: string | null): string | undefined {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > 0 ? text : undefined;
}

export async function handleMerlinScoreboardRoute(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
  const method = (req.method || 'GET').toUpperCase();
  if (method !== 'GET') return false;

  if (pathname === '/api/merlin/scoreboard/contract') {
    responseJson(res, { mutationAllowed: false, contract: getMerlinWeeklyScoreboardContract() });
    return true;
  }

  if (pathname === '/api/merlin/scoreboard/weekly') {
    const url = new URL(req.url || '', 'http://localhost');
    try {
      const snapshot = buildMerlinWeeklyScoreboardSnapshot({
        weekStart: asText(url.searchParams.get('week_start')),
        weekEnd: asText(url.searchParams.get('week_end')),
        brandLane: asText(url.searchParams.get('brand_lane'))
      });
      responseJson(res, snapshot);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'scoreboard_snapshot_failed';
      responseJson(res, { mutationAllowed: false, error: message }, message === 'invalid_week_range' ? 400 : 500);
    }
    return true;
  }

  return false;
}
