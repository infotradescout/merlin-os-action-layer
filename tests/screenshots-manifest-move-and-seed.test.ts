import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import type { DriveClient, DriveFileInfo, DriveFolderInfo } from '../src/driveClient.js';
import { executeManifestMoves } from '../scripts/screenshots-manifest-move-and-seed.js';

function makeDriveFileInfo(overrides: Partial<DriveFileInfo> = {}): DriveFileInfo {
  return {
    drive_file_id: overrides.drive_file_id || 'file-1',
    file_name: overrides.file_name || 'file-1.jpg',
    mime_type: overrides.mime_type || 'image/jpeg',
    folder_id: overrides.folder_id !== undefined ? overrides.folder_id : 'source-folder',
    web_url: overrides.web_url || '',
    modified_time: overrides.modified_time,
    entity_id: overrides.entity_id,
    raw_metadata: overrides.raw_metadata
  };
}

function makeClient(stubs: {
  getFileMetadata: (fileId: string) => Promise<DriveFileInfo>;
  moveFileToFolder?: (fileId: string, targetFolderId: string, currentParentId?: string) => Promise<boolean>;
}): DriveClient {
  return {
    async listFilesInFolder(): Promise<DriveFileInfo[]> {
      return [];
    },
    async getFileMetadata(fileId: string): Promise<DriveFileInfo> {
      return stubs.getFileMetadata(fileId);
    },
    async downloadFileContent(): Promise<string | undefined> {
      return undefined;
    },
    async moveFileToFolder(fileId: string, targetFolderId: string, currentParentId?: string): Promise<boolean> {
      if (stubs.moveFileToFolder) return stubs.moveFileToFolder(fileId, targetFolderId, currentParentId);
      return true;
    },
    async findFolderByName(): Promise<DriveFolderInfo | undefined> {
      return undefined;
    },
    async listFoldersByName(): Promise<DriveFolderInfo[]> {
      return [];
    },
    async createFolderIfMissing(name: string): Promise<DriveFolderInfo> {
      return { id: `${name}-id`, name };
    }
  };
}

function writeManifest(path: string, rows: string[]): void {
  const header =
    'batch_id,operation,source_file_id,source_file_name,source_folder_id,source_folder_name,visible_business_name,category,destination_project,destination_folder_name,destination_folder_id,seed_action,safety_gate,confidence,move_status,notes';
  writeFileSync(path, `${header}\n${rows.join('\n')}\n`, 'utf8');
}

test('uses explicit current parent in move call', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'manifest-move-test-'));
  try {
    const manifestPath = join(tempDir, 'manifest.csv');
    const auditPath = join(tempDir, 'audit.csv');
    const seedReportPath = join(tempDir, 'seed-report.json');
    const seedExportPath = join(tempDir, 'seed-export.json');

    writeManifest(manifestPath, [
      'BATCH-004-TRADESCOUT-CONTRACTORS,move_when_available,file-123,file-123.jpg,source-folder,Screenshots,Lexi Roofing,roofing_service,TradeScout / Contractor Intake,TradeScout_Contractors/Roofing,dest-folder,do_not_seed_to_mealscout,contractor_project_only,high,pending,note'
    ]);

    let capturedParent = '';
    const client = makeClient({
      getFileMetadata: async (fileId: string) => makeDriveFileInfo({ drive_file_id: fileId, folder_id: 'old-parent-789' }),
      moveFileToFolder: async (_fileId: string, _targetFolderId: string, currentParentId?: string) => {
        capturedParent = currentParentId || '';
        return true;
      }
    });

    await executeManifestMoves({ manifestPath, auditPath, seedReportPath, seedExportPath, movedBy: 'test', client });

    assert.equal(capturedParent, 'old-parent-789');
    const audit = readFileSync(auditPath, 'utf8');
    assert.match(audit, /,moved,/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('keeps seed gate closed when BATCH-001 move fails', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'manifest-move-test-'));
  const output: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  try {
    const manifestPath = join(tempDir, 'manifest.csv');
    const auditPath = join(tempDir, 'audit.csv');
    const seedReportPath = join(tempDir, 'seed-report.json');
    const seedExportPath = join(tempDir, 'seed-export.json');

    writeManifest(manifestPath, [
      'BATCH-001-MEALSCOUT-MERLIN-SEED,move_when_available,file-001,file-001.jpg,source-folder,Screenshots,Food Truck,food_truck,Merlin / MealScout,MealScout_Merlin_Evidence_Seeds,dest-folder,seed_to_merlin_evidence,merlin_export_contract_required,high,pending,note'
    ]);

    const client = makeClient({
      getFileMetadata: async (fileId: string) => makeDriveFileInfo({ drive_file_id: fileId, folder_id: 'old-parent' }),
      moveFileToFolder: async () => {
        throw new Error('Increasing the number of parents is not allowed');
      }
    });

    process.stdout.write = ((chunk: string | Uint8Array) => {
      output.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
      return true;
    }) as typeof process.stdout.write;

    await executeManifestMoves({ manifestPath, auditPath, seedReportPath, seedExportPath, movedBy: 'test', client });

    const audit = readFileSync(auditPath, 'utf8');
    assert.match(audit, /blocked_drive_permission_or_parent_semantics/);
    assert.equal(output.join('').includes('[SEED GATE CLOSED]'), true);
  } finally {
    process.stdout.write = originalWrite as typeof process.stdout.write;
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('marks blocked_missing_current_parent and avoids move call', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'manifest-move-test-'));
  try {
    const manifestPath = join(tempDir, 'manifest.csv');
    const auditPath = join(tempDir, 'audit.csv');
    const seedReportPath = join(tempDir, 'seed-report.json');
    const seedExportPath = join(tempDir, 'seed-export.json');

    writeManifest(manifestPath, [
      'BATCH-001-MEALSCOUT-MERLIN-SEED,move_when_available,file-001,file-001.jpg,source-folder,Screenshots,Food Truck,food_truck,Merlin / MealScout,MealScout_Merlin_Evidence_Seeds,dest-folder,seed_to_merlin_evidence,merlin_export_contract_required,high,pending,note'
    ]);

    let moveCalled = false;
    const client = makeClient({
      getFileMetadata: async (fileId: string) => makeDriveFileInfo({ drive_file_id: fileId, folder_id: '' }),
      moveFileToFolder: async () => {
        moveCalled = true;
        return true;
      }
    });

    await executeManifestMoves({ manifestPath, auditPath, seedReportPath, seedExportPath, movedBy: 'test', client });

    const audit = readFileSync(auditPath, 'utf8');
    assert.equal(moveCalled, false);
    assert.match(audit, /blocked_missing_current_parent/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
