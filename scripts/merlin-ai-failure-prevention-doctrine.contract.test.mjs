import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const docPath = join(process.cwd(), 'docs', 'merlin', 'MERLIN_AI_FAILURE_PREVENTION_DOCTRINE.md');
assert.equal(existsSync(docPath), true, 'MERLIN_AI_FAILURE_PREVENTION_DOCTRINE.md must exist');

const doc = readFileSync(docPath, 'utf8');

function escapeForRegex(input) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const requiredSections = [
  'Core Identity',
  '1) Complete-first implementation',
  '2) Completion proof, not completion claims',
  '3) File-size and maintainability limits',
  '4) Screenshots as visual reference only',
  '5) No random AI sprawl',
  '6) No incomplete handoff',
  '7) No fake progress',
  '8) No context loss',
  '9) Approved slices only',
  '10) Human + Council authority model',
  '11) Built-in drift prevention',
  '12) Route first through Design Source Packet for UI',
  '13) Mandatory contract checks'
];

for (const section of requiredSections) {
  const pattern = section.startsWith('1)')
    ? new RegExp(`### ${escapeForRegex(section)}`)
    : new RegExp(`## ${escapeForRegex(section)}`);
  assert.match(doc, pattern, `Missing required section: ${section}`);
}

const requiredPatterns = [
  /Every function, file, component, route, schema, and test/,
  /No AI output is considered complete unless it is:/,
  /Soft warning at \*\*400 lines\*\*/,
  /Required split plan at \*\*700 lines\*\*/,
  /Blocked at \*\*1,000\+ lines\*\*/,
  /Never acceptable: \*\*12,000-line files\*\*/,
  /Screenshots and mockups are visual proof, not implementation source/i,
  /Implementation source must be:/,
  /Design Source Packet/,
  /Component tree/,
  /Layout rules/,
  /State rules/,
  /Responsive behavior/,
  /Data dependencies/,
  /Acceptance criteria/,
  /Do not use invented evidence, invented users, invented KPI values, or invented market claims/i,
  /Missing evidence\.\s*Decision blocked or assumption required\./i,
  /human authority is final/i,
  /Albion Council/,
  /Codex must always include:/,
  /files changed/,
  /validation run/,
  /validation result/,
  /known risks/,
  /unfinished items/,
  /commit message/,
  /next slice/
];

for (const pattern of requiredPatterns) {
  assert.match(doc, pattern, `Required doctrine text missing: ${pattern}`);
}

console.log('Merlin AI failure prevention doctrine contract passed');
