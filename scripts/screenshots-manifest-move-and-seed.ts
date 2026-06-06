import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFromDotFile } from '../src/env.js';
import { getDriveClient, type DriveClient } from '../src/driveClient.js';
import { processExistingScreenshotsIntoSeededProfiles, type MerlinExistingScreenshotSeedInput } from '../src/merlin/profileSeedRuntime.js';
import { buildMerlinProfileSeedExportBundle } from '../src/merlin/affiliateScreenshotFolderProcessing.js';

type MoveManifestRow = {
  batch_id: string;
  operation: string;
  source_file_id: string;
  source_file_name: string;
  source_folder_id: string;
  source_folder_name: string;
  visible_business_name: string;
  category: string;
  destination_project: string;
  destination_folder_name: string;
  destination_folder_id: string;
  seed_action: string;
  safety_gate: string;
  confidence: string;
  move_status: string;
  notes: string;
};

type AuditRow = {
  source_file_id: string;
  source_file_name: string;
  intended_destination_folder: string;
  final_folder_id: string;
  move_status: string;
  moved_at: string;
  moved_by_executor: string;
  notes: string;
};

type ExecuteManifestOptions = {
  manifestPath?: string;
  auditPath?: string;
  seedReportPath?: string;
  seedExportPath?: string;
  movedBy?: string;
  client?: DriveClient;
};

function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let inQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        value += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(value);
      value = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(value);
      value = '';
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      continue;
    }

    value += char;
  }

  if (value.length > 0 || row.length > 0) {
    row.push(value);
    if (row.some((cell) => cell.length > 0)) rows.push(row);
  }

  return rows;
}

function toCsv(rows: string[][]): string {
  return `${rows
    .map((row) =>
      row
        .map((cell) => {
          const safe = cell ?? '';
          if (safe.includes(',') || safe.includes('"') || safe.includes('\n') || safe.includes('\r')) {
            return `"${safe.replace(/"/g, '""')}"`;
          }
          return safe;
        })
        .join(',')
    )
    .join('\n')}\n`;
}

function readMoveManifest(path: string): MoveManifestRow[] {
  const parsed = parseCsv(readFileSync(path, 'utf8'));
  if (parsed.length < 2) throw new Error('Move manifest is empty');
  const [header, ...body] = parsed;
  const headerMap = new Map<string, number>();
  header.forEach((name, index) => headerMap.set(name, index));

  const required = [
    'batch_id',
    'operation',
    'source_file_id',
    'source_file_name',
    'source_folder_id',
    'source_folder_name',
    'destination_project',
    'destination_folder_name',
    'seed_action',
    'safety_gate',
    'confidence',
    'move_status'
  ];
  for (const key of required) {
    if (!headerMap.has(key)) throw new Error(`Manifest missing required column: ${key}`);
  }

  return body.map((row) => {
    const get = (key: string) => row[headerMap.get(key) ?? -1] || '';
    return {
      batch_id: get('batch_id'),
      operation: get('operation'),
      source_file_id: get('source_file_id'),
      source_file_name: get('source_file_name'),
      source_folder_id: get('source_folder_id'),
      source_folder_name: get('source_folder_name'),
      visible_business_name: get('visible_business_name'),
      category: get('category'),
      destination_project: get('destination_project'),
      destination_folder_name: get('destination_folder_name'),
      destination_folder_id: get('destination_folder_id'),
      seed_action: get('seed_action'),
      safety_gate: get('safety_gate'),
      confidence: get('confidence'),
      move_status: get('move_status'),
      notes: get('notes')
    } satisfies MoveManifestRow;
  });
}

function assertManifestSafety(rows: MoveManifestRow[]): void {
  for (const row of rows) {
    if (!row.source_file_id || !row.source_file_name || !row.destination_project || !row.destination_folder_name || !row.seed_action || !row.safety_gate || !row.confidence) {
      throw new Error(`Manifest row missing required values: ${row.source_file_id || row.source_file_name}`);
    }
    if (row.move_status !== 'pending' && row.move_status !== 'failed') {
      throw new Error(`Manifest row must be pending or failed: ${row.source_file_id} -> ${row.move_status}`);
    }
    if (row.operation !== 'move_when_available') {
      throw new Error(`Unsupported operation for row ${row.source_file_id}: ${row.operation}`);
    }
    const isContractor = row.batch_id === 'BATCH-004-TRADESCOUT-CONTRACTORS';
    if (isContractor && (row.seed_action === 'seed_to_merlin_evidence' || row.destination_project === 'Merlin / MealScout')) {
      throw new Error(`Contractor row violates seeding boundary: ${row.source_file_id}`);
    }
  }
}

function isMoveEligible(row: MoveManifestRow): boolean {
  return row.operation === 'move_when_available' && (row.move_status === 'pending' || row.move_status === 'failed');
}

async function ensureDestinationFolderId(row: MoveManifestRow, cache: Map<string, string>, client: DriveClient): Promise<string> {
  if (row.destination_folder_id?.trim()) return row.destination_folder_id.trim();
  const cacheKey = `${row.source_folder_id}::${row.destination_folder_name}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const sourceFolder = await client.getFileMetadata(row.source_folder_id);
  let parentFolderId = sourceFolder.folder_id;
  if (!parentFolderId) {
    // Shared-drive folder metadata can omit parents for top-level folders;
    // in that case, create destination paths under the source folder itself.
    parentFolderId = row.source_folder_id;
  }

  const parts = row.destination_folder_name.split('/').map((value) => value.trim()).filter(Boolean);
  if (parts.length === 0) {
    throw new Error(`Invalid destination folder name for row ${row.source_file_id}`);
  }

  let currentParent = parentFolderId;
  for (const part of parts) {
    const existing = await client.findFolderByName(part, currentParent);
    if (existing) {
      currentParent = existing.id;
      continue;
    }
    const created = await client.createFolderIfMissing(part, currentParent);
    currentParent = created.id;
  }

  cache.set(cacheKey, currentParent);
  return currentParent;
}

