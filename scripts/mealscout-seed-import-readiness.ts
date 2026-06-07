import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  authorizeMealScoutSeedApply,
  buildMealScoutSeedApplySimulationReport,
  buildMealScoutSeedImportDryRunReviewArtifact,
  computeMealScoutSeedExportChecksum,
  planMealScoutSeedImportReadiness,
  renderMealScoutSeedApplySimulationMarkdown,
  renderMealScoutSeedImportDryRunReviewMarkdown,
  type MealScoutSeedImportDryRunReviewArtifact,
  type MealScoutSeedCopyAuditRow,
  type MealScoutSeedExportRow
} from '../src/mealscoutSeedImportReadiness.js';

function parseArgs(argv: string[]): {
  seedExportPath: string;
  copyAuditPath: string;
  artifactDir: string;
  simulateApply: boolean;
  allowLiveApply: boolean;
  dryRunReviewPath: string;
  applySimulationReportJsonPath: string;
  applySimulationReportMarkdownPath: string;
} {
  const parsed = {
    seedExportPath: resolve(process.cwd(), 'screenshots-batch001-merlin-profile-seed-export.json'),
    copyAuditPath: resolve(process.cwd(), 'screenshots-copy-audit-manifest.csv'),
    artifactDir: resolve(process.cwd(), 'artifacts/mealscout-seed-import-readiness'),
    simulateApply: false,
    allowLiveApply: false,
    dryRunReviewPath: resolve(process.cwd(), 'artifacts/mealscout-seed-import-readiness/batch001-dry-run-review.json'),
    applySimulationReportJsonPath: resolve(
      process.cwd(),
      'artifacts/mealscout-seed-import-readiness/batch001-apply-simulation-report.json'
    ),
    applySimulationReportMarkdownPath: resolve(
      process.cwd(),
      'artifacts/mealscout-seed-import-readiness/batch001-apply-simulation-report.md'
    )
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--seed-export') parsed.seedExportPath = resolve(process.cwd(), argv[++index] || parsed.seedExportPath);
    else if (arg === '--copy-audit') parsed.copyAuditPath = resolve(process.cwd(), argv[++index] || parsed.copyAuditPath);
    else if (arg === '--artifact-dir') parsed.artifactDir = resolve(process.cwd(), argv[++index] || parsed.artifactDir);
    else if (arg === '--simulate-apply') parsed.simulateApply = true;
    else if (arg === '--allow-live-apply') parsed.allowLiveApply = true;
    else if (arg === '--dry-run-review') parsed.dryRunReviewPath = resolve(process.cwd(), argv[++index] || parsed.dryRunReviewPath);
    else if (arg === '--apply-simulation-report-json') {
      parsed.applySimulationReportJsonPath = resolve(process.cwd(), argv[++index] || parsed.applySimulationReportJsonPath);
    } else if (arg === '--apply-simulation-report-md') {
      parsed.applySimulationReportMarkdownPath = resolve(process.cwd(), argv[++index] || parsed.applySimulationReportMarkdownPath);
    }
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
const existingReviewArtifact = args.simulateApply
  ? (JSON.parse(readFileSync(args.dryRunReviewPath, 'utf8')) as MealScoutSeedImportDryRunReviewArtifact)
  : undefined;
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

const output: Record<string, unknown> = {
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
};

if (args.simulateApply) {
  const authorization = authorizeMealScoutSeedApply({
    seedExportRows,
    copyAuditRows,
    seedExportChecksum,
    dryRunReviewArtifact: existingReviewArtifact,
    allowLiveApply: args.allowLiveApply,
    postApplyReportPath: args.applySimulationReportJsonPath
  });
  if (authorization.status !== 'authorized') {
    throw new Error(`mealscout_seed_apply_simulation_blocked:${authorization.blockedReasons.join(',')}`);
  }
  const simulationReport = buildMealScoutSeedApplySimulationReport(authorization);
  const simulationMarkdown = renderMealScoutSeedApplySimulationMarkdown(simulationReport);

  mkdirSync(resolve(args.applySimulationReportJsonPath, '..'), { recursive: true });
  writeFileSync(args.applySimulationReportJsonPath, `${JSON.stringify(simulationReport, null, 2)}\n`, 'utf8');
  writeFileSync(args.applySimulationReportMarkdownPath, simulationMarkdown, 'utf8');

  output.applySimulation = {
    status: simulationReport.status,
    mode: simulationReport.mode,
    mutationExecuted: simulationReport.mutationExecuted,
    eligibleRowCount: simulationReport.eligibleRowCount,
    blockedRowCount: simulationReport.blockedRowCount,
    artifacts: {
      json: args.applySimulationReportJsonPath,
      markdown: args.applySimulationReportMarkdownPath
    }
  };
}

console.log(JSON.stringify(output, null, 2));
