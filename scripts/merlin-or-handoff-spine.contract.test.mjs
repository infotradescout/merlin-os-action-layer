import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const handoffPath = 'MERLIN_OR_HANDOFF_SPINE.md';

assert.ok(existsSync(handoffPath), 'MERLIN_OR_HANDOFF_SPINE.md must exist');

const doc = readFileSync(handoffPath, 'utf8');

function section(title) {
  const pattern = new RegExp(`^## ${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm');
  assert.ok(pattern.test(doc), `Missing section: ${title}`);
}

function includes(text, message) {
  assert.ok(doc.includes(text), message || `Expected handoff spine to include: ${text}`);
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
section('Validation commands');
section('Developer onboarding checklist');
section('Next cleanup tickets');
section('No new product features proposed');

includes('App name: Merlin OR / Merlin OS Action Layer.', 'App identity must be defined');
includes('It is not a general chatbot prompt collection.', 'What it is not must be defined');
includes('Merlin intake flow', 'Core flows must be listed');
includes('/api/merlin/action-cards', 'Route/API groups must be listed');
includes('merlin_action_cards', 'Data/storage model must be listed');
includes('Google Drive', 'External integrations must be listed');
includes('Known danger zones', 'Danger zones must be listed');
includes('npm run check', 'Validation commands must be listed');
includes('Developer onboarding checklist', 'Developer onboarding checklist must exist');

const cleanupTicketMatches = [...doc.matchAll(/^\d+\. .+/gm)].filter((match) => {
  const index = match.index || 0;
  const before = doc.slice(0, index);
  const lastHeading = before.match(/^## .+$/gm)?.at(-1);
  return lastHeading === '## Next cleanup tickets';
});
assert.ok(cleanupTicketMatches.length >= 5 && cleanupTicketMatches.length <= 10, 'Expected 5 to 10 cleanup tickets');

const cleanupSection = doc.split('## Next cleanup tickets')[1]?.split('## No new product features proposed')[0] || '';
const forbiddenCleanupPhrases = [
  'add a new product feature',
  'add new product surface',
  'enable live connector execution',
  'add payout logic',
  'mark email_verified true',
  'mark insurance_verified true'
];
for (const phrase of forbiddenCleanupPhrases) {
  assert.equal(cleanupSection.toLowerCase().includes(phrase), false, `Cleanup tickets must not propose ${phrase}`);
}

includes('does not propose new user-facing features', 'Document must explicitly avoid new product features');

console.log('Merlin OR handoff spine contract passed');