function writeMoveManifest(path: string, rows: MoveManifestRow[]): void {
  const header = [
    'batch_id',
    'operation',
    'source_file_id',
    'source_file_name',
    'source_folder_id',
    'source_folder_name',
    'visible_business_name',
    'category',
    'destination_project',
    'destination_folder_name',
    'destination_folder_id',
    'seed_action',
    'safety_gate',
    'confidence',
    'move_status',
    'notes'
  ];

  const body = rows.map((row) => [
    row.batch_id,
    row.operation,
    row.source_file_id,
    row.source_file_name,
    row.source_folder_id,
    row.source_folder_name,
    row.visible_business_name,
    row.category,
    row.destination_project,
    row.destination_folder_name,
    row.destination_folder_id,
    row.seed_action,
    row.safety_gate,
    row.confidence,
    row.move_status,
    row.notes
  ]);

  writeFileSync(path, toCsv([header, ...body]), 'utf8');
}

function writeAuditManifest(path: string, rows: AuditRow[]): void {
  const header = [
    'source_file_id',
    'source_file_name',
    'intended_destination_folder',
    'final_folder_id',
    'move_status',
    'moved_at',
    'moved_by / executor',
    'notes'
  ];
  const body = rows.map((row) => [
    row.source_file_id,
    row.source_file_name,
    row.intended_destination_folder,
    row.final_folder_id,
    row.move_status,
    row.moved_at,
    row.moved_by_executor,
    row.notes
  ]);
  writeFileSync(path, toCsv([header, ...body]), 'utf8');
}

