import type { IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import { getMerlinSystemConnectorById, listMerlinSystemConnectors } from '../systemConnectorRuntime.js';

function responseJson(res: ServerResponse, payload: unknown, status = 200): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

function asText(input: unknown): string {
  return typeof input === 'string' ? input.trim() : '';
}

export async function handleMerlinSystemConnectorRoute(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string
): Promise<boolean> {
  const method = (req.method || 'GET').toUpperCase();

  if (method === 'GET' && pathname === '/api/merlin/system-connectors') {
    const url = new URL(req.url || '', 'http://localhost');
    const brand = asText(url.searchParams.get('brand')).toUpperCase() as 'MEALSCOUT' | 'TRADESCOUT' | '';
    const sourceKey = asText(url.searchParams.get('source_key')) || undefined;
    responseJson(res, {
      mutationAllowed: false,
      connectors: listMerlinSystemConnectors({
        brand: brand === 'MEALSCOUT' || brand === 'TRADESCOUT' ? brand : undefined,
        source_key: sourceKey
      })
    });
    return true;
  }

  const connectorMatch = pathname.match(/^\/api\/merlin\/system-connectors\/([^/]+)$/);
  if (method === 'GET' && connectorMatch) {
    const connector = getMerlinSystemConnectorById(decodeURIComponent(connectorMatch[1]));
    if (!connector) {
      responseJson(res, { error: 'system_connector_not_found', mutationAllowed: false }, 404);
      return true;
    }
    responseJson(res, { mutationAllowed: false, connector });
    return true;
  }

  return false;
}
