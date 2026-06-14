import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  buildThomasMealScoutReviewQueue,
  renderThomasMealScoutReviewQueueMarkdown
} from '../src/mealscoutThomasReviewQueue.js';
import type { MealScoutDraftPacket, MealScoutDraftPacketHeldRow } from '../src/mealscoutDraftPacketGeneration.js';

function parseArgs(argv: string[]): {
  draftPacketsJson: string;
  manifestSummaryJson: string;
  unknownHeldJson: string;
  nonFoodQuarantineJson: string;
  outputJson: string;
  outputMarkdown: string;
} {
  const artifactDir = resolve(process.cwd(), 'artifacts/mealscout-draft-profile-packets');
  const parsed = {
    draftPacketsJson: resolve(artifactDir, 'draft-packets.json'),
    manifestSummaryJson: resolve(artifactDir, 'manifest-summary.json'),
    unknownHeldJson: resolve(artifactDir, 'unknown-held.json'),
    nonFoodQuarantineJson: resolve(artifactDir, 'non-food-quarantine.json'),
    outputJson: resolve(artifactDir, 'thomas-review-queue.json'),
    outputMarkdown: resolve(artifactDir, 'thomas-review-queue.md')
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1] || '';
    if (arg === '--draft-packets-json') parsed.draftPacketsJson = resolve(process.cwd(), next), index += 1;
    else if (arg === '--manifest-summary-json') parsed.manifestSummaryJson = resolve(process.cwd(), next), index += 1;
    else if (arg === '--unknown-held-json') parsed.unknownHeldJson = resolve(process.cwd(), next), index += 1;
    else if (arg === '--non-food-quarantine-json') parsed.nonFoodQuarantineJson = resolve(process.cwd(), next), index += 1;
    else if (arg === '--output-json') parsed.outputJson = resolve(process.cwd(), next), index += 1;
    else if (arg === '--output-md') parsed.outputMarkdown = resolve(process.cwd(), next), index += 1;
  }

  return parsed;
}

const args = parseArgs(process.argv.slice(2));
const draftPackets = JSON.parse(readFileSync(args.draftPacketsJson, 'utf8')) as MealScoutDraftPacket[];
const manifestSummary = JSON.parse(readFileSync(args.manifestSummaryJson, 'utf8')) as Record<string, number>;
const unknownHeldRows = JSON.parse(readFileSync(args.unknownHeldJson, 'utf8')) as MealScoutDraftPacketHeldRow[];
const nonFoodQuarantineRows = JSON.parse(readFileSync(args.nonFoodQuarantineJson, 'utf8')) as MealScoutDraftPacketHeldRow[];

const queue = buildThomasMealScoutReviewQueue({
  draftPackets,
  manifestSummary,
  unknownHeldRows,
  nonFoodQuarantineRows,
  sourceArtifacts: {
    draftPackets: args.draftPacketsJson,
    manifestSummary: args.manifestSummaryJson,
    unknownHeld: args.unknownHeldJson,
    nonFoodQuarantine: args.nonFoodQuarantineJson
  }
});

mkdirSync(dirname(args.outputJson), { recursive: true });
mkdirSync(dirname(args.outputMarkdown), { recursive: true });
writeFileSync(args.outputJson, `${JSON.stringify(queue, null, 2)}\n`, 'utf8');
writeFileSync(args.outputMarkdown, renderThomasMealScoutReviewQueueMarkdown(queue), 'utf8');

process.stdout.write(
  `${JSON.stringify(
    {
      status: 'ok',
      mode: queue.mode,
      outputJson: args.outputJson,
      outputMarkdown: args.outputMarkdown,
      draftPacketsReviewed: queue.summary.draftPacketsReviewed,
      cleanDraftCandidates: queue.summary.cleanDraftCandidates,
      blockedByConflict: queue.summary.blockedByConflict,
      ownerConfirmationRequired: queue.summary.ownerConfirmationRequired,
      ownerConfirmationBucket: queue.summary.ownerConfirmationBucket,
      lowConfidenceOrVisualReview: queue.summary.lowConfidenceOrVisualReview,
      unknownHeld: queue.summary.unknownHeld,
      nonFoodQuarantine: queue.summary.nonFoodQuarantine,
      liveMealScoutMutation: queue.liveMealScoutMutation
    },
    null,
    2
  )}\n`
);
