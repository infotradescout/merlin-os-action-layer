import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { after, beforeEach, test } from 'node:test';
import Database from 'better-sqlite3';

const tempDir = mkdtempSync(resolve(tmpdir(), 'merlin-github-oauth-'));
const dbPath = resolve(tempDir, 'merlin.sqlite');
process.env.MERLIN_DB_PATH = dbPath;
process.env.MERLIN_RUNTIME = 'test';
process.env.GITHUB_CLIENT_ID = 'synthetic-client-id';
process.env.GITHUB_CLIENT_SECRET = 'synthetic-client-secret';
process.env.GITHUB_OAUTH_REDIRECT_URI = 'http://localhost/api/merlin/connected-sources/github/callback';

const {
  handleMerlinGithubOAuthRoute,
  resetMerlinGithubOAuthStateForTest
} = await import('../src/merlin/routes/merlinGithubOAuthRoutes.ts');
const {
  closeMerlinConnectedSourceRuntime,
  listMerlinConnectedSources,
  resetMerlinConnectedSourceRuntimeForTest,
  upsertMerlinConnectedSource
} = await import('../src/merlin/connectedSourceRuntime.ts');
const { closeMerlinWorkspaceRuntime } = await import('../src/merlin/workspaceRuntime.ts');
const { closeMerlinActionCardRuntime } = await import('../src/merlin/actionCardRuntime.ts');

type RouteResult = {
  handled: boolean;
  statusCode: number;
  location: string;
};

async function invokeRoute(pathname: string, query = ''): Promise<RouteResult> {
  const headers = new Map<string, string>();
  let ended = false;
  const req = {
    method: 'GET',
    url: `${pathname}${query}`
  } as IncomingMessage;
  const res = {
    statusCode: 200,
    setHeader(name: string, value: string | number | readonly string[]) {
      headers.set(name.toLowerCase(), String(value));
      return this;
    },
    end() {
      ended = true;
      return this;
    }
  } as unknown as ServerResponse;

  const handled = await handleMerlinGithubOAuthRoute(req, res, pathname);
  assert.equal(ended, handled, 'handled redirects must end the response');
  return {
    handled,
    statusCode: res.statusCode,
    location: headers.get('location') || ''
  };
}

function stateFromAuthorizeLocation(location: string): string {
  const authorizeUrl = new URL(location);
  assert.equal(authorizeUrl.origin, 'https://github.com');
  assert.equal(authorizeUrl.pathname, '/login/oauth/authorize');
  return authorizeUrl.searchParams.get('state') || '';
}

beforeEach(() => {
  process.env.GITHUB_CLIENT_ID = 'synthetic-client-id';
  process.env.GITHUB_CLIENT_SECRET = 'synthetic-client-secret';
  process.env.GITHUB_OAUTH_REDIRECT_URI = 'http://localhost/api/merlin/connected-sources/github/callback';
  resetMerlinGithubOAuthStateForTest();
  resetMerlinConnectedSourceRuntimeForTest();
});

after(() => {
  closeMerlinConnectedSourceRuntime();
  closeMerlinWorkspaceRuntime();
  closeMerlinActionCardRuntime();
  rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
});

test('authorize redirects to GitHub with exact configuration, scope, and an opaque state', async () => {
  const result = await invokeRoute(
    '/api/merlin/connected-sources/github/authorize',
    '?workspace_id=workspace-oauth'
  );

  assert.equal(result.handled, true);
  assert.equal(result.statusCode, 302);
  const authorizeUrl = new URL(result.location);
  assert.equal(authorizeUrl.searchParams.get('client_id'), 'synthetic-client-id');
  assert.equal(
    authorizeUrl.searchParams.get('redirect_uri'),
    'http://localhost/api/merlin/connected-sources/github/callback'
  );
  assert.equal(authorizeUrl.searchParams.get('scope'), 'read:user,repo');
  assert.match(stateFromAuthorizeLocation(result.location), /^[0-9a-f-]{36}$/);
});

