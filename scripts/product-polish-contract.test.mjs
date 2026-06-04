import { existsSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const auditPath = new URL('../PRODUCT_POLISH_AUDIT.md', import.meta.url);
assert.equal(existsSync(auditPath), true, 'PRODUCT_POLISH_AUDIT.md must exist');

const audit = readFileSync(auditPath, 'utf8');

function requireText(label, pattern) {
  assert.match(audit, pattern, `${label} must be documented in PRODUCT_POLISH_AUDIT.md`);
}

function section(title) {
  const lines = audit.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `## ${title}`);
  assert.notEqual(start, -1, `section "${title}" must exist`);
  const body = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index].startsWith('## ')) break;
    body.push(lines[index]);
  }
  return body.join('\n').trim();
}

requireText('active surfaces', /## Active User And Operator Surfaces[\s\S]*\/admin\/drive-review-queue[\s\S]*\/admin\/mealscout-review-queue/);
requireText('surface purpose', /## What Each Surface Is For[\s\S]*Merlin Daily command center[\s\S]*Drive Review Queue[\s\S]*MealScout OCR Review Queue/);
requireText('raw debug surfaces', /## Raw Or Debug-Looking Surfaces[\s\S]*JSON\.stringify[\s\S]*mutationAllowed/);
requireText('inconsistent copy and labels', /## Inconsistent Copy And Labels[\s\S]*action card[\s\S]*draft[\s\S]*profile[\s\S]*seed[\s\S]*apply[\s\S]*publish/);
requireText('inconsistent buttons publish', /## Inconsistent Buttons And Actions[\s\S]*Publish \(Disabled\)/);
requireText('inconsistent buttons bulk apply', /## Inconsistent Buttons And Actions[\s\S]*Bulk Approve \+ Apply Selected/);
requireText('cards tables layouts', /## Inconsistent Cards, Tables, And Layouts[\s\S]*MealScout Review Queue[\s\S]*Status badges/);
requireText('mobile risks', /## Mobile Layout Risks[\s\S]*MealScout review queue[\s\S]*mobile[\s\S]*Long button labels/);
requireText('admin operator confusion risks', /## Admin And Operator Confusion Risks[\s\S]*affiliate attribution[\s\S]*payout[\s\S]*publish-plan preview/);
requireText('brand separation risks', /## Brand Separation Risks[\s\S]*Merlin[\s\S]*MealScout[\s\S]*TradeScout[\s\S]*Trader's Corner/);

const fixes = section('Top 10 Polish Fixes Ranked By User Impact')
  .split(/\r?\n/)
  .filter((line) => /^\d+\. Polish fix: /.test(line.trim()));
assert.equal(fixes.length, 10, 'exactly 10 polish fixes must be listed');

const featurePatterns = [
  /\bnew product feature\b/i,
  /\bnew product surface\b/i,
  /\bnew API\b/i,
  /\bnew data model\b/i,
  /\benable live connector\b/i,
  /\bautomatic notification\b/i,
  /\bpayout logic\b/i,
  /\bverification shortcut\b/i
];

const fixesText = section('Top 10 Polish Fixes Ranked By User Impact');
for (const pattern of featurePatterns) {
  assert.doesNotMatch(fixesText, pattern, `polish fixes must not propose forbidden feature behavior: ${pattern}`);
}

requireText('no new product features are proposed', /No new product features are proposed by this audit\./);
requireText('no payout live execution verification shortcut', /No payout, live execution, or verification shortcut is proposed\./);
requireText('behavior preservation boundary', /## Behavior Preservation Boundary[\s\S]*No verification flag changes[\s\S]*No payout behavior changes[\s\S]*No live connector execution changes/);
