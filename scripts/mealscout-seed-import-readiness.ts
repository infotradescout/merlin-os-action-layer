import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildMealScoutSeedImportDryRunReviewArtifact,
  computeMealScoutSeedExportChecksum,
  planMealScoutSeedImportReadiness,
  renderMealScoutSeedImportDryRunReviewMarkdown,
  type MealScoutSeedCopyAuditRow,
  type MealScoutSeedExportRow
} from '../src/mealscoutSeedImportReadiness.js';

function parseArgs(argv: string[]): {
  seedExportPath: string;
  copyAuditPath: string;
  artifactDir: string;
} {
  const parsed = {
    seedExportPath: resolve(process.cwd(), 'screenshots-batch001-merlin-profile-seed-export.json'),
    copyAuditPath: resolve(process.cwd(), 'screenshots-copy-audit-manifest.csv'),
    artifactDir: resolve(process.cwd(), 'artifacts/mealscout-seed-import-readiness')
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--seed-export') parsed.seedExportPath = resolve(process.cwd(), argv[++index] || parsed.seedExportPath);
    else if (arg === '--copy-audit') parsed.copyAuditPath = resolve(process.cwd(), argv[++index] || parsed.copyAuditPath);
    else if (arg === '--artifact-dir') parsed.artifactDir = resolve(process.cwd(), argv[++index] || parsed.artifactDir);
  }
  return parsed;
}

function parseCsv(content: string): MealScoutSeedCopyAuditRow[] {
  const lines = content.split(/\r?\n/).filter((line) => line.length > 0);
  const header = (lines[0] || '').split(',');
  return lines.slice(1).map((line) => {
    const cols = line.split(',');
    const row: Record<string, string> = {};
    for (let i = 0; i < header.length; i += 1) {
      row[header[i]] = cols[i] || '';
    }
    return row;
  });
}

const args = parseArgs(process.argv.slice(2));
const seedExportContent = readFileSync(args.seedExportPath, 'utf8');
const seedExportRows = JSON.parse(seedExportContent) as MealScoutSeedExportRow[];
const copyAuditRows = parseCsv(readFileSync(args.copyAuditPath, 'utf8'));
const seedExportChecksum = computeMealScoutSeedExportChecksum(seedExportContent);
const plan = planMealScoutSeedImportReadiness({
  seedExportRows,
  copyAuditRows
});
const artifact = buildMealScoutSeedImportDryRunReviewArtifact(plan, new Date().toISOString(), seedExportChecksum);
const markdown = renderMealScoutSeedImportDryRunReviewMarkdown(artifact);
const jsonArtifactPath = resolve(args.artifactDir, 'batch001-dry-run-review.json');
const markdownArtifactPath = resolve(args.artifactDir, 'batch001-dry-run-review.md');

mkdirSync(args.artifactDir, { recursive: true });
writeFileSync(jsonArtifactPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
writeFileSync(markdownArtifactPath, markdown, 'utf8');

console.log(JSON.stringify({
  status: plan.status,
  mode: plan.mode,
  mutationAllowed: plan.mutationAllowed,
  seedExportChecksum,
  eligibleRowCount: plan.eligibleRowCount,
  blockedRowCount: plan.blockedRowCount,
  artifacts: {
    json: jsonArtifactPath,
    markdown: markdownArtifactPath
  },
  plannedImports: plan.plannedImports.map((row) => ({
    evidence_file_id: row.evidence_file_id,
    original_source_file_id: row.original_source_file_id,
    planned_action: row.planned_action,
    existing_profile_id: row.existing_profile_id,
    existing_profile_name: row.existing_profile_name,
    field_writes: row.field_writes,
    omitted_fields: row.omitted_fields
  })),
  blockedRows: plan.blockedRows,
  safetyRules: plan.safetyRules
}, null, 2));
