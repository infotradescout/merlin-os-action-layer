import { writeMerlinCouncilDecisionArtifact } from '../src/merlin/councilDecisionArtifact.js';

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function parseList(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(',').map((item) => item.trim()).filter((item) => item.length > 0);
}

function parseOwnerLaneDecisions(value: string | undefined): unknown[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    throw new Error('invalid_owner_lane_decisions');
  }
}

try {
  const result = writeMerlinCouncilDecisionArtifact({
    artifactRoot: readArg('--artifact-root'),
    snapshotPath: readArg('--snapshot-path'),
    decision: readArg('--decision'),
    rationale: readArg('--rationale') || '',
    blockers: parseList(readArg('--blockers')),
    nextActions: parseList(readArg('--next-actions')),
    ownerLaneDecisions: parseOwnerLaneDecisions(readArg('--owner-lane-decisions')),
    decidedBy: readArg('--decided-by') || 'operator',
    generatedAt: readArg('--generated-at')
  });

  console.log(
    JSON.stringify(
      {
        status: 'ok',
        mutationAllowed: false,
        artifactPath: result.artifactPath,
        weekKey: result.weekKey,
        generated_at: result.artifact.generated_at,
        decision: result.artifact.decision
      },
      null,
      2
    )
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
