import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnvFromDotFile } from '../src/env.js';
import { getDriveClient } from '../src/driveClient.js';
import {
  createDriveSequentialRenameInventory,
  driveSequentialManifestRowsToCsv,
  type DriveSequentialInventoryMode
} from '../src/driveFolderSequentialInventory.js';

function parseArgs(argv: string[]): {
  folderId: string;
  mode: DriveSequentialInventoryMode;
  includeAllFiles: boolean;
  confirmRename: boolean;
  expectedTotalFileCount?: number;
  outputDir: string;
} {
  const parsed = {
    folderId: '',
    mode: 'dry-run' as DriveSequentialInventoryMode,
    includeAllFiles: false,
    confirmRename: false,
    expectedTotalFileCount: undefined as number | undefined,
    outputDir: resolve(process.cwd(), 'artifacts/drive-folder-sequential-inventory')
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1] || '';
    if (arg === '--folder-id') parsed.folderId = next, index += 1;
    else if (arg === '--mode') parsed.mode = next === 'execute' ? 'execute' : 'dry-run', index += 1;
    else if (arg === '--execute') parsed.mode = 'execute';
    else if (arg === '--include-all-files') parsed.includeAllFiles = true;
    else if (arg === '--confirm-rename') parsed.confirmRename = true;
    else if (arg === '--expected-total-file-count') parsed.expectedTotalFileCount = Number(next), index += 1;
    else if (arg === '--output-dir') parsed.outputDir = resolve(process.cwd(), next), index += 1;
  }

  if (!parsed.folderId) {
    throw new Error('missing_required_arg:--folder-id');
  }
  if (parsed.mode === 'execute' && !parsed.confirmRename) {
    throw new Error('execute_mode_requires_--confirm-rename');
  }
  if (typeof parsed.expectedTotalFileCount === 'number' && !Number.isInteger(parsed.expectedTotalFileCount)) {
    throw new Error('invalid_expected_total_file_count');
  }
  return parsed;
}

async function main(): Promise<void> {
  loadEnvFromDotFile();
  const args = parseArgs(process.argv.slice(2));
  const client = getDriveClient();
  const result = await createDriveSequentialRenameInventory({
    folderId: args.folderId,
    client,
    mode: args.mode,
    includeAllFiles: args.includeAllFiles,
    expectedTotalFileCount: args.expectedTotalFileCount,
    confirmRename: args.confirmRename
  });

  mkdirSync(args.outputDir, { recursive: true });
  const jsonPath = resolve(args.outputDir, 'drive-folder-sequential-rename-manifest.json');
  const csvPath = resolve(args.outputDir, 'drive-folder-sequential-rename-manifest.csv');
  const summaryPath = resolve(args.outputDir, 'drive-folder-sequential-rename-summary.json');

  writeFileSync(jsonPath, `${JSON.stringify(result.manifestRows, null, 2)}\n`, 'utf8');
  writeFileSync(csvPath, driveSequentialManifestRowsToCsv(result.manifestRows), 'utf8');
  writeFileSync(
    summaryPath,
    `${JSON.stringify(
      {
        status: result.status,
        mode: result.mode,
        folderId: result.folderId,
        mutationAllowed: result.mutationAllowed,
        totalFilesFound: result.totalFilesFound,
        totalManifestRows: result.totalManifestRows,
        totalPlannedRenames: result.totalPlannedRenames,
        skippedFiles: result.skippedFiles,
        renamedFiles: result.renamedFiles,
        validation: result.validation,
        manifestJsonPath: jsonPath,
        manifestCsvPath: csvPath
      },
      null,
      2
    )}\n`,
    'utf8'
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        status: result.status,
        mode: result.mode,
        mutationAllowed: result.mutationAllowed,
        totalFilesFound: result.totalFilesFound,
        totalPlannedRenames: result.totalPlannedRenames,
        skippedFiles: result.skippedFiles.length,
        manifestJsonPath: jsonPath,
        manifestCsvPath: csvPath,
        summaryPath,
        validation: result.validation
      },
      null,
      2
    )}\n`
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
