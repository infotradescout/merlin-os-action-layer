import { readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, extname, resolve } from 'node:path';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const PROTECTED_FILE_NAMES = new Set([
  '.env',
  '.env.local',
  'package.json',
  'package-lock.json',
  'tsconfig.json'
]);

const PROTECTED_DIRECTORIES = new Set([
  'data',
  'src',
  'public',
  'docs',
  'tests',
  'schemas',
  'node_modules',
  'dist'
]);

function extensionFor(fileName) {
  const ext = extname(fileName).toLowerCase();
  return ext || '(none)';
}

function isProtectedFile(fileName) {
  if (PROTECTED_FILE_NAMES.has(fileName)) return true;
  if (fileName.startsWith('.env')) return true;
  if (/\.sqlite(?:-wal|-shm)?$/i.test(fileName)) return true;
  return false;
}

function categoryFor(fileName) {
  const lower = fileName.toLowerCase();
  if (isProtectedFile(fileName)) return 'keep';
  if (lower.endsWith('.log')) return 'local_log';
  if (lower.startsWith('exact-filename-duplicate-')) return 'duplicate_audit';
  if (lower === 'stale-google-block-search.txt') return 'diagnostic_report';
  if (/^(truck|pilot).*\.(json|txt)$/i.test(fileName)) return 'batch_output';
  if (/^(mealscout|merlin)-.*-report\.txt$/i.test(fileName)) return 'smoke_report';
  if (lower.endsWith('.txt')) return 'diagnostic_report';
  if (lower.endsWith('.json') && /(?:smoke|batch|preview|audit|diagnostic|report|run|execution)/i.test(fileName)) {
    return 'batch_output';
  }
  if (lower.endsWith('.json') || lower.endsWith('.txt')) return 'unknown_artifact';
  return 'keep';
}

function actionFor(category) {
  return category === 'keep' ? 'keep' : 'archive_candidate';
}

function shouldIncludeFile(fileName, stats) {
  if (!stats.isFile()) return false;
  if (isProtectedFile(fileName)) return true;
  const category = categoryFor(fileName);
  return category !== 'keep';
}

function buildManifest() {
  const rows = [];
  for (const entry of readdirSync(repoRoot, { withFileTypes: true })) {
    if (entry.isDirectory() && PROTECTED_DIRECTORIES.has(entry.name)) continue;
    if (!entry.isFile()) continue;
    const stats = statSync(resolve(repoRoot, entry.name));
    if (!shouldIncludeFile(entry.name, stats)) continue;
    const suggestedCategory = categoryFor(entry.name);
    rows.push({
      file_name: entry.name,
      size_bytes: stats.size,
      extension: extensionFor(entry.name),
      suggested_category: suggestedCategory,
      suggested_action: actionFor(suggestedCategory)
    });
  }
  return rows.sort((a, b) => a.suggested_action.localeCompare(b.suggested_action) || a.file_name.localeCompare(b.file_name));
}

const manifest = buildManifest();
console.log(JSON.stringify({
  mode: 'dry_run_read_only_no_mutation',
  scope: 'repo_root_files_only',
  protected_directories: Array.from(PROTECTED_DIRECTORIES).sort(),
  protected_files: Array.from(PROTECTED_FILE_NAMES).sort(),
  artifact_count: manifest.length,
  manifest
}, null, 2));
