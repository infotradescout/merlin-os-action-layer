import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const handoffPath = 'MERLIN_OR_HANDOFF_SPINE.md';

assert.equal(existsSync(handoffPath), true, 'MERLIN_OR_HANDOFF_SPINE.md must exist');

const doc = readFileSync(handoffPath, 'utf8');

function section(title) {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^## ${escaped}$`, 'm');
  assert.match(doc, pattern, `Missing section: ${title}`);
}

function requireText(label, pattern) {
  assert.match(doc, pattern, `${label} must be documented in the handoff spine`);
}

function sectionBody(title) {
  const lines = doc.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `## ${title}`);
  assert.notEqual(start, -1, `section "${title}" must exist`);
  const body = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index].startsWith('## ')) break;
    body.push(lines[index]);
  }
  return body.join('\n').trim();
}

section('App identity');
section('What this app is');
section('What this app is not');
section('Core user and operator flows');
section('Entry routes and pages');
section('Server route and API groups');
section('Main data and storage model');
section('External integrations');
section('Deployment and runtime assumptions');
section('Known danger zones');
section('Existing workflow docs inspection');
section('Validation commands');
section('Developer onboarding checklist');
section('Next cleanup tickets');
section('No new product features proposed');

requireText('app identity', /App name: Merlin OR \/ Merlin OS Action Layer[\s\S]*infotradescout\/merlin-os-action-layer/);
requireText('what it is not', /It is not a general chatbot prompt collection[\s\S]*It is not a place to add new product features/);
requireText('core flows', /Merlin intake flow[\s\S]*Drive safety and review flow[\s\S]*MealScout review queue flow/);
requireText('entry routes and pages', /static client\/router entry points[\s\S]*\/admin\/drive-review-queue[\s\S]*\/admin\/mealscout-review-queue/);
requireText('route and API groups', /\/api\/health[\s\S]*\/api\/drive[\s\S]*\/api\/mealscout[\s\S]*\/api\/merlin\/action-cards/);
requireText('data and storage model', /MERLIN_DB_PATH[\s\S]*drive_manifest_entries[\s\S]*merlin_action_cards[\s\S]*MEALSCOUT_AFFILIATE_TRACKING_LEDGER_PATH/);
requireText('external integrations', /Google Drive[\s\S]*Product verification email webhook[\s\S]*Google\/Gmail\/Calendar\/Stripe\/Canva/);
requireText('danger zones', /Profile seeding[\s\S]*verification email[\s\S]*affiliate ledger[\s\S]*Drive mutation[\s\S]*publish[\s\S]*cleanup\/delete\/archive[\s\S]*payout[\s\S]*live connector execution/);
requireText('workflow inspection', /WORKFLOW\.md`: missing[\s\S]*CLEANUP_MAP\.md`: missing[\s\S]*CODEBASE_PATTERNS_OVERVIEW\.md`: missing[\s\S]*Repo doctor script: not found[\s\S]*Deployment config: not found[\s\S]*Client\/router entry: exists/);
requireText('validation commands', /node scripts\/merlin-or-handoff-spine\.contract\.test\.mjs[\s\S]*npm run check[\s\S]*npm run build/);
requireText('developer onboarding checklist', /Read `README\.md`[\s\S]*Inspect `src\/server\.ts`[\s\S]*Run `npm run check`/);

const cleanupTickets = [...sectionBody('Next cleanup tickets').matchAll(/^\d+\. .+/gm)].map((match) => match[0]);
assert.ok(cleanupTickets.length >= 5 && cleanupTickets.length <= 10, 'handoff spine must list 5-10 cleanup tickets');

const cleanupSection = sectionBody('Next cleanup tickets');
const forbiddenCleanupPhrases = [
  'add a new product feature',
  'add new product surface',
  'enable live connector execution',
  'add payout logic',
  'mark email_verified true',
  'mark insurance_verified true',
  'create fake users',
  'fake payment records'
];
for (const phrase of forbiddenCleanupPhrases) {
  assert.equal(cleanupSection.toLowerCase().includes(phrase), false, `cleanup tickets must not propose ${phrase}`);
}

requireText(
  'no new product features policy',
  /does not propose new user-facing features[\s\S]*new product surfaces[\s\S]*payout logic[\s\S]*profile verification shortcuts/
);

console.log('Merlin OR handoff spine contract passed');
