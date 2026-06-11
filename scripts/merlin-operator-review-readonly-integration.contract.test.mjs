import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const routePath = join(root, 'src', 'merlin', 'routes', 'merlinOperatorReviewPresentationRoutes.ts');
const serverPath = join(root, 'src', 'server.ts');
const viewPath = join(root, 'public', 'merlin-operator-review.html');

assert.equal(existsSync(routePath), true, 'operator review presentation route file must exist');
assert.equal(existsSync(serverPath), true, 'server file must exist');
assert.equal(existsSync(viewPath), true, 'operator review view file must exist');

const routeSource = readFileSync(routePath, 'utf8');
const serverSource = readFileSync(serverPath, 'utf8');
const viewSource = readFileSync(viewPath, 'utf8').toLowerCase();

function includesAll(text, values, label) {
  for (const value of values) {
    assert.ok(text.includes(value), `${label} must include ${value}`);
  }
}

includesAll(
  routeSource,
  [
    '/api/merlin/operator-review/presentation',
    'serializedPresentation',
    'mutationAllowed: false',
    'implementationAllowed: false',
    'executionAllowed: false',
    'AUTHORITY_REFERENCE'
  ],
  'operator review route invariants'
);

includesAll(
  viewSource,
  [
    'evidence binding',
    'detail line evidence',
    'warning evidence',
    'no_evidence:not_applicable'
  ],
  'operator review view read-only evidence surface'
);

includesAll(
  serverSource,
  [
    "pathname.startsWith('/api/merlin/operator-review')",
    "pathname === '/admin/merlin-operator-review'"
  ],
  'server integration wiring'
);

assert.equal(viewSource.includes('<button'), false, 'operator review view must not expose action buttons');

const forbiddenRoutePhrases = [
  '/api/merlin/operator-review/apply',
  '/api/merlin/operator-review/execute'
];
for (const phrase of forbiddenRoutePhrases) {
  assert.equal(routeSource.includes(phrase), false, `operator review route must not define forbidden endpoint: ${phrase}`);
}

console.log('Merlin operator review read-only integration contract passed');
