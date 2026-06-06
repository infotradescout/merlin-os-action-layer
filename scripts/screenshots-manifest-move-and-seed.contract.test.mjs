import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('scripts/screenshots-manifest-move-and-seed.ts', 'utf8');

assert.match(source, /type ExecutionMode = 'execute' \| 'diagnose'/, 'executor must define execute and diagnose modes');

assert.match(source, /function isDiagnoseEligible\(row: MoveManifestRow\): boolean/, 'executor must include diagnose eligibility');

assert.match(
  source,
  /row\.move_status === 'blocked_missing_current_parent' \|\|\s*row\.move_status === 'blocked_drive_permission_or_parent_semantics'/,
  'diagnose mode must include blocked statuses'
);

assert.match(
  source,
  /const currentParentId = \(await client\.getFileMetadata\(row\.source_file_id\)\)\.folder_id\?\.trim\(\)/,
  'executor must resolve current parent before move'
);

assert.match(
  source,
  /await client\.moveFileToFolder\(row\.source_file_id, destinationFolderId, currentParentId\)/,
  'executor must pass current parent into move operation'
);

assert.match(
  source,
  /row\.move_status = 'blocked_missing_current_parent'/,
  'executor must explicitly block rows with missing current parent'
);

assert.match(
  source,
  /row\.move_status = 'blocked_drive_permission_or_parent_semantics'/,
  'executor must classify Drive move failures under blocked_drive_permission_or_parent_semantics'
);

assert.match(
  source,
  /row\.batch_id === 'BATCH-001-MEALSCOUT-MERLIN-SEED' && row\.move_status === 'moved'/,
  'seed gate must only include BATCH-001 rows with move_status=moved'
);

assert.match(
  source,
  /if \(mode === 'diagnose'\) \{\s*return runDiagnoseMode\(/,
  'executor must branch into diagnose mode without executing move/seed flow'
);

assert.match(
  source,
  /writeFileSync\(path, `\$\{JSON\.stringify\(payload, null, 2\)\}\\n`, 'utf8'\);/,
  'diagnose mode must write JSON diagnostic output'
);

const diagnoseStart = source.indexOf('async function runDiagnoseMode');
const executeStart = source.indexOf('export async function executeManifestMoves');
assert.ok(diagnoseStart >= 0 && executeStart > diagnoseStart, 'diagnose mode implementation must exist');
const diagnoseBlock = source.slice(diagnoseStart, executeStart);
assert.equal(diagnoseBlock.includes('moveFileToFolder('), false, 'diagnose mode must never move files');
assert.equal(
  diagnoseBlock.includes('processExistingScreenshotsIntoSeededProfiles('),
  false,
  'diagnose mode must never seed'
);

console.log('Screenshots manifest move and seed contract passed');
