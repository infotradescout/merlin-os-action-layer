import { readFileSync, existsSync } from 'node:fs';
import assert from 'node:assert/strict';

const spinePath = new URL('../MERLIN_OR_HANDOFF_SPINE.md', import.meta.url);

assert.equal(existsSync(spinePath), true, 'MERLIN_OR_HANDOFF_SPINE.md must exist');

const spine = readFileSync(spinePath, 'utf8');

function requireText(label, pattern) {
  assert.match(spine, pattern, `${label} must be documented in the handoff spine`);
}

function section(title) {
  const lines = spine.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `## ${title}`);
  assert.notEqual(start, -1, `section "${title}" must exist`);
  const body = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index].startsWith('## ')) break;
    body.push(lines[index]);
  }
  return body.join('\n').trim();
}

requireText('app identity', /## App Identity[\s\S]*Merlin OR[\s\S]*Merlin OS Action Layer[\s\S]*infotradescout\/merlin-os-action-layer/);
requireText('what it is not', /## What This App Is Not[\s\S]*Not a general chatbot[\s\S]*Not a place to add new product features/);
requireText('core flows', /## Core Operator Flows[\s\S]*Drive safety[\s\S]*MealScout review queue[\s\S]*Merlin intake\/action-card loop/);
requireText('route and API groups', /## Server Route And API Groups[\s\S]*\/api\/health[\s\S]*\/api\/drive[\s\S]*\/api\/mealscout[\s\S]*\/api\/merlin/);
requireText('data and storage model', /## Main Data And Storage Model[\s\S]*MERLIN_DB_PATH[\s\S]*drive_manifest_entries[\s\S]*merlin_action_cards[\s\S]*MEALSCOUT_AFFILIATE_TRACKING_LEDGER_PATH/);
requireText('external integrations', /## External Integrations[\s\S]*Google Drive[\s\S]*Product verification email webhook[\s\S]*Stripe, Gmail, Calendar, Canva/);
requireText('danger zones', /## Known Danger Zones[\s\S]*Profile seeding[\s\S]*verification email[\s\S]*affiliate ledger[\s\S]*Drive mutation[\s\S]*publish[\s\S]*cleanup\/delete\/archive[\s\S]*payout[\s\S]*live connector execution/);
requireText('validation commands', /## Validation Commands[\s\S]*node scripts\/merlin-or-handoff-spine\.contract\.test\.mjs[\s\S]*npm run check[\s\S]*npm run build/);
requireText('developer onboarding checklist', /## Developer Onboarding Checklist[\s\S]*Read `README\.md`[\s\S]*Inspect `src\/server\.ts`/);

const tickets = section('Next Cleanup Tickets')
  .split(/\r?\n/)
  .filter((line) => line.trim().startsWith('- '));

assert.ok(tickets.length >= 5 && tickets.length <= 10, 'handoff spine must list 5-10 cleanup tickets');
for (const ticket of tickets) {
  assert.match(ticket, /^- Cleanup: /, `cleanup ticket must be labeled as cleanup-only: ${ticket}`);
}

const proposedFeaturePattern = /^-\s*(Feature|Product|Launch|Build|Add product surface):/im;
assert.doesNotMatch(
  section('Next Cleanup Tickets'),
  proposedFeaturePattern,
  'cleanup tickets must not propose new product features'
);

requireText('no new product features policy', /No new product features are proposed by this handoff spine; cleanup tickets are documentation, inventory, validation, or contract-test work only\./);
