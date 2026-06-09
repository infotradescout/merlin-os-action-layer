import { writeMerlinWeeklyScoreboardSnapshotArtifact } from '../src/merlin/weeklyScoreboardSnapshotArtifact.js';

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

const result = writeMerlinWeeklyScoreboardSnapshotArtifact({
  artifactRoot: readArg('--artifact-root'),
  weekStart: readArg('--week-start'),
  weekEnd: readArg('--week-end'),
  brandLane: readArg('--brand-lane'),
  generatedAt: readArg('--generated-at')
});

console.log(JSON.stringify({
  status: 'ok',
  mutationAllowed: false,
  artifactPath: result.artifactPath,
  weekKey: result.weekKey,
  generated_at: result.artifact.generated_at,
  week: result.artifact.week,
  metricCount: Object.keys(result.artifact.metrics).length
}, null, 2));
