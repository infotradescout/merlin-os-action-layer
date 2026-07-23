import type { IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import { getMerlinOperatorConsolePayload } from '../operatorConsoleRuntime.js';

function responseJson(res: ServerResponse, payload: unknown, status = 200): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

function readLimit(url: URL): number | undefined {
  const raw = Number(url.searchParams.get('limit') || '');
  return Number.isFinite(raw) && raw > 0 ? raw : undefined;
}

export async function handleMerlinOperatorConsoleRoute(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
  const method = (req.method || 'GET').toUpperCase();
  if (method !== 'GET') return false;

  if (pathname === '/api/merlin/operator-console') {
    const url = new URL(req.url || '', 'http://localhost');
    responseJson(
      res,
      getMerlinOperatorConsolePayload({
        brand_lane: url.searchParams.get('brand_lane') || undefined,
        entity_id: url.searchParams.get('entity_id') || undefined,
        limit: readLimit(url)
      })
    );
    return true;
  }

  const brandMatch = pathname.match(/^\/api\/merlin\/operator-console\/brand\/([^/]+)$/);
  if (brandMatch) {
    const url = new URL(req.url || '', 'http://localhost');
    responseJson(
      res,
      getMerlinOperatorConsolePayload({
        brand_lane: decodeURIComponent(brandMatch[1]),
        limit: readLimit(url)
      })
    );
    return true;
  }

  const entityMatch = pathname.match(/^\/api\/merlin\/operator-console\/entity\/([^/]+)$/);
  if (entityMatch) {
    const url = new URL(req.url || '', 'http://localhost');
    responseJson(
      res,
      getMerlinOperatorConsolePayload({
        entity_id: decodeURIComponent(entityMatch[1]),
        limit: readLimit(url)
      })
    );
    return true;
  }

  return false;
}
