import assert from 'node:assert/strict';
import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = process.cwd();
const docsRoot = join(repoRoot, 'docs');
const merlinDocsRoot = join(docsRoot, 'merlin');

const canonicalFlightPlan = join(merlinDocsRoot, 'MERLIN_PROJECT_FLIGHT_PLAN_DOCTRINE.md');
const duplicateFlightPlan = join(docsRoot, 'MERLIN_PROJECT_FLIGHT_PLAN_DOCTRINE.md');

assert.equal(existsSync(canonicalFlightPlan), true, 'Canonical Flight Plan doctrine must exist in docs/merlin');
assert.equal(existsSync(duplicateFlightPlan), false, 'Root docs/MERLIN_PROJECT_FLIGHT_PLAN_DOCTRINE.md must not coexist with docs/merlin canonical');

const readme = readFileSync(join(repoRoot, 'README.md'), 'utf8');
assert.match(readme, /docs\/merlin\/MERLIN_PROJECT_FLIGHT_PLAN_DOCTRINE\.md/, 'README must point to canonical docs/merlin Project Flight Plan doctrine');

const doctrineFiles = [
  join(merlinDocsRoot, 'MERLIN_AI_FAILURE_TAXONOMY_AND_PREVENTION_GATES.md'),
  join(merlinDocsRoot, 'MERLIN_CONTEXT_AND_REUSE_DOCTRINE.md'),
  join(merlinDocsRoot, 'MERLIN_UI_SOURCE_PACKET_DOCTRINE.md'),
  join(merlinDocsRoot, 'MERLIN_AI_FAILURE_PREVENTION_DOCTRINE.md'),
  canonicalFlightPlan
];

for (const path of doctrineFiles) {
  assert.equal(existsSync(path), true, `Required doctrine file must exist: ${path}`);
}

function readText(filePath) {
  return readFileSync(filePath, 'utf8');
}

const failureTaxonomy = readText(join(merlinDocsRoot, 'MERLIN_AI_FAILURE_TAXONOMY_AND_PREVENTION_GATES.md'));
const requiredFailureSections = [
  '## 1. Project Reality Gate',
  '## 2. Brand / Market Scope Firewall',
  '## 3. Priority Lock',
  '## 4. Motive / Intent / Expectation Gate',
  '## 5. Existing-System Scan Requirement',
  '## 6. Complexity Budget',
  '## 7. Done Means Proven',
  '## 8. Evidence Quality Ladder',
  '## 9. Assumption Ledger',
  '## 10. Time-Gap Awareness',
  '## 11. Context Decay Detection',
  '## 12. Revert / Disable / Isolation Gate',
  '## 13. Natural-Language Component Drop-In',
  '## 14. Screenshot Is Not Source',
  '## 15. Operator Burden Reduction',
  '## 16. Cross-Repo Coordination Ledger',
  '## 17. No Endless World Rule',
  '## 18. Failure Taxonomy'
];
for (const section of requiredFailureSections) {
  assert.match(failureTaxonomy, new RegExp(section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `Missing failure taxonomy section: ${section}`);
}

const handoffDoc = readText(join(merlinDocsRoot, 'MERLIN_APP_BUILDER_CODEX_HANDOFF_CONTRACT.md'));
const handoffRequirements = [
  /Enable \/ Disable \/ Revert Contract/i,
  /Enable Instructions/i,
  /Disable Instructions/i,
  /Revert Instructions/i,
  /Validation after revert/i,
  /What data cannot be reverted/i
];
for (const pattern of handoffRequirements) {
  assert.match(handoffDoc, pattern, `Missing Codex handoff requirement: ${pattern}`);
}

const uiPacketDoc = readText(join(merlinDocsRoot, 'MERLIN_UI_SOURCE_PACKET_DOCTRINE.md'));
const uiPatterns = [
  /image output is visual proof only/i,
  /structured design data is the build source/i,
  /Design Source Packet/i,
  /screen purpose/i,
  /component tree/i,
  /acceptance criteria/i,
  /Do not ask Codex to recreate screenshots/i
];
for (const pattern of uiPatterns) {
  assert.match(uiPacketDoc, pattern, `Missing UI Source Packet doctrine text: ${pattern}`);
}

const contextReuseDoc = readText(join(merlinDocsRoot, 'MERLIN_CONTEXT_AND_REUSE_DOCTRINE.md'));
const contextPatterns = [
  /Review-before-create/i,
  /reuse → extend → create only if justified/i,
  /constrained-builder rule/i,
  /Timestamped work ledger/i,
  /Time-Gap Awareness/i,
  /Staleness status/i
];
for (const pattern of contextPatterns) {
  assert.match(contextReuseDoc, pattern, `Missing context/reuse doctrine text: ${pattern}`);
}

const sourceRoots = [
  join(repoRoot, 'src'),
  join(repoRoot, 'scripts'),
  join(repoRoot, 'tests'),
  join(repoRoot, 'docs'),
  merlinDocsRoot
];

const sourceExts = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.md']);
const maxSourceLines = 1000;
const sourceAllowlist = new Set([
  'scripts/screenshots-manifest-move-and-seed.ts',
  'src/lisa.ts',
  'src/mealscoutProfileImport.ts',
  'src/merlin/affiliateScreenshotFolderProcessing.ts',
  'src/server.ts',
  'tests/mealscout-batch-intake.test.ts',
  'tests/mealscout-screenshot-extraction.test.ts',
  'tests/merlin-intake-action-cards-dryrun.test.ts'
]);

function collectFiles(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const child = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', '.git', 'dist', 'coverage'].includes(entry.name)) continue;
      out.push(...collectFiles(child));
    } else if (entry.isFile()) {
      out.push(child);
    }
  }
  return out;
}

