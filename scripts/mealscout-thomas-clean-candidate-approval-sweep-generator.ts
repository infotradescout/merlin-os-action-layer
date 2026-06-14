import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  buildThomasCleanCandidateApprovalSweep,
  renderThomasCleanCandidateApprovalSweepMarkdown
} from '../src/mealscoutThomasApprovalSweep.js';
import type { ThomasReviewQueue } from '../src/mealscoutThomasReviewQueue.js';

function parseArgs(argv: string[]): {
  reviewQueueJson: string;
  draftPacketsJson: string;
  outputJson: string;
  outputMarkdown: string;
} {
  const artifactDir = resolve(process.cwd(), 'artifacts/mealscout-draft-profile-packets');
  const parsed = {
    reviewQueueJson: resolve(artifactDir, 'thomas-review-queue.json'),
    draftPacketsJson: resolve(artifactDir, 'draft-packets.json'),
    outputJson: resolve(artifactDir, 'thomas-clean-candidate-approval-sweep.json'),
    outputMarkdown: resolve(artifactDir, 'thomas-clean-candidate-approval-sweep.md')
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1] || '';
    if (arg === '--review-queue-json') parsed.reviewQueueJson = resolve(process.cwd(), next), index += 1;
    else if (arg === '--draft-packets-json') parsed.draftPacketsJson = resolve(process.cwd(), next), index += 1;
    else if (arg === '--output-json') parsed.outputJson = resolve(process.cwd(), next), index += 1;
    else if (arg === '--output-md') parsed.outputMarkdown = resolve(process.cwd(), next), index += 1;
  }

  return parsed;
}

const args = parseArgs(process.argv.slice(2));
const reviewQueue = JSON.parse(readFileSync(args.reviewQueueJson, 'utf8')) as ThomasReviewQueue;
const sweep = buildThomasCleanCandidateApprovalSweep({
  reviewQueue,
  sourceArtifacts: {
    thomasReviewQueue: args.reviewQueueJson,
    draftPackets: args.draftPacketsJson
  }
});

mkdirSync(dirname(args.outputJson), { recursive: true });
mkdirSync(dirname(args.outputMarkdown), { recursive: true });
writeFileSync(args.outputJson, `${JSON.stringify(sweep, null, 2)}\n`, 'utf8');
writeFileSync(args.outputMarkdown, renderThomasCleanCandidateApprovalSweepMarkdown(sweep), 'utf8');

process.stdout.write(
  `${JSON.stringify(
    {
      status: 'ok',
      mode: sweep.mode,
      outputJson: args.outputJson,
      outputMarkdown: args.outputMarkdown,
      cleanCandidatesIncluded: sweep.summary.cleanCandidatesIncluded,
      excludedBlockedConflicts: sweep.summary.excludedBlockedConflicts,
      excludedOwnerConfirmationRecords: sweep.summary.excludedOwnerConfirmationRecords,
      excludedUnknownHeld: sweep.summary.excludedUnknownHeld,
      excludedNonFoodQuarantine: sweep.summary.excludedNonFoodQuarantine,
      liveMealScoutMutation: sweep.liveMealScoutMutation
    },
    null,
    2
  )}\n`
);
