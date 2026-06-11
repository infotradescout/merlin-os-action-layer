import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const typesPath = join(root, 'src', 'merlin', 'intake', 'intakeTypes.ts');
const summaryPath = join(root, 'src', 'merlin', 'intake', 'operatorReviewSummary.ts');
const presentationPath = join(root, 'src', 'merlin', 'intake', 'operatorReviewPresentation.ts');

assert.equal(existsSync(typesPath), true, 'intake types file must exist');
assert.equal(existsSync(summaryPath), true, 'operator review summary file must exist');
assert.equal(existsSync(presentationPath), true, 'operator review presentation file must exist');

const types = readFileSync(typesPath, 'utf8');
const summary = readFileSync(summaryPath, 'utf8');
const presentation = readFileSync(presentationPath, 'utf8');

function includesAll(text, values, label) {
  for (const value of values) {
    assert.ok(text.includes(value), `${label} must include ${value}`);
  }
}

includesAll(
  types,
  [
    'export type HeldRoutingOperatorReviewPresentation = {',
    "mode: 'read_only';",
    'advisoryOnly: true;',
    'evidenceBindings: {',
    'detailLines: Array<{',
    'warnings: Array<{',
    'summary: HeldRoutingOperatorReviewSummary;',
    'mutationAllowed: false;',
    'implementationAllowed: false;',
    'executionAllowed: false;'
  ],
  'presentation type safety'
);

includesAll(
  presentation,
  [
    'export function createHeldRoutingOperatorReviewPresentation(',
    "status: 'ok'",
    "mode: 'read_only'",
    'advisoryOnly: true',
    'evidenceBindings:',
    'mutationAllowed: false',
    'implementationAllowed: false',
    'executionAllowed: false',
    'export function serializeHeldRoutingOperatorReviewPresentation('
  ],
  'presentation implementation safety'
);

includesAll(
  summary,
  [
    "nextRequiredAction = 'blocked'",
    'operatorWarnings: warnings',
    'mutationAllowed: false',
    'implementationAllowed: false',
    'executionAllowed: false'
  ],
  'summary safety invariants'
);

const forbiddenExecutionPhrases = [
  'live executor run',
  'executeLive',
  'applyDestination',
  'performMutation',
  'publishNow',
  'webhook',
  'discord',
  'google drive',
  'google sheets'
];
for (const phrase of forbiddenExecutionPhrases) {
  assert.equal(presentation.toLowerCase().includes(phrase.toLowerCase()), false, `presentation must not include forbidden behavior phrase: ${phrase}`);
}

console.log('Merlin operator review summary presentation contract passed');