export async function executeManifestMoves(options: ExecuteManifestOptions = {}): Promise<{
  moved_total: number;
  failed_total: number;
  batch001_seed_inputs: number;
  batch001_seeded_results: number;
  audit_manifest: string;
  seed_report: string;
  seed_export: string;
}> {
  const manifestPath = options.manifestPath || resolve(process.cwd(), 'screenshots-bulk-move-execution-manifest.csv');
  const auditPath = options.auditPath || resolve(process.cwd(), 'screenshots-post-move-audit-manifest.csv');
  const seedReportPath = options.seedReportPath || resolve(process.cwd(), 'screenshots-batch001-seed-report.json');
  const seedExportPath = options.seedExportPath || resolve(process.cwd(), 'screenshots-batch001-merlin-profile-seed-export.json');
  const movedBy = options.movedBy || process.env.USERNAME || process.env.USER || 'copilot-executor';

  const rows = readMoveManifest(manifestPath);
  assertManifestSafety(rows);

  const client = options.client || getDriveClient();
  const folderCache = new Map<string, string>();
  const auditRows: AuditRow[] = [];

  for (const row of rows) {
    const movedAt = new Date().toISOString();
    if (!isMoveEligible(row)) {
      row.move_status = 'skipped_ineligible';
      auditRows.push({
        source_file_id: row.source_file_id,
        source_file_name: row.source_file_name,
        intended_destination_folder: row.destination_folder_name,
        final_folder_id: row.destination_folder_id || '',
        move_status: 'skipped_ineligible',
        moved_at: movedAt,
        moved_by_executor: movedBy,
        notes: row.notes
      });
      continue;
    }

    try {
      const destinationFolderId = await ensureDestinationFolderId(row, folderCache, client);
      const currentParentId = (await client.getFileMetadata(row.source_file_id)).folder_id?.trim();
      if (!currentParentId) {
        row.move_status = 'blocked_missing_current_parent';
        auditRows.push({
          source_file_id: row.source_file_id,
          source_file_name: row.source_file_name,
          intended_destination_folder: row.destination_folder_name,
          final_folder_id: row.destination_folder_id || '',
          move_status: 'blocked_missing_current_parent',
          moved_at: movedAt,
          moved_by_executor: movedBy,
          notes: row.notes
        });
        continue;
      }

      await client.moveFileToFolder(row.source_file_id, destinationFolderId, currentParentId);
      row.destination_folder_id = destinationFolderId;
      row.move_status = 'moved';
      auditRows.push({
        source_file_id: row.source_file_id,
        source_file_name: row.source_file_name,
        intended_destination_folder: row.destination_folder_name,
        final_folder_id: destinationFolderId,
        move_status: 'moved',
        moved_at: movedAt,
        moved_by_executor: movedBy,
        notes: row.notes
      });
    } catch (error) {
      row.move_status = 'blocked_drive_permission_or_parent_semantics';
      const message = error instanceof Error ? error.message : String(error);
      auditRows.push({
        source_file_id: row.source_file_id,
        source_file_name: row.source_file_name,
        intended_destination_folder: row.destination_folder_name,
        final_folder_id: row.destination_folder_id || '',
        move_status: 'blocked_drive_permission_or_parent_semantics',
        moved_at: movedAt,
        moved_by_executor: movedBy,
        notes: `${row.notes} | move_error=${message}`
      });
    }
  }

  writeMoveManifest(manifestPath, rows);
  writeAuditManifest(auditPath, auditRows);

  const batch001Rows = rows.filter((row) => row.batch_id === 'BATCH-001-MEALSCOUT-MERLIN-SEED' && row.move_status === 'moved');
  const batch001Screenshots: MerlinExistingScreenshotSeedInput[] = [];

  for (const row of batch001Rows) {
    const metadata = await client.getFileMetadata(row.source_file_id);
    const extractedText = await client.downloadFileContent(row.source_file_id);
    batch001Screenshots.push({
      fileId: row.source_file_id,
      fileName: row.source_file_name,
      sourceFolder: row.destination_folder_name,
      sourceFolderId: row.destination_folder_id,
      drivePath: `${row.destination_folder_name}/${row.source_file_name}`,
      mimeType: metadata.mime_type,
      modifiedTime: metadata.modified_time,
      extractedText,
      sourceFileAttribution: {
        attributionSource: 'request_context',
        attributionStatus: 'unmatched',
        sourceChannel: 'admin_import',
        affiliate_attribution_source: 'admin_unattributed'
      }
    });
  }

  const seedResult = await processExistingScreenshotsIntoSeededProfiles({ screenshots: batch001Screenshots });
  writeFileSync(seedReportPath, `${JSON.stringify(seedResult, null, 2)}\n`, 'utf8');

  const exportRows = buildMerlinProfileSeedExportBundle(seedResult.results);
  writeFileSync(seedExportPath, `${JSON.stringify(exportRows, null, 2)}\n`, 'utf8');

  const summary = {
    moved_total: auditRows.filter((row) => row.move_status === 'moved').length,
    failed_total: auditRows.filter((row) => row.move_status !== 'moved' && row.move_status !== 'skipped_ineligible').length,
    batch001_seed_inputs: batch001Screenshots.length,
    batch001_seeded_results: seedResult.results.length,
    audit_manifest: auditPath,
    seed_report: seedReportPath,
    seed_export: seedExportPath
  };
  if (summary.batch001_seed_inputs > 0) {
    process.stdout.write(`[SEED GATE OPENED] ${summary.batch001_seed_inputs} BATCH-001 files moved successfully. Proceeding with Merlin seeding...\n`);
  } else {
    process.stdout.write('[SEED GATE CLOSED] No BATCH-001 files were successfully moved. Raw Screenshots-folder seeding remains prohibited.\n');
  }
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

async function main(): Promise<void> {
  loadEnvFromDotFile();
  await executeManifestMoves();
}

const invokedPath = resolve(process.argv[1] || '');
const modulePath = resolve(fileURLToPath(import.meta.url));

if (invokedPath === modulePath || invokedPath.endsWith('screenshots-manifest-move-and-seed.ts')) {
  main().catch((error) => {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
