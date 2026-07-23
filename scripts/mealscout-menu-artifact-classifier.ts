import { google } from 'googleapis';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import {
  classifyMealScoutMenuArtifacts,
  duplicateMenuGroupsToCsv,
  menuArtifactRowsToCsv,
  parseMenuArtifactCsv,
  type MealScoutMenuArtifactClassificationResult
} from '../src/mealscoutMenuArtifactClassification.js';

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
    artifactDir: resolve(process.cwd(), 'artifacts/mealscout-menu-artifact-classification')
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

function renderMarkdownSummary(result: MealScoutMenuArtifactClassificationResult): string {
  return [
    '# MealScout Menu Artifact Classification Summary',
    '',
    `- Mode: ${result.mode}`,
    `- Mutation allowed: ${result.mutationAllowed}`,
    `- Source: ${result.source.title}`,
    `- Evidence rows: ${result.source.evidenceRowCount}`,
    `- Unique evidence rows: ${result.source.uniqueEvidenceRowCount}`,
    `- Profile rows: ${result.summary.profileCount}`,
    `- Menu rows: ${result.summary.menuCount}`,
    `- Possible menu rows: ${result.summary.possibleMenuCount}`,
    `- Schedule rows: ${result.summary.scheduleCount}`,
    `- Contact rows: ${result.summary.contactCount}`,
    `- Review rows: ${result.summary.reviewCount}`,
    `- Unknown rows: ${result.summary.unknownCount}`,
    `- Menu candidates: ${result.summary.menuCandidateCount}`,
    `- Menu review required: ${result.summary.menuReviewRequiredCount}`,
    `- Duplicate evidence groups: ${result.summary.duplicateGroupCount}`,
    '',
    '## Safety',
    '',
    '- The source sheet remains raw evidence only.',
    '- No live profile, import, apply, or menu mutation is performed.',
    '- Menu OCR creates review candidates only; it does not create or overwrite live menus.',
    '- Every source evidence row is preserved by drive_file_id in the classification export.',
    '- Generic UI text, location-only strings, and food-category-only strings are not accepted as business identities.',
    '',
    '## Examples',
    '',
    ...(result.summary.examples.length > 0 ? result.summary.examples.map((example) => `- ${example}`) : ['- none'])
  ].join('\n') + '\n';
}

const args = parseArgs(process.argv.slice(2));
const sourceCsv = args.sourceCsv ? readFileSync(args.sourceCsv, 'utf8') : await exportSheetCsv(args.sourceSheetId || '');
const rows = parseMenuArtifactCsv(sourceCsv);
const result = classifyMealScoutMenuArtifacts(rows);

mkdirSync(args.artifactDir, { recursive: true });
writeFileSync(resolve(args.artifactDir, 'artifact-classification-rows.json'), `${JSON.stringify(result.artifactRows, null, 2)}\n`, 'utf8');
writeFileSync(resolve(args.artifactDir, 'menu-candidates.json'), `${JSON.stringify(result.menuCandidates, null, 2)}\n`, 'utf8');
writeFileSync(resolve(args.artifactDir, 'menu-review-required.json'), `${JSON.stringify(result.menuReviewRequired, null, 2)}\n`, 'utf8');
writeFileSync(resolve(args.artifactDir, 'artifact-classification-summary.json'), `${JSON.stringify(result.summary, null, 2)}\n`, 'utf8');
writeFileSync(resolve(args.artifactDir, 'duplicate-evidence-groups.json'), `${JSON.stringify(result.duplicateEvidenceGroups, null, 2)}\n`, 'utf8');
writeFileSync(resolve(args.artifactDir, 'menu-extraction-summary.md'), renderMarkdownSummary(result), 'utf8');

writeFileSync(resolve(args.artifactDir, 'menu-candidates.csv'), menuArtifactRowsToCsv(result.menuCandidates), 'utf8');
writeFileSync(resolve(args.artifactDir, 'menu-review-required.csv'), menuArtifactRowsToCsv(result.menuReviewRequired), 'utf8');
writeFileSync(resolve(args.artifactDir, 'duplicate-evidence-groups.csv'), duplicateMenuGroupsToCsv(result.duplicateEvidenceGroups), 'utf8');

console.log(JSON.stringify({
  status: result.status,
  mode: result.mode,
  mutationAllowed: result.mutationAllowed,
  artifactDir: args.artifactDir,
  summary: result.summary
}, null, 2));
