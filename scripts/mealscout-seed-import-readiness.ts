import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  planMealScoutSeedImportReadiness,
  type MealScoutSeedCopyAuditRow,
  type MealScoutSeedExportRow
} from '../src/mealscoutSeedImportReadiness.js';

function parseArgs(argv: string[]): {
  seedExportPath: string;
  copyAuditPath: string;
  allowLiveApply: boolean;
} {
  const parsed = {
    seedExportPath: resolve(process.cwd(), 'screenshots-batch001-merlin-profile-seed-export.json'),
    copyAuditPath: resolve(process.cwd(), 'screenshots-copy-audit-manifest.csv'),
    allowLiveApply: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--seed-export') parsed.seedExportPath = resolve(process.cwd(), argv[++index] || parsed.seedExportPath);
    else if (arg === '--copy-audit') parsed.copyAuditPath = resolve(process.cwd(), argv[++index] || parsed.copyAuditPath);
    else if (arg === '--allow-live-apply') parsed.allowLiveApply = true;
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
const seedExportRows = JSON.parse(readFileSync(args.seedExportPath, 'utf8')) as MealScoutSeedExportRow[];
const copyAuditRows = parseCsv(readFileSync(args.copyAuditPath, 'utf8'));
const plan = planMealScoutSeedImportReadiness({
  seedExportRows,
  copyAuditRows,
  allowLiveApply: args.allowLiveApply
});

console.log(JSON.stringify({
  status: plan.status,
  mode: plan.mode,
  mutationAllowed: plan.mutationAllowed,
  eligibleRowCount: plan.eligibleRowCount,
  blockedRowCount: plan.blockedRowCount,
  plannedImports: plan.plannedImports.map((row) => ({
    evidence_file_id: row.evidence_file_id,
    original_source_file_id: row.original_source_file_id,
    planned_action: row.planned_action,
    existing_profile_id: row.existing_profile_id,
    field_writes: row.field_writes
  })),
  blockedRows: plan.blockedRows,
  safetyRules: plan.safetyRules
}, null, 2));
