import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const auditPath = join(root, 'MERLIN_OPERATOR_POLISH_AUDIT.md');
const indexPath = join(root, 'public', 'index.html');
const serverPath = join(root, 'src', 'server.ts');
const operatorRuntimePath = join(root, 'src', 'merlin', 'operatorConsoleRuntime.ts');

assert.equal(existsSync(auditPath), true, 'Merlin operator polish audit must exist');
assert.equal(existsSync(indexPath), true, 'Merlin index page must exist');
assert.equal(existsSync(serverPath), true, 'server route wiring must exist');
assert.equal(existsSync(operatorRuntimePath), true, 'Merlin operator console runtime must exist');

const audit = readFileSync(auditPath, 'utf8');
const index = readFileSync(indexPath, 'utf8');
const server = readFileSync(serverPath, 'utf8');
const operatorRuntime = readFileSync(operatorRuntimePath, 'utf8');

function includesAll(text, values, label) {
  for (const value of values) {
    assert.ok(text.includes(value), `${label} must include ${value}`);
  }
}

includesAll(
  audit,
  [
    '# Merlin Operator Polish Audit',
    'This audit supersedes any MealScout-specific polish framing',
    'No new product features are proposed here',
    'Active Merlin Surface',
    'What Merlin Should Communicate',
    'What Merlin Is Not',
    'UI And Copy Issues Found',
    'Preferred Merlin Operator Language',
    'Behavior Preservation Boundary',
    'Validation Commands',
    'Cleanup Tickets'
  ],
  'audit'
);

includesAll(
  audit,
  [
    'Merlin Operator Console',
    'Needs Attention',
    'Approvals',
    'Action Cards',
    'Execution Plans',
    'Dry Runs',
    'Live Gates',
    'Entity Evidence',
    'Source Observations',
    'Outcome History',
    'Technical Details'
  ],
  'preferred language'
);

includesAll(
  audit,
  [
    'Not MealScout affiliate attribution UI',
    'Not MealScout payout approval',
    'Not a live connector execution shortcut',
    'Not a Drive cleanup/delete/archive shortcut'
  ],
  'not list'
);

includesAll(
  audit,
  [
    'No new routes',
    'No new APIs',
    'No new data fields',
    'No new product flows',
    'No permission changes',
    'No Drive mutation, publish, cleanup/delete/archive, payout, profile seeding, verification email, affiliate ledger, or live execution behavior changes'
  ],
  'behavior boundary'
);

const cleanupTicketMatches = audit.match(/^\d+\. Cleanup:/gm) || [];
assert.ok(cleanupTicketMatches.length >= 5 && cleanupTicketMatches.length <= 10, 'audit must list 5-10 cleanup tickets');

const forbiddenFeaturePhrases = [
  'Add feature:',
  'New product feature:',
  'Implement payout',
  'Add payout calculation',
  'Add new API',
  'Create new route',
  'automatic notification',
  'automatic publish',
  'automatic archive',
  'automatic delete'
];
for (const phrase of forbiddenFeaturePhrases) {
  assert.equal(audit.includes(phrase), false, `audit must not propose forbidden product work: ${phrase}`);
}

includesAll(index, ['<title>Merlin Daily</title>', '<h1>Merlin Daily</h1>', 'LISA Browser', 'Drive Review Queue'], 'Merlin index');

includesAll(
  server,
  [
    '/api/merlin/operator-console',
    '/api/merlin/approvals',
    '/api/merlin/execution-plans',
    '/api/merlin/connector-adapters',
    '/api/merlin/dry-run-executions',
    '/api/merlin/live-execution-gates',
    '/api/merlin/workspaces',
    '/api/merlin/intake',
    '/api/merlin/entities',
    '/api/merlin/outcomes',
    '/api/merlin/action-cards'
  ],
  'server Merlin route wiring'
);

includesAll(operatorRuntime, ["mode: 'read_only'", 'mutationAllowed: false', 'getMerlinOperatorConsolePayload'], 'operator runtime safety');

console.log('Merlin operator polish contract passed');
