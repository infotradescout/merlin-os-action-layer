import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('scripts/screenshots-manifest-move-and-seed.ts', 'utf8');

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

console.log('Screenshots manifest move and seed contract passed');
