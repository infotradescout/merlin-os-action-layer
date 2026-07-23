import { google } from 'googleapis';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import {
  parseCsvRows,
  toCsv,
  validateMealScoutScreenshotProcessingRows,
  type MealScoutCleanImportCandidate,
  type MealScoutDuplicateGroup,
  type MealScoutManualReviewRow,
  type MealScoutRejectedRow,
  type MealScoutScreenshotProcessingEvidenceRow,
  type MealScoutScreenshotProcessingSourceRow
} from '../src/mealscoutScreenshotProcessingValidation.js';

function parseArgs(argv: string[]): {
  sourceCsv?: string;
  sourceSheetId?: string;
  artifactDir: string;
} {
  const parsed: {
    sourceCsv?: string;
    sourceSheetId?: string;
    artifactDir: string;
  } = {
    sourceSheetId: '1Qm7gwETnNlZNcXFJG5FuxhAWPyuKc7gqd02nyCBVf34',
    artifactDir: resolve(process.cwd(), 'artifacts/mealscout-screenshot-processing-validation')
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--source-csv') {
      parsed.sourceCsv = resolve(process.cwd(), argv[++index] || '');
      parsed.sourceSheetId = undefined;
    } else if (arg === '--source-sheet-id') {
      parsed.sourceSheetId = argv[++index] || parsed.sourceSheetId;
    } else if (arg === '--artifact-dir') {
      parsed.artifactDir = resolve(process.cwd(), argv[++index] || parsed.artifactDir);
    }
  }
  return parsed;
}

async function exportSheetCsv(spreadsheetId: string): Promise<string> {
  config({ quiet: true });
  const auth = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI);
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  const drive = google.drive({ version: 'v3', auth });
  const response = await drive.files.export(
    {
      fileId: spreadsheetId,
      mimeType: 'text/csv'
    },
    { responseType: 'text' }
  );
  return typeof response.data === 'string' ? response.data : String(response.data);
}

function csvRowsForEvidence(rows: MealScoutScreenshotProcessingEvidenceRow[]): Record<string, unknown>[] {
  return rows.map((row) => ({
    source_row_number: row.sourceRowNumber,
    drive_file_id: row.driveFileId,
    final_filename: row.finalFilename,
    business_name: row.originalBusinessName,
    normalized_business_name: row.normalizedBusinessName || '',
    validation_status: row.validationStatus,
    reasons: row.reasons.join('|'),
    phone: row.contacts.phone || '',
    email: row.contacts.email || '',
    website: row.contacts.website || '',
    instagram: row.contacts.instagram || '',
    facebook: row.contacts.facebook || '',
    address: row.contacts.address || '',
    category_signals: row.categorySignals.join('|'),
    drive_url: row.driveUrl || ''
  }));
}

function csvRowsForCandidates(rows: MealScoutCleanImportCandidate[]): Record<string, unknown>[] {
  return rows.map((row) => ({
    candidate_id: row.candidateId,
    business_name: row.businessName,
    evidence_drive_file_ids: row.evidenceDriveFileIds.join('|'),
    evidence_row_numbers: row.evidenceRowNumbers.join('|'),
    phone: row.contacts.phone || '',
    email: row.contacts.email || '',
    website: row.contacts.website || '',
    instagram: row.contacts.instagram || '',
    facebook: row.contacts.facebook || '',
    address: row.contacts.address || '',
    category_signals: row.categorySignals.join('|'),
    duplicate_evidence_count: row.duplicateEvidenceCount,
    mutation_allowed: row.mutationAllowed
  }));
}

function csvRowsForManual(rows: MealScoutManualReviewRow[]): Record<string, unknown>[] {
  return csvRowsForEvidence(rows).map((row, index) => ({
    ...row,
    suggested_business_name: rows[index].suggestedBusinessName || ''
  }));
}

function csvRowsForRejected(rows: MealScoutRejectedRow[]): Record<string, unknown>[] {
  return csvRowsForEvidence(rows).map((row, index) => ({
    ...row,
    quarantine_reason: rows[index].quarantineReason
  }));
}

function csvRowsForDuplicates(rows: MealScoutDuplicateGroup[]): Record<string, unknown>[] {
  return rows.map((row) => ({
    duplicate_group_id: row.duplicateGroupId,
    group_key: row.groupKey,
    evidence_drive_file_ids: row.evidenceDriveFileIds.join('|'),
    business_names: row.businessNames.join('|'),
    phones: row.phones.join('|'),
    emails: row.emails.join('|'),
    websites: row.websites.join('|'),
    final_filenames: row.finalFilenames.join('|'),
    collapsed_candidate_id: row.collapsedCandidateId || ''
  }));
}

