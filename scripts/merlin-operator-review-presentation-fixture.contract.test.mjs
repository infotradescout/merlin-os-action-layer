import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const fixturePath = join(root, 'src', 'merlin', 'intake', 'operatorReviewPresentationFixture.ts');

assert.equal(existsSync(fixturePath), true, 'operator review dashboard fixture file must exist');

const fixtureSource = readFileSync(fixturePath, 'utf8');

function includesAll(text, values, label) {
  for (const value of values) {
    assert.ok(text.includes(value), `${label} must include ${value}`);
  }
}

includesAll(
  fixtureSource,
  [
    'createHeldRoutingOperatorReviewDashboardFixture',
    'createHeldRoutingOperatorReviewPresentation',
    'serializeHeldRoutingOperatorReviewPresentation',
    "mode: 'read_only'",
    'advisoryOnly: true',
    'mutationAllowed: false',
    'implementationAllowed: false',
    'executionAllowed: false'
  ],
  'fixture read-only invariants'
);

const forbiddenPatterns = [
  /\/api\//,
  /createMerlinServer/,
  /executeMealScoutPublishPlan/,
  /applyHeldRouting/, 
  /implementationMode:\s*'execute'/,
  /mutationAllowed:\s*true/,
  /implementationAllowed:\s*true/,
  /executionAllowed:\s*true/
];
for (const pattern of forbiddenPatterns) {
  assert.doesNotMatch(fixtureSource, pattern, `fixture must not include runtime or authority escalation pattern: ${pattern}`);
}

console.log('Merlin operator review presentation fixture contract passed');
