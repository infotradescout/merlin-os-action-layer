import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const runbookPath = 'docs/mealscout/MEALSCOUT_SEED_LIVE_APPLY_OPERATOR_RUNBOOK.md';

function readRunbook(): string {
  return readFileSync(runbookPath, 'utf8');
}

test('MealScout seed live apply runbook documents required human-control gates', () => {
  const runbook = readRunbook();
  const requiredText = [
    '56415bf',
    'b69bbc0dc150dc33667bb05eb5f8349dc3961f023919d20c62ac9a261067d2b3',
    'artifacts/mealscout-seed-import-readiness/batch001-dry-run-review.json',
    'artifacts/mealscout-seed-import-readiness/batch001-dry-run-review.md',
    'artifacts/mealscout-seed-import-readiness/batch001-apply-simulation-report.json',
    'artifacts/mealscout-seed-import-readiness/batch001-apply-simulation-report.md',
    'allowLiveApply=true',
    'BATCH-001-MEALSCOUT-MERLIN-SEED',
    'Copied evidence file ID is import identity',
    'Original source file ID is audit-only provenance',
    'Blank/null fields must never overwrite populated profile fields',
    '## Stop Conditions',
    '## Rollback/Fix-Forward'
  ];

  for (const text of requiredText) {
    assert.equal(runbook.includes(text), true, `missing runbook text: ${text}`);
  }

  assert.match(runbook, /do not run live apply/i);
});