test('a denied callback consumes its known state and prevents replay', async () => {
  const authorize = await invokeRoute(
    '/api/merlin/connected-sources/github/authorize',
    '?workspace_id=workspace-denied'
  );
  const state = stateFromAuthorizeLocation(authorize.location);

  const denied = await invokeRoute(
    '/api/merlin/connected-sources/github/callback',
    `?state=${encodeURIComponent(state)}&error=access_denied`
  );
  assert.equal(denied.location, '/merlin?connect_error=github_denied');

  const replay = await invokeRoute(
    '/api/merlin/connected-sources/github/callback',
    `?state=${encodeURIComponent(state)}&code=should-not-run`
  );
  assert.equal(replay.location, '/merlin?connect_error=invalid_state');
});

test('successful callback stores tokens privately, exposes account identity, preserves credentials, and consumes state', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === 'https://github.com/login/oauth/access_token') {
      return new Response(
        JSON.stringify({
          access_token: 'synthetic-access-token',
          scope: 'read:user,repo',
          token_type: 'bearer'
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (url === 'https://api.github.com/user') {
      return new Response(
        JSON.stringify({ login: 'octocat', id: 1 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    throw new Error(`Unexpected fetch URL: ${url}`);
  }) as typeof fetch;

  try {
    const authorize = await invokeRoute(
      '/api/merlin/connected-sources/github/authorize',
      '?workspace_id=workspace-success'
    );
    const state = stateFromAuthorizeLocation(authorize.location);
    const callback = await invokeRoute(
      '/api/merlin/connected-sources/github/callback',
      `?state=${encodeURIComponent(state)}&code=synthetic-code`
    );

    assert.equal(callback.location, '/merlin?connected=github');
    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.url, 'https://github.com/login/oauth/access_token');
    const tokenRequest = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>;
    assert.deepEqual(tokenRequest, {
      client_id: 'synthetic-client-id',
      client_secret: 'synthetic-client-secret',
      redirect_uri: 'http://localhost/api/merlin/connected-sources/github/callback',
      code: 'synthetic-code'
    });
    assert.equal(
      new Headers(calls[1]?.init?.headers).get('Authorization'),
      'Bearer synthetic-access-token'
    );

    const rawDb = new Database(dbPath, { readonly: true });
    const stored = rawDb.prepare(
      `SELECT oauth_access_token, oauth_scope, external_account_login
       FROM merlin_connected_sources
       WHERE workspace_id = ? AND source_key = ?`
    ).get('workspace-success', 'github') as {
      oauth_access_token: string;
      oauth_scope: string;
      external_account_login: string;
    };
    rawDb.close();
    assert.deepEqual(stored, {
      oauth_access_token: 'synthetic-access-token',
      oauth_scope: 'read:user,repo',
      external_account_login: 'octocat'
    });

    const publicRecord = listMerlinConnectedSources('workspace-success').find(
      (source) => source.source_key === 'github'
    );
    assert.equal(publicRecord?.external_account_login, 'octocat');
    assert.equal(JSON.stringify(publicRecord).includes('synthetic-access-token'), false);

    upsertMerlinConnectedSource({
      workspace_id: 'workspace-success',
      source_key: 'github',
      connection_status: 'connected',
      metadata: { note: 'status-only-update' }
    });
    const verifyDb = new Database(dbPath, { readonly: true });
    const preserved = verifyDb.prepare(
      `SELECT oauth_access_token FROM merlin_connected_sources
       WHERE workspace_id = ? AND source_key = ?`
    ).get('workspace-success', 'github') as { oauth_access_token: string };
    verifyDb.close();
    assert.equal(preserved.oauth_access_token, 'synthetic-access-token');

    const replay = await invokeRoute(
      '/api/merlin/connected-sources/github/callback',
      `?state=${encodeURIComponent(state)}&code=replay-code`
    );
    assert.equal(replay.location, '/merlin?connect_error=invalid_state');
    assert.equal(calls.length, 2, 'replayed state must not call GitHub');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('authorize fails closed when OAuth configuration is incomplete', async () => {
  delete process.env.GITHUB_CLIENT_SECRET;
  const result = await invokeRoute('/api/merlin/connected-sources/github/authorize');
  assert.equal(result.statusCode, 302);
  assert.equal(result.location, '/merlin?connect_error=github_not_configured');
});
