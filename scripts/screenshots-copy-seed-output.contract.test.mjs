import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const copyAuditPath = 'screenshots-copy-audit-manifest.csv';
const seedReportPath = 'screenshots-batch001-seed-report.json';
const seedExportPath = 'screenshots-batch001-merlin-profile-seed-export.json';

assert.equal(existsSync(copyAuditPath), true, 'screenshots-copy-audit-manifest.csv must exist');
assert.equal(existsSync(seedReportPath), true, 'screenshots-batch001-seed-report.json must exist');
assert.equal(existsSync(seedExportPath), true, 'screenshots-batch001-merlin-profile-seed-export.json must exist');

function parseCsv(content) {
  const lines = content.split(/\r?\n/).filter((line) => line.length > 0);
  const header = lines[0].split(',');
  return lines.slice(1).map((line) => {
    const cols = line.split(',');
    const row = {};
    for (let i = 0; i < header.length; i += 1) {
      row[header[i]] = cols[i] || '';
    }
    return row;
  });
}

const copyAudit = parseCsv(readFileSync(copyAuditPath, 'utf8'));
const seedReport = JSON.parse(readFileSync(seedReportPath, 'utf8'));
const seedExport = JSON.parse(readFileSync(seedExportPath, 'utf8'));

assert.equal(Array.isArray(seedReport.results), true, 'seed report must contain results array');
assert.equal(Array.isArray(seedExport), true, 'seed export must be an array');
assert.equal(seedReport.results.length, seedExport.length, 'seed report and export row counts must match');

const batch001Copied = new Map(
  copyAudit
    .filter((row) => row.batch_id === 'BATCH-001-MEALSCOUT-MERLIN-SEED' && row.copy_status === 'copied')
    .map((row) => [row.copied_file_id, row])
);

for (const row of seedReport.results) {
  assert.equal(row.seeded_from_evidence, true, 'seed report rows must be seeded_from_evidence=true');
  assert.equal(row.profile_origin, 'evidence_seed', 'seed report rows must be evidence_seed');
  assert.equal(row.claim_status, 'unclaimed', 'seed report rows must be unclaimed');
  assert.equal(row.email_verified, false, 'seed report rows must set email_verified=false');
  assert.equal(row.insurance_verified, false, 'seed report rows must set insurance_verified=false');
  assert.equal(row.owner_user_id, null, 'seed report rows must set owner_user_id=null');
  assert.equal(typeof row.original_source_file_id, 'string', 'seed report rows must include original_source_file_id');
  assert.equal(typeof row.copied_file_id, 'string', 'seed report rows must include copied_file_id');
  assert.equal(row.evidence_file_id, row.copied_file_id, 'seed report rows must set evidence_file_id=copied_file_id');
  assert.equal(batch001Copied.has(row.copied_file_id), true, 'seed report rows must originate from copied BATCH-001 files');
}

for (const row of seedExport) {
  assert.equal(row.seeded_from_evidence, true, 'seed export rows must be seeded_from_evidence=true');
  assert.equal(row.profile_origin, 'evidence_seed', 'seed export rows must be evidence_seed');
  assert.equal(row.claim_status, 'unclaimed', 'seed export rows must be unclaimed');
  assert.equal(row.email_verified, false, 'seed export rows must set email_verified=false');
  assert.equal(row.insurance_verified, false, 'seed export rows must set insurance_verified=false');
  assert.equal(row.owner_user_id, null, 'seed export rows must set owner_user_id=null');

  const seedAction = copyAudit.find((auditRow) => auditRow.copied_file_id === row.source_file_id)?.seed_action;
  assert.equal(seedAction, 'seed_to_merlin_evidence', 'only BATCH-001 evidence rows may appear in seed export');
}

const reportText = readFileSync(seedReportPath, 'utf8');
assert.equal(reportText.includes('auto_onboarded'), false, 'seed report must never include auto_onboarded');

console.log('Screenshots copy seed output contract passed');
