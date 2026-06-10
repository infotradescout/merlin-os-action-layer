import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

const repoRoot = process.cwd();
const maxRawArtifactBytes = 128 * 1024;
const maxRawArtifactLines = 5000;
const maxPointerBytes = 250 * 1024;

const sourceOrPolicyRoots = [
  'contracts/',
  'docs/',
  'examples/',
  'public/',
  'schemas/',
  'scripts/',
  'src/',
  'tests/'
];

const artifactLikeExtensions = new Set(['.csv', '.json', '.log', '.md', '.txt', '.tsv']);
const rootConfigFiles = new Set([
  '.gitignore',
  'package-lock.json',
  'package.json',
  'playwright.config.ts',
  'README.md',
  'tsconfig.json'
]);

const pointerIndexPath = 'artifacts/quarantine/raw-artifact-pointer-index.json';
const requiredPointerPaths = new Set([
  'artifacts/mealscout-menu-artifact-classification/artifact-classification-rows.json',
  'artifacts/mealscout-menu-artifact-classification/menu-candidates.json',
  'artifacts/mealscout-menu-artifact-classification/menu-candidates.csv',
  'artifacts/mealscout-menu-artifact-classification/duplicate-evidence-groups.json',
  'artifacts/mealscout-menu-artifact-classification/menu-review-required.json',
  'artifacts/mealscout-menu-artifact-classification/menu-review-required.csv',
  'artifacts/mealscout-screenshot-processing-validation/evidence-rows.json',
  'artifacts/mealscout-screenshot-processing-validation/evidence-rows.csv',
  'artifacts/mealscout-screenshot-processing-validation/clean-import-candidates.json',
  'artifacts/mealscout-screenshot-processing-validation/rejected-rows.json',
  'artifacts/mealscout-screenshot-processing-validation/rejected-rows.csv',
  'artifacts/mealscout-screenshot-processing-validation/duplicate-groups.json',
  'pilot7o-truck1-preview.json',
  'pilot7p-preview-check.json',
  'truck1-full-preview-attributed.json',
  'truck1-full-preview.json',
  'truck2-preview.json',
  'truck2-recovery-file-audit.json'
]);

function trackedFiles() {
  return execFileSync('git', ['ls-files'], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).split(/\r?\n/).filter(Boolean);
}

function isSourceOrPolicyFile(rel) {
  if (rootConfigFiles.has(rel)) return true;
  return sourceOrPolicyRoots.some((root) => rel.startsWith(root));
}

function isArtifactLike(rel) {
  if (isSourceOrPolicyFile(rel)) return false;
  return rel.startsWith('artifacts/') || !rel.includes('/');
}

function lineCount(text) {
  return text.length === 0 ? 0 : text.split(/\r?\n/).length;
}

function readPointerRecord(rel) {
  const text = readFileSync(join(repoRoot, rel), 'utf8');
  if (rel.endsWith('.json')) {
    return JSON.parse(text);
  }

  const rows = text.trim().split(/\r?\n/).slice(1);
  return Object.fromEntries(rows.map((row) => {
    const comma = row.indexOf(',');
    return [row.slice(0, comma), row.slice(comma + 1)];
  }));
}

assert.equal(existsSync(join(repoRoot, pointerIndexPath)), true, 'Raw artifact pointer index must exist');

const pointerIndex = JSON.parse(readFileSync(join(repoRoot, pointerIndexPath), 'utf8'));
assert.equal(pointerIndex.pointer_index_schema, 'merlin.raw_artifact_pointer_index.v1');
assert.equal(pointerIndex.policy, 'docs/merlin/MERLIN_EVIDENCE_ARTIFACT_STORAGE_POLICY.md');
assert.equal(pointerIndex.quarantine_root, '.artifact-quarantine/raw-evidence');
assert.equal(pointerIndex.external_storage_status, 'local_quarantine_pending_external_storage');
assert.equal(pointerIndex.pointer_count, requiredPointerPaths.size);

const indexedPaths = new Set((pointerIndex.pointers || []).map((pointer) => pointer.original_path));
assert.deepEqual(indexedPaths, requiredPointerPaths, 'Pointer index must enumerate every quarantined raw artifact');

for (const rel of requiredPointerPaths) {
  const absolutePath = join(repoRoot, rel);
  assert.equal(existsSync(absolutePath), true, `Pointer record must remain at original path: ${rel}`);

  const stats = statSync(absolutePath);
  assert.ok(stats.size <= maxPointerBytes, `Pointer record must stay compact: ${rel}`);

  const pointer = readPointerRecord(rel);
  assert.equal(pointer.pointer_schema, 'merlin.raw_artifact_pointer.v1', `Invalid pointer schema: ${rel}`);
  assert.equal(pointer.original_path, rel, `Pointer original path mismatch: ${rel}`);
  assert.match(pointer.quarantine_path, /^\.artifact-quarantine\/raw-evidence\//, `Pointer must target local quarantine: ${rel}`);
  assert.match(pointer.sha256, /^[a-f0-9]{64}$/i, `Pointer must preserve SHA-256: ${rel}`);
  assert.ok(Number(pointer.size_bytes) > maxRawArtifactBytes || requiredPointerPaths.has(rel), `Pointer must record raw artifact size: ${rel}`);
  assert.equal(String(pointer.mutationAllowed), 'false', `Pointer evidence must be immutable: ${rel}`);
}

const rawArtifactViolations = [];
for (const rel of trackedFiles()) {
  if (!isArtifactLike(rel)) continue;
  if (!artifactLikeExtensions.has(extname(rel).toLowerCase())) continue;
  if (requiredPointerPaths.has(rel) || rel === pointerIndexPath) continue;

  const absolutePath = join(repoRoot, rel);
  const stats = statSync(absolutePath);
  const lines = lineCount(readFileSync(absolutePath, 'utf8'));
  if (stats.size > maxRawArtifactBytes || lines > maxRawArtifactLines) {
    rawArtifactViolations.push({ path: rel, bytes: stats.size, lines });
  }
}

assert.equal(
  rawArtifactViolations.length,
  0,
  `Oversized raw artifacts must be quarantined and pointerized: ${JSON.stringify(rawArtifactViolations, null, 2)}`
);

console.log('Merlin artifact quarantine enforcement contract passed');
