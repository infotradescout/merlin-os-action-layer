import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptPath = new URL('./artifact-archive-plan.mjs', import.meta.url);
const scriptFilePath = fileURLToPath(scriptPath);

assert.equal(existsSync(scriptPath), true, 'artifact archive plan script must exist');

const script = readFileSync(scriptPath, 'utf8');

function requireText(label, pattern) {
  assert.match(script, pattern, `${label} must be present`);
}

requireText('dry-run language', /dry_run_read_only_no_mutation/);
requireText('no-mutation warning', /No files were moved, deleted, uploaded, archived, renamed, copied, or modified/);
requireText('inventory script reference', /artifact-inventory\.mjs/);
requireText('archive candidate output', /archive_candidate/);
requireText('keep output', /keep/);
requireText('smoke archive group', /archive\/reports\/smoke\//);
requireText('diagnostic archive group', /archive\/reports\/diagnostics\//);
requireText('duplicate archive group', /archive\/reports\/duplicates\//);
requireText('log archive group', /archive\/logs\//);
requireText('batch archive group', /archive\/batches\//);
requireText('unknown review group', /archive\/unknown-review\//);

const forbiddenPatterns = [
  /\brmSync\b/,
  /\brm\b/,
  /\bunlinkSync\b/,
  /\bunlink\b/,
  /\brenameSync\b/,
  /\brename\b/,
  /\bmkdirSync\b/,
  /\bmkdir\b/,
  /\bcopyFileSync\b/,
  /\bcopyFile\b/,
  /\bwriteFileSync\b/,
  /\bgoogleapis\b/,
  /\bGoogleDrive\b/,
  /\bgetDriveClient\b/,
  /\bupload\b/i
];

for (const pattern of forbiddenPatterns) {
  assert.doesNotMatch(script, pattern, `artifact archive plan script must not use mutation or Drive/upload API: ${pattern}`);
}

const output = execFileSync(process.execPath, [scriptFilePath], { encoding: 'utf8' });
const parsed = JSON.parse(output);

assert.equal(parsed.mode, 'dry_run_read_only_no_mutation');
assert.ok(parsed.archive_candidate_groups, 'archive candidate groups must exist');
assert.ok(parsed.protected_keep_group, 'protected keep group must exist');
assert.equal(parsed.protected_keep_group.suggested_action, 'keep');

console.log('artifact archive plan contract passed');
