import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const testDir = mkdtempSync(join(tmpdir(), 'merlin-thread-runtime-'));
const dbPath = join(testDir, 'merlin-thread.sqlite');
process.env.MERLIN_DB_PATH = dbPath;

const {
  appendMerlinThreadMessage,
  closeMerlinThreadRuntime,
  createMerlinThread,
  getMerlinThreadById,
  initializeMerlinThreadRuntime,
  listMerlinThreadMessages,
  listMerlinThreads,
  resetMerlinThreadRuntimeForTest,
  updateMerlinThreadState
} = await import('../src/merlin/threadRuntime.ts');

initializeMerlinThreadRuntime(dbPath);

beforeEach(() => {
  resetMerlinThreadRuntimeForTest();
});

after(() => {
  closeMerlinThreadRuntime();
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch {}
});

test('thread runtime persists a conversation lane with ordered messages', () => {
  const thread = createMerlinThread({
    workspace_id: 'merlin-workspace-system',
    title: 'Update MealScout account packet',
    brand: 'MEALSCOUT',
    actor_scope: 'owner',
    entity_type: 'food_truck',
    action_id: 'account_intake'
  });
  const first = appendMerlinThreadMessage({
    thread_id: thread.id,
    role: 'user',
    message_text: 'Use the account docs and keep this read-only.',
    attachments: [{ fileId: 'doc-1', fileName: 'account.pdf' }]
  });
  const second = appendMerlinThreadMessage({
    thread_id: thread.id,
    role: 'assistant',
    message_text: 'Merlin stored the evidence and is ready to stage a preview.'
  });
  const updated = updateMerlinThreadState({
    thread_id: thread.id,
    status: 'ready_for_preview',
    latest_upload_intent_id: 'merlin-upload-1'
  });

  assert.equal(listMerlinThreads({ workspace_id: 'merlin-workspace-system' }).length, 1);
  assert.equal(getMerlinThreadById(thread.id)?.status, 'ready_for_preview');
  assert.equal(updated.latest_upload_intent_id, 'merlin-upload-1');
  const messages = listMerlinThreadMessages(thread.id);
  assert.equal(messages.length, 2);
  assert.equal(messages[0].id, first.id);
  assert.equal(messages[1].id, second.id);
  assert.equal(messages[0].attachments[0].fileName, 'account.pdf');
});
