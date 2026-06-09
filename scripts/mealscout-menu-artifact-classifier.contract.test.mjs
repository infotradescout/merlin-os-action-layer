import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const workspace = process.cwd();
const tempDir = mkdtempSync(join(tmpdir(), 'mealscout-menu-artifacts-'));
const sourceCsvPath = join(tempDir, 'source.csv');
const artifactDir = join(tempDir, 'out');

function csvCell(value) {
  const safe = String(value ?? '');
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function csvRow(row) {
  return [
    row.row,
    row.drive_file_id,
    row.drive_url,
    row.final_filename,
    row.filename_before_final_pass,
    row.business_name,
    row.ocr_snippet
  ].map(csvCell).join(',');
}

const fixtureRows = [
  {
    row: '1',
    drive_file_id: 'contract-comer-menu',
    drive_url: 'https://drive.google.com/file/d/contract-comer-menu/view',
    final_filename: 'a & gs & @.PNG',
    filename_before_final_pass: 'IMG_001.PNG',
    business_name: 'a & gs & @',
    ocr_snippet: '< Comer Fuego\nMenu\nBirria Tacos $12\nEmpanadas 8.00\nFried Oreos $5\nRamen $10\nFollow @ Message'
  },
  {
    row: '2',
    drive_file_id: 'contract-breakfast-one',
    drive_url: 'https://drive.google.com/file/d/contract-breakfast-one/view',
    final_filename: 'are mobile and our location varies.PNG',
    filename_before_final_pass: 'IMG_002.PNG',
    business_name: 'are mobile and our location varies.',
    ocr_snippet: 'Breakfast Bros\nare mobile and our location varies.\nPancakes $8\nCoffee $3\n850-222-1000'
  },
  {
    row: '3',
    drive_file_id: 'contract-breakfast-two',
    drive_url: 'https://drive.google.com/file/d/contract-breakfast-two/view',
    final_filename: 'Breakfast Bros.PNG',
    filename_before_final_pass: 'IMG_003.PNG',
    business_name: 'Breakfast Bros',
    ocr_snippet: 'Breakfast Bros\nBreakfast Plate $11\nCoffee $3\n850.222.1000'
  },
  {
    row: '4',
    drive_file_id: 'contract-ui-review',
    drive_url: 'https://drive.google.com/file/d/contract-ui-review/view',
    final_filename: 'Follow @ Message.PNG',
    filename_before_final_pass: 'IMG_004.PNG',
    business_name: 'Follow @ Message',
    ocr_snippet: 'Follow @ Message\nMenu\n$12'
  }
];

writeFileSync(
  sourceCsvPath,
  [
    'row,drive_file_id,drive_url,final_filename,filename_before_final_pass,business_name,ocr_snippet',
    ...fixtureRows.map(csvRow)
  ].join('\n') + '\n',
  'utf8'
);

const tsxCli = resolve(workspace, 'node_modules/tsx/dist/cli.mjs');

execFileSync(process.execPath, [
  tsxCli,
  'scripts/mealscout-menu-artifact-classifier.ts',
  '--source-csv',
  sourceCsvPath,
  '--artifact-dir',
  artifactDir
], { cwd: workspace, stdio: 'pipe' });

const requiredFiles = [
  'menu-candidates.csv',
  'menu-candidates.json',
  'menu-review-required.csv',
  'menu-review-required.json',
  'artifact-classification-summary.json',
  'duplicate-evidence-groups.json',
  'menu-extraction-summary.md'
];

for (const file of requiredFiles) {
  assert.equal(existsSync(join(artifactDir, file)), true, `${file} must be exported`);
}

const menuCandidates = JSON.parse(readFileSync(join(artifactDir, 'menu-candidates.json'), 'utf8'));
const reviewRequired = JSON.parse(readFileSync(join(artifactDir, 'menu-review-required.json'), 'utf8'));
const summary = JSON.parse(readFileSync(join(artifactDir, 'artifact-classification-summary.json'), 'utf8'));
const duplicateGroups = JSON.parse(readFileSync(join(artifactDir, 'duplicate-evidence-groups.json'), 'utf8'));
const markdown = readFileSync(join(artifactDir, 'menu-extraction-summary.md'), 'utf8');

assert.equal(summary.mutationAllowed, false, 'summary must forbid live mutation');
assert.equal(summary.totalRows, fixtureRows.length, 'summary must preserve source row count');
assert.equal(markdown.includes('No live profile, import, apply, or menu mutation is performed.'), true);

const comer = menuCandidates.find((row) => row.source_drive_file_id === 'contract-comer-menu');
assert.ok(comer, 'Comer Fuego menu candidate must be exported');
assert.equal(comer.linked_business_candidate, 'Comer Fuego');
assert.equal(comer.source_final_filename, 'a & gs & @.PNG');
assert.equal(comer.filename_before_final_pass, 'IMG_001.PNG');
assert.equal(comer.menu_items.some((item) => item.item_name === 'Birria Tacos' && item.price === '$12'), true);

const uiReview = reviewRequired.find((row) => row.source_drive_file_id === 'contract-ui-review');
assert.ok(uiReview, 'generic UI menu extraction failure must require review');
assert.equal(uiReview.linked_business_candidate, undefined);
assert.equal(uiReview.warnings.includes('menu_extraction_failed'), true);

const breakfastGroup = duplicateGroups.find((group) => group.linked_business_candidate === 'Breakfast Bros');
assert.ok(breakfastGroup, 'duplicate Breakfast Bros evidence must collapse into one group');
assert.deepEqual(
  new Set(breakfastGroup.evidence_drive_file_ids),
  new Set(['contract-breakfast-one', 'contract-breakfast-two'])
);

console.log('MealScout menu artifact classifier contract passed');
