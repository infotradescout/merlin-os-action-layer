import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const docPath = join(process.cwd(), 'docs', 'merlin', 'MERLIN_AI_FAILURE_PREVENTION_DOCTRINE.md');
const handoffDocPath = join(process.cwd(), 'docs', 'merlin', 'MERLIN_APP_BUILDER_CODEX_HANDOFF_CONTRACT.md');
const flightPlanDocPath = join(process.cwd(), 'docs', 'merlin', 'MERLIN_PROJECT_FLIGHT_PLAN_DOCTRINE.md');
const contextReuseDocPath = join(process.cwd(), 'docs', 'merlin', 'MERLIN_CONTEXT_AND_REUSE_DOCTRINE.md');

assert.equal(existsSync(docPath), true, 'MERLIN_AI_FAILURE_PREVENTION_DOCTRINE.md must exist');
assert.equal(existsSync(handoffDocPath), true, 'MERLIN_APP_BUILDER_CODEX_HANDOFF_CONTRACT.md must exist');
assert.equal(existsSync(flightPlanDocPath), true, 'MERLIN_PROJECT_FLIGHT_PLAN_DOCTRINE.md must exist');
assert.equal(existsSync(contextReuseDocPath), true, 'MERLIN_CONTEXT_AND_REUSE_DOCTRINE.md must exist');

const doctrine = readFileSync(docPath, 'utf8');
const handoffDoc = readFileSync(handoffDocPath, 'utf8');
const flightPlanDoc = readFileSync(flightPlanDocPath, 'utf8');
const contextReuseDoc = readFileSync(contextReuseDocPath, 'utf8');

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
  '13) Mandatory contract checks',
  '14) Easy On / Off / Revert'
];

for (const section of requiredSections) {
  const pattern = section.startsWith('1)')
    ? new RegExp(`### ${escapeForRegex(section)}`)
    : new RegExp(`## ${escapeForRegex(section)}`);
  assert.match(doctrine, pattern, `Missing required section: ${section}`);
}

const doctrinePatterns = [
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
  /next slice/,
  /enable \/ disable \/ revert summary/i,
  /Every AI-built change must have an easy on\/off switch and a clean revert path/i,
  /Feature flag or config gate when applicable/i,
  /Enable instructions/i,
  /Disable instructions/i,
  /Rollback instructions/i,
  /Safe-disable behavior/i,
  /Validation after revert/i,
  /What data cannot be reverted/i,
  /What breaks if reverted/i
];

for (const pattern of doctrinePatterns) {
  assert.match(doctrine, pattern, `Required doctrine text missing: ${pattern}`);
}

const contextReusePatterns = [
  /1\) Review-before-create/i,
  /2\) Constrained-builder rule/i,
  /3\) Shared component stash/i,
  /4\) Natural-language drop-in workflow/i,
  /5\) Timestamped work ledger/i,
  /6\) Time-gap awareness/i,
  /reuse → extend → create only if justified/i,
  /Created at/i,
  /Started at/i,
  /Completed at/i,
  /Last user instruction at/i,
  /1 minute later/i,
  /1 month later/i,
  /stale until re-reviewed/i
];

for (const pattern of contextReusePatterns) {
  assert.match(contextReuseDoc, pattern, `Required context and reuse doctrine text missing: ${pattern}`);
}

const handoffPatterns = [
  /Enable \/ Disable \/ Revert Contract/i,
  /Enable Instructions/i,
  /Disable Instructions/i,
  /Revert Instructions/i,
  /Safe-disable behavior/i,
  /Validation after revert/i,
  /What data cannot be reverted/i,
  /Data Non-revertibility Notes/i,
  /Migration rollback requirements/i,
  /Deployment rollback requirements/i
];

for (const pattern of handoffPatterns) {
  assert.match(handoffDoc, pattern, `Missing codex handoff contract requirement: ${pattern}`);
}

const flightPlanPatterns = [
  /14\. Revert \/ Disable Strategy/i,
  /Enable instructions/i,
  /Disable instructions/i,
  /Revert instructions/i,
  /Safe-disable behavior/i,
  /Validation after revert/i,
  /Rollback\/disable route documented/i,
  /Migration rollback requirements reviewed when applicable/i,
  /Deployment rollback requirements reviewed when applicable/i,
  /Feature flag or config gate when applicable/i
];

for (const pattern of flightPlanPatterns) {
  assert.match(flightPlanDoc, pattern, `Missing Flight Plan doctrine requirement: ${pattern}`);
}

console.log('Merlin AI failure prevention doctrine contract passed');
