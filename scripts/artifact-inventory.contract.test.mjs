import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const scriptPath = new URL('./artifact-inventory.mjs', import.meta.url);

assert.equal(existsSync(scriptPath), true, 'artifact inventory script must exist');

const script = readFileSync(scriptPath, 'utf8');

function requireText(label, pattern) {
  assert.match(script, pattern, `${label} must be present`);
}

requireText('dry-run language', /dry_run_read_only_no_mutation/);
requireText('root-only scan', /repo_root_files_only/);
requireText('data exclusion', /'data'/);
requireText('.env exclusion', /'\.env'/);
requireText('src exclusion', /'src'/);
requireText('public exclusion', /'public'/);
requireText('docs exclusion', /'docs'/);
requireText('tests exclusion', /'tests'/);
requireText('suggested action output', /suggested_action/);

const forbiddenPatterns = [
  /\brmSync\b/,
  /\bunlinkSync\b/,
  /\brenameSync\b/,
  /\bcopyFileSync\b/,
  /\bwriteFileSync\b/,
  /\bmkdirSync\b/,
  /\bgoogleapis\b/,
  /\bGoogleDrive\b/,
  /\bgetDriveClient\b/,
  /\bupload\b/i
];

for (const pattern of forbiddenPatterns) {
  assert.doesNotMatch(script, pattern, `artifact inventory script must not use mutation or Drive/upload API: ${pattern}`);
}

console.log('artifact inventory contract passed');