function renderMarkdownSummary(result: ReturnType<typeof validateMealScoutScreenshotProcessingRows>): string {
  return [
    '# MealScout Screenshot Processing Validation Report',
    '',
    `- Mode: ${result.mode}`,
    `- Mutation allowed: ${result.mutationAllowed}`,
    `- Source: ${result.source.title}`,
    `- Evidence rows: ${result.source.evidenceRowCount}`,
    `- Unique evidence rows: ${result.source.uniqueEvidenceRowCount}`,
    `- Clean import candidates: ${result.summary.cleanCandidateCount}`,
    `- Manual review rows: ${result.summary.manualReviewCount}`,
    `- Rejected/quarantined rows: ${result.summary.rejectedCount}`,
    `- Duplicate groups: ${result.summary.duplicateGroupCount}`,
    `- Rows with phone detected: ${result.summary.phoneDetectedCount}`,
    `- Rows with email detected: ${result.summary.emailDetectedCount}`,
    '',
    '## Safety',
    '',
    '- This report treats the source sheet as evidence only.',
    '- No live profile apply/import is performed.',
    '- Every source evidence row is preserved by drive_file_id.',
    '- Clean candidates are grouped/collapsed from duplicate evidence; evidence rows are not deleted.',
    '- Non-food service businesses are quarantined from MealScout import candidates.',
    '- Suspicious names and possible truncations require manual review.',
    '',
    '## Examples',
    '',
    ...(result.summary.examples.length > 0 ? result.summary.examples.map((example) => `- ${example}`) : ['- none'])
  ].join('\n') + '\n';
}

const args = parseArgs(process.argv.slice(2));
const sourceCsv = args.sourceCsv ? readFileSync(args.sourceCsv, 'utf8') : await exportSheetCsv(args.sourceSheetId || '');
const rows = parseCsvRows(sourceCsv) as MealScoutScreenshotProcessingSourceRow[];
const result = validateMealScoutScreenshotProcessingRows(rows);

mkdirSync(args.artifactDir, { recursive: true });
writeFileSync(resolve(args.artifactDir, 'evidence-rows.json'), `${JSON.stringify(result.evidenceRows, null, 2)}\n`, 'utf8');
writeFileSync(resolve(args.artifactDir, 'clean-import-candidates.json'), `${JSON.stringify(result.cleanCandidates, null, 2)}\n`, 'utf8');
writeFileSync(resolve(args.artifactDir, 'manual-review-rows.json'), `${JSON.stringify(result.manualReviewRows, null, 2)}\n`, 'utf8');
writeFileSync(resolve(args.artifactDir, 'rejected-rows.json'), `${JSON.stringify(result.rejectedRows, null, 2)}\n`, 'utf8');
writeFileSync(resolve(args.artifactDir, 'duplicate-groups.json'), `${JSON.stringify(result.duplicateGroups, null, 2)}\n`, 'utf8');
writeFileSync(resolve(args.artifactDir, 'summary.json'), `${JSON.stringify(result.summary, null, 2)}\n`, 'utf8');
writeFileSync(resolve(args.artifactDir, 'summary.md'), renderMarkdownSummary(result), 'utf8');

writeFileSync(
  resolve(args.artifactDir, 'evidence-rows.csv'),
  toCsv(csvRowsForEvidence(result.evidenceRows), [
    'source_row_number',
    'drive_file_id',
    'final_filename',
    'business_name',
    'normalized_business_name',
    'validation_status',
    'reasons',
    'phone',
    'email',
    'website',
    'instagram',
    'facebook',
    'address',
    'category_signals',
    'drive_url'
  ]),
  'utf8'
);
writeFileSync(
  resolve(args.artifactDir, 'clean-import-candidates.csv'),
  toCsv(csvRowsForCandidates(result.cleanCandidates), [
    'candidate_id',
    'business_name',
    'evidence_drive_file_ids',
    'evidence_row_numbers',
    'phone',
    'email',
    'website',
    'instagram',
    'facebook',
    'address',
    'category_signals',
    'duplicate_evidence_count',
    'mutation_allowed'
  ]),
  'utf8'
);
writeFileSync(
  resolve(args.artifactDir, 'manual-review-rows.csv'),
  toCsv(csvRowsForManual(result.manualReviewRows), [
    'source_row_number',
    'drive_file_id',
    'final_filename',
    'business_name',
    'normalized_business_name',
    'validation_status',
    'reasons',
    'phone',
    'email',
    'website',
    'instagram',
    'facebook',
    'address',
    'category_signals',
    'drive_url',
    'suggested_business_name'
  ]),
  'utf8'
);
writeFileSync(
  resolve(args.artifactDir, 'rejected-rows.csv'),
  toCsv(csvRowsForRejected(result.rejectedRows), [
    'source_row_number',
    'drive_file_id',
    'final_filename',
    'business_name',
    'normalized_business_name',
    'validation_status',
    'reasons',
    'phone',
    'email',
    'website',
    'instagram',
    'facebook',
    'address',
    'category_signals',
    'drive_url',
    'quarantine_reason'
  ]),
  'utf8'
);
writeFileSync(
  resolve(args.artifactDir, 'duplicate-groups.csv'),
  toCsv(csvRowsForDuplicates(result.duplicateGroups), [
    'duplicate_group_id',
    'group_key',
    'evidence_drive_file_ids',
    'business_names',
    'phones',
    'emails',
    'websites',
    'final_filenames',
    'collapsed_candidate_id'
  ]),
  'utf8'
);

console.log(JSON.stringify({
  status: result.status,
  mode: result.mode,
  mutationAllowed: result.mutationAllowed,
  artifactDir: args.artifactDir,
  summary: result.summary
}, null, 2));
