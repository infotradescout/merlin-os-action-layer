import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptPath = new URL('./artifact-archive-review-report.mjs', import.meta.url);
const scriptFilePath = fileURLToPath(scriptPath);

assert.equal(existsSync(scriptPath), true, 'artifact archive review report script must exist');

const script = readFileSync(scriptPath, 'utf8');

function requireText(label, pattern) {
  assert.match(script, pattern, `${label} must be present`);
}

requireText('dry-run language', /DRY RUN ONLY/);
requireText('no-mutation language', /No files were moved, deleted, copied, renamed, uploaded, archived, or modified/);
requireText('manual approval warning', /Manual approval required before mutation/);
requireText('archive plan reference', /artifact-archive-plan\.mjs/);

const forbiddenPatterns = [
  /\brmSync\b/,
  /\bfs\.rm\b/,
  /\bunlinkSync\b/,
  /\bfs\.unlink\b/,
  /\brenameSync\b/,
  /\bfs\.rename\b/,
  /\bmkdirSync\b/,
  /\bfs\.mkdir\b/,
  /\bcopyFileSync\b/,
  /\bfs\.copyFile\b/,
  /\bwriteFileSync\b/,
  /\bgoogleapis\b/,
  /\bGoogleDrive\b/,
  /\bgetDriveClient\b/,
  /\buploadFile\b/i,
  /\bdrive\.files\.create\b/
];

for (const pattern of forbiddenPatterns) {
  assert.doesNotMatch(script, pattern, `artifact archive review report must not use mutation or Drive/upload API: ${pattern}`);
}

const output = execFileSync(process.execPath, [scriptFilePath], { encoding: 'utf8' });

assert.match(output, /^# Artifact Archive Review Report/m);
assert.match(output, /archive\/reports\/smoke\//);
assert.match(output, /archive\/reports\/diagnostics\//);
assert.match(output, /archive\/reports\/duplicates\//);
assert.match(output, /archive\/logs\//);
assert.match(output, /archive\/batches\//);
assert.match(output, /archive\/unknown-review\//);
assert.match(output, /Protected \/ Keep/);
assert.match(output, /Manual approval required before mutation/);

console.log('artifact archive review report contract passed');
