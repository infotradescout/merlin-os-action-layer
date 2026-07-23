import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const archivePlanScript = resolve(repoRoot, 'scripts', 'artifact-archive-plan.mjs');

function readArchivePlan() {
  const output = execFileSync(process.execPath, [archivePlanScript], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return JSON.parse(output);
}

function formatBytes(value) {
  return String(Number(value || 0));
}

function renderGroup(title, group) {
  const lines = [
    `## ${title}`,
    '',
    `- Suggested folder: \`${group.suggested_archive_folder}\``,
    `- Suggested action: \`${group.suggested_action}\``,
    `- File count: ${group.file_count}`,
    `- Total bytes: ${formatBytes(group.total_bytes)}`,
    '',
    '| File | Bytes | Category | Action |',
    '| --- | ---: | --- | --- |'
  ];

  for (const file of group.files || []) {
    lines.push(
      `| \`${file.file_name}\` | ${formatBytes(file.size_bytes)} | \`${file.suggested_category}\` | \`${file.suggested_action}\` |`
    );
  }

  lines.push('');
  return lines.join('\n');
}

function renderReport(plan) {
  const lines = [
    '# Artifact Archive Review Report',
    '',
    '**DRY RUN ONLY. No files were moved, deleted, copied, renamed, uploaded, archived, or modified. No folders were created. No Google Drive APIs were called.**',
    '',
    '**Manual approval required before mutation. Review every file below before approving any archive, move, delete, copy, rename, upload, or folder creation command.**',
    '',
    '## Summary',
    '',
    `- Mode: \`${plan.mode}\``,
    `- Scope: \`${plan.scope}\``,
    `- Plan source: \`scripts/artifact-archive-plan.mjs\``,
    `- Inventory source: \`${plan.inventory_source}\``,
    `- Total artifact entries: ${plan.artifact_count}`,
    `- Archive candidates: ${plan.archive_candidate_count}`,
    `- Protected keep files: ${plan.keep_count}`,
    ''
  ];

  for (const [category, group] of Object.entries(plan.archive_candidate_groups || {})) {
    lines.push(renderGroup(`Archive Candidate: ${category}`, group));
  }

  lines.push(renderGroup('Protected / Keep', plan.protected_keep_group));
  lines.push('## Final Approval Gate');
  lines.push('');
  lines.push('Manual approval required before mutation. This report is read-only and does not authorize archive execution.');
  lines.push('');

  return lines.join('\n');
}

console.log(renderReport(readArchivePlan()));
