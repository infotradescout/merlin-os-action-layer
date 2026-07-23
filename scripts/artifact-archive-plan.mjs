import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const inventoryScript = resolve(repoRoot, 'scripts', 'artifact-inventory.mjs');

const CATEGORY_TO_ARCHIVE_FOLDER = {
  smoke_report: 'archive/reports/smoke/',
  diagnostic_report: 'archive/reports/diagnostics/',
  duplicate_audit: 'archive/reports/duplicates/',
  local_log: 'archive/logs/',
  batch_output: 'archive/batches/',
  unknown_artifact: 'archive/unknown-review/',
  keep: 'keep/'
};

function readInventory() {
  const output = execFileSync(process.execPath, [inventoryScript], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return JSON.parse(output);
}

function emptyGroup(folder, suggestedAction) {
  return {
    suggested_archive_folder: folder,
    suggested_action: suggestedAction,
    file_count: 0,
    total_bytes: 0,
    files: []
  };
}

function buildArchivePlan(inventory) {
  const groups = {};
  for (const [category, folder] of Object.entries(CATEGORY_TO_ARCHIVE_FOLDER)) {
    groups[category] = emptyGroup(folder, category === 'keep' ? 'keep' : 'archive_candidate');
  }

  for (const row of inventory.manifest || []) {
    const category = row.suggested_category || 'unknown_artifact';
    const group = groups[category] || groups.unknown_artifact;
    group.file_count += 1;
    group.total_bytes += Number(row.size_bytes || 0);
    group.files.push({
      file_name: row.file_name,
      size_bytes: row.size_bytes,
      extension: row.extension,
      suggested_category: row.suggested_category,
      suggested_action: row.suggested_action
    });
  }

  for (const group of Object.values(groups)) {
    group.files.sort((a, b) => a.file_name.localeCompare(b.file_name));
  }

  const archiveCandidateGroups = Object.fromEntries(
    Object.entries(groups).filter(([, group]) => group.suggested_action === 'archive_candidate')
  );

  return {
    mode: 'dry_run_read_only_no_mutation',
    scope: 'repo_root_files_only',
    warning: 'No files were moved, deleted, uploaded, archived, renamed, copied, or modified. No folders were created. No Google Drive APIs were called.',
    inventory_source: 'scripts/artifact-inventory.mjs',
    artifact_count: inventory.artifact_count,
    archive_candidate_count: Object.values(archiveCandidateGroups).reduce((sum, group) => sum + group.file_count, 0),
    keep_count: groups.keep.file_count,
    archive_candidate_groups: archiveCandidateGroups,
    protected_keep_group: groups.keep
  };
}

console.log(JSON.stringify(buildArchivePlan(readInventory()), null, 2));
