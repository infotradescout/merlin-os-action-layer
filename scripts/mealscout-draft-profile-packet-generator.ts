import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  generateMealScoutDraftProfilePackets,
  type MealScoutDraftPacketGenerationResult,
  type MealScoutScreenshotProfileCompletionTrackerRow
} from '../src/mealscoutDraftPacketGeneration.js';
import type { MealScoutArtifactClassificationRow } from '../src/mealscoutMenuArtifactClassification.js';

function parseArgs(argv: string[]): {
  sourceJson: string;
  trackerJson: string;
  artifactDir: string;
} {
  const parsed = {
    sourceJson: resolve(
      process.cwd(),
      '.artifact-quarantine/raw-evidence/artifacts/mealscout-menu-artifact-classification/artifact-classification-rows.json'
    ),
    trackerJson: resolve(
      process.cwd(),
      '.artifact-quarantine/raw-evidence/artifacts/mealscout-screenshot-processing-validation/duplicate-groups.json'
    ),
    artifactDir: resolve(process.cwd(), 'artifacts/mealscout-draft-profile-packets')
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--source-json') {
      parsed.sourceJson = resolve(process.cwd(), argv[++index] || '');
    } else if (arg === '--tracker-json') {
      parsed.trackerJson = resolve(process.cwd(), argv[++index] || '');
    } else if (arg === '--artifact-dir') {
      parsed.artifactDir = resolve(process.cwd(), argv[++index] || parsed.artifactDir);
    }
  }
  return parsed;
}

function renderSummaryMarkdown(result: MealScoutDraftPacketGenerationResult): string {
  return [
    '# MealScout Draft Profile Packet Summary',
    '',
    `- Mode: ${result.mode}`,
    `- Mutation allowed: ${result.mutationAllowed}`,
    `- Production applied: ${result.productionApplied}`,
    `- Source: ${result.manifestSummary.source}`,
    ...(result.manifestSummary.trackerSource ? [`- Tracker source: ${result.manifestSummary.trackerSource}`] : []),
    `- Evidence rows read: ${result.manifestSummary.evidenceRowsRead}`,
    `- Tracker/evidence rows processed: ${result.trackerRowsProcessed}`,
    `- Food vendors processed: ${result.foodVendorsProcessed}`,
    `- Non-food quarantined: ${result.nonFoodQuarantined}`,
    `- Unknown held: ${result.unknownHeld}`,
    `- Draft packets created: ${result.draftPacketsCreated}`,
    `- Conflicts found: ${result.conflictsFound}`,
    `- Owner confirmations required: ${result.ownerConfirmationsRequired}`,
    '',
    '## Safety',
    '',
    ...result.manifestSummary.notes.map((note) => `- ${note}`),
    '',
    '## Draft Packet Examples',
    '',
    ...result.draftPackets.slice(0, 10).map((packet) => {
      const name = packet.businessName?.value || packet.packetId;
      const fields = [
        packet.phone ? 'phone' : '',
        packet.website ? 'website' : '',
        packet.socials.facebook || packet.socials.instagram || packet.socials.other ? 'social' : '',
        packet.locationAddress ? 'location' : '',
        packet.scheduleHours ? 'schedule' : '',
        packet.menuItems.length > 0 ? 'menu' : ''
      ].filter(Boolean);
      return `- ${name}: ${fields.join(', ') || 'identity evidence only'}; review=${packet.reviewStatus}`;
    })
  ].join('\n') + '\n';
}

const args = parseArgs(process.argv.slice(2));
const rows = JSON.parse(readFileSync(args.sourceJson, 'utf8')) as MealScoutArtifactClassificationRow[];
const trackerRows = existsSync(args.trackerJson)
  ? (JSON.parse(readFileSync(args.trackerJson, 'utf8')) as MealScoutScreenshotProfileCompletionTrackerRow[])
  : undefined;
const result = generateMealScoutDraftProfilePackets(rows, {
  source: args.sourceJson,
  trackerSource: trackerRows ? args.trackerJson : undefined,
  trackerRows
});

mkdirSync(args.artifactDir, { recursive: true });
writeFileSync(resolve(args.artifactDir, 'draft-packets.json'), `${JSON.stringify(result.draftPackets, null, 2)}\n`, 'utf8');
writeFileSync(resolve(args.artifactDir, 'manifest-summary.json'), `${JSON.stringify(result.manifestSummary, null, 2)}\n`, 'utf8');
writeFileSync(resolve(args.artifactDir, 'non-food-quarantine.json'), `${JSON.stringify(result.nonFoodQuarantine, null, 2)}\n`, 'utf8');
writeFileSync(resolve(args.artifactDir, 'unknown-held.json'), `${JSON.stringify(result.unknownHeldRows, null, 2)}\n`, 'utf8');
writeFileSync(resolve(args.artifactDir, 'summary.md'), renderSummaryMarkdown(result), 'utf8');

process.stdout.write(
  `${JSON.stringify(
    {
      status: result.status,
      mode: result.mode,
      mutationAllowed: result.mutationAllowed,
      productionApplied: result.productionApplied,
      artifactDir: args.artifactDir,
      source: result.manifestSummary.source,
      trackerSource: result.manifestSummary.trackerSource,
      evidenceRowsRead: result.manifestSummary.evidenceRowsRead,
      trackerRowsProcessed: result.trackerRowsProcessed,
      foodVendorsProcessed: result.foodVendorsProcessed,
      nonFoodQuarantined: result.nonFoodQuarantined,
      unknownHeld: result.unknownHeld,
      draftPacketsCreated: result.draftPacketsCreated,
      conflictsFound: result.conflictsFound,
      ownerConfirmationsRequired: result.ownerConfirmationsRequired
    },
    null,
    2
  )}\n`
);
