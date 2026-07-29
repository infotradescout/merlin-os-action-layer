import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { URL } from 'node:url';
import {
  buildGithubAuthorizeUrl,
  exchangeGithubOAuthCode,
  fetchGithubAuthenticatedUser,
  isGithubOAuthConfigured
} from '../../githubOAuthClient.js';
import { upsertMerlinConnectedSource, upsertMerlinConnectedSourceOAuthTokens } from '../connectedSourceRuntime.js';
import { MERLIN_SYSTEM_WORKSPACE_ID } from '../workspaceRuntime.js';

const STATE_TTL_MS = 10 * 60 * 1000;

type PendingState = { workspaceId: string; createdAt: number };

const pendingStates = new Map<string, PendingState>();

export function resetMerlinGithubOAuthStateForTest(): void {
  pendingStates.clear();
}

function sweepExpiredStates(): void {
  const now = Date.now();
  for (const [state, entry] of pendingStates.entries()) {
    if (now - entry.createdAt > STATE_TTL_MS) pendingStates.delete(state);
  }
}

function redirect(res: ServerResponse, location: string): void {
  res.statusCode = 302;
  res.setHeader('Location', location);
  res.end();
}

function asText(value: string | null): string {
  return (value || '').trim();
}

export async function handleMerlinGithubOAuthRoute(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
  const method = (req.method || 'GET').toUpperCase();
  const url = new URL(req.url || '', 'http://localhost');

  if (method === 'GET' && pathname === '/api/merlin/connected-sources/github/authorize') {
    sweepExpiredStates();
    if (!isGithubOAuthConfigured()) {
      redirect(res, '/merlin?connect_error=github_not_configured');
      return true;
    }
    const workspaceId = asText(url.searchParams.get('workspace_id')) || MERLIN_SYSTEM_WORKSPACE_ID;
    const state = randomUUID();
    pendingStates.set(state, { workspaceId, createdAt: Date.now() });
    redirect(res, buildGithubAuthorizeUrl(state));
    return true;
  }

  if (method === 'GET' && pathname === '/api/merlin/connected-sources/github/callback') {
    sweepExpiredStates();
    const state = asText(url.searchParams.get('state'));
    const pending = state ? pendingStates.get(state) : undefined;
    if (pending) pendingStates.delete(state);

    const errorParam = asText(url.searchParams.get('error'));
    if (errorParam) {
      redirect(res, '/merlin?connect_error=github_denied');
      return true;
    }

    const code = asText(url.searchParams.get('code'));
    if (!state || !code || !pending) {
      redirect(res, '/merlin?connect_error=invalid_state');
      return true;
    }

    try {
      const tokenResult = await exchangeGithubOAuthCode(code);
      const githubUser = await fetchGithubAuthenticatedUser(tokenResult.access_token);

      upsertMerlinConnectedSource({
        workspace_id: pending.workspaceId,
        source_key: 'github',
        source_label: 'GitHub',
        source_type: 'github',
        connection_status: 'connected',
        auth_kind: 'oauth',
        capabilities: ['read_repo', 'draft_changes']
      });
      upsertMerlinConnectedSourceOAuthTokens({
        workspace_id: pending.workspaceId,
        source_key: 'github',
        access_token: tokenResult.access_token,
        scope: tokenResult.scope,
        external_account_login: githubUser.login
      });

      redirect(res, '/merlin?connected=github');
    } catch {
      redirect(res, '/merlin?connect_error=github_oauth_failed');
    }
    return true;
  }

  return false;
}