const oversizedSourceFiles = [];
for (const root of sourceRoots) {
  for (const file of collectFiles(root)) {
    const ext = file.slice(file.lastIndexOf('.')).toLowerCase();
    if (!sourceExts.has(ext)) continue;
    const rel = file.replace(`${repoRoot}\\`, '').replace(/\\/g, '/');
    if (sourceAllowlist.has(rel)) continue;
    const lines = readText(file).split(/\r?\n/).length;
    if (lines > maxSourceLines) {
      oversizedSourceFiles.push({ path: rel, lines });
    }
  }
}

assert.equal(oversizedSourceFiles.length, 0, `Source files over ${maxSourceLines} lines are blocked: ${JSON.stringify(oversizedSourceFiles, null, 2)}`);

const policy = readText(join(merlinDocsRoot, 'MERLIN_EVIDENCE_ARTIFACT_STORAGE_POLICY.md'));
assert.match(policy, /Merlin Evidence Artifact Storage Policy/i, 'Artifact storage policy file must define policy header');

const policyAllowlist = [
  'artifacts/mealscout-menu-artifact-classification/artifact-classification-rows.json',
  'artifacts/mealscout-menu-artifact-classification/menu-candidates.json',
  'artifacts/mealscout-screenshot-processing-validation/evidence-rows.json',
  'artifacts/mealscout-screenshot-processing-validation/duplicate-groups.json',
  'artifacts/mealscout-menu-artifact-classification/menu-candidates.csv',
  'artifacts/mealscout-screenshot-processing-validation/clean-import-candidates.json',
  'artifacts/mealscout-screenshot-processing-validation/evidence-rows.csv',
  'artifacts/mealscout-screenshot-processing-validation/rejected-rows.json',
  'artifacts/mealscout-screenshot-processing-validation/rejected-rows.csv',
  'artifacts/mealscout-menu-artifact-classification/duplicate-evidence-groups.json',
  'artifacts/mealscout-menu-artifact-classification/menu-review-required.json',
  'artifacts/mealscout-menu-artifact-classification/menu-review-required.csv'
];

const artifactRoots = [join(repoRoot, 'artifacts')];
const massiveArtifactLimitLines = 5000;
const massiveArtifactLimitBytes = 128 * 1024;

function collectArtifactFiles(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const child = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectArtifactFiles(child));
    } else if (entry.isFile()) {
      if (/\.(json|csv|txt|md|log|tsv)$/i.test(entry.name)) {
        out.push(child);
      }
    }
  }
  return out;
}

const rawArtifactViolations = [];
for (const root of artifactRoots) {
  for (const file of collectArtifactFiles(root)) {
    const rel = file.replace(`${repoRoot}\\`, '').replace(/\\/g, '/');
    const stats = statSync(file);
    const lines = readText(file).split(/\r?\n/).length;
    const isMassive = lines > massiveArtifactLimitLines || stats.size > massiveArtifactLimitBytes;
    if (isMassive && !policyAllowlist.includes(rel)) {
      rawArtifactViolations.push({ path: rel, lines, bytes: stats.size });
    }
  }
}

assert.equal(rawArtifactViolations.length, 0, `Massive raw artifacts must be referenced in policy allowlist/quarantine: ${JSON.stringify(rawArtifactViolations, null, 2)}`);

console.log('Merlin Doctrine normalization and hygiene contract passed');
