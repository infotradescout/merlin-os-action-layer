import type { IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import {
  getMerlinConnectorAdapterById,
  listMerlinConnectorAdapterChecks,
  listMerlinConnectorAdapters,
  runMerlinConnectorAdapterCheck
} from '../connectorAdapterRuntime.js';

function responseJson(res: ServerResponse, payload: unknown, status = 200): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

function asText(input: unknown): string {
  return typeof input === 'string' ? input.trim() : '';
}

export async function handleMerlinConnectorAdapterRoute(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
  const method = (req.method || 'GET').toUpperCase();

  if (method === 'GET' && pathname === '/api/merlin/connector-adapters') {
    const url = new URL(req.url || '', 'http://localhost');
    const limitRaw = Number(url.searchParams.get('limit') || '100');
    responseJson(res, {
      mutationAllowed: false,
      adapters: listMerlinConnectorAdapters({
        tool: asText(url.searchParams.get('tool')) || undefined,
        action: asText(url.searchParams.get('action')) || undefined,
        limit: Number.isFinite(limitRaw) ? limitRaw : 100
      })
    });
    return true;
  }

  const adapterMatch = pathname.match(/^\/api\/merlin\/connector-adapters\/([^/]+)$/);
  if (method === 'GET' && adapterMatch) {
    const adapter = getMerlinConnectorAdapterById(decodeURIComponent(adapterMatch[1]));
    if (!adapter) return responseJson(res, { error: 'adapter_not_found', mutationAllowed: false }, 404), true;
    responseJson(res, { mutationAllowed: false, adapter });
    return true;
  }

  const checkMatch = pathname.match(/^\/api\/merlin\/execution-plans\/([^/]+)\/adapter-check$/);
  if (method === 'POST' && checkMatch) {
    try {
      const check = runMerlinConnectorAdapterCheck(decodeURIComponent(checkMatch[1]));
      responseJson(res, { mutationAllowed: false, check }, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'adapter_check_failed';
      responseJson(res, { error: message, mutationAllowed: false }, message === 'execution_plan_not_found' ? 404 : 409);
    }
    return true;
  }

  const checksMatch = pathname.match(/^\/api\/merlin\/execution-plans\/([^/]+)\/adapter-checks$/);
  if (method === 'GET' && checksMatch) {
    responseJson(res, {
      mutationAllowed: false,
      checks: listMerlinConnectorAdapterChecks({ execution_plan_id: decodeURIComponent(checksMatch[1]) })
    });
    return true;
  }

  return false;
}
