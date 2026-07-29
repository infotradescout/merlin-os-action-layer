import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

function read(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

test('GitHub uses the OAuth authorize route while other sources retain honest manual-connect copy', () => {
  const source = read('web/src/ConnectedAppsList.tsx');
  assert.match(source, /const OAUTH_SOURCE_KEYS = new Set\(\['github'\]\)/);
  assert.match(
    source,
    /\/api\/merlin\/connected-sources\/github\/authorize\?workspace_id=\$\{encodeURIComponent\(props\.workspaceId\)\}/
  );
  assert.match(source, /No live account sign-in happens yet\./);
  assert.match(source, /Opens GitHub's sign-in page to authorize Merlin\./);
  assert.match(source, /Connected via GitHub OAuth\./);
});

test('the shell reports OAuth outcomes and removes callback query parameters from browser history', () => {
  const source = read('web/src/App.tsx');
  assert.match(source, /github_not_configured:/);
  assert.match(source, /invalid_state:/);
  assert.match(source, /github_denied:/);
  assert.match(source, /github_oauth_failed:/);
  assert.match(source, /params\.delete\('connected'\)/);
  assert.match(source, /params\.delete\('connect_error'\)/);
  assert.match(source, /window\.history\.replaceState/);
});

test('deployment and setup documentation name secret inputs without embedding secret values', () => {
  const blueprint = read('render.yaml');
  const setup = read('docs/GITHUB_OAUTH_SETUP.md');
  for (const key of ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GITHUB_OAUTH_REDIRECT_URI']) {
    assert.match(blueprint, new RegExp(`key: ${key}`));
    assert.match(setup, new RegExp(key));
  }
  assert.match(blueprint, /key: GITHUB_CLIENT_SECRET\s+sync: false/);
  assert.match(setup, /GITHUB_CLIENT_SECRET=\.\.\./);
  assert.doesNotMatch(`${blueprint}\n${setup}`, /gh[opusr]_[A-Za-z0-9_]{20,}/);
});
