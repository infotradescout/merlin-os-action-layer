import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  buildMerlinWeeklyScoreboardSnapshot,
  MERLIN_WEEKLY_SCOREBOARD_KPI_IDS,
  type MerlinWeeklyScoreboardSnapshot
} from './weeklyScoreboardContract.js';

export type MerlinWeeklyScoreboardSnapshotArtifact = MerlinWeeklyScoreboardSnapshot & {
  generated_at: string;
  council_decision: null;
  notes: '';
};

export type MerlinWeeklyScoreboardArtifactWrite = {
  artifact: MerlinWeeklyScoreboardSnapshotArtifact;
  artifactPath: string;
  weekKey: string;
};

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

export function isoWeekKey(isoDate: string): string {
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) throw new Error('invalid_week_start');
  const date = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
  return `${date.getUTCFullYear()}-${pad2(week)}`;
}

export function buildMerlinWeeklyScoreboardSnapshotArtifact(input: {
  weekStart?: string;
  weekEnd?: string;
  brandLane?: string;
  generatedAt?: string;
} = {}): MerlinWeeklyScoreboardSnapshotArtifact {
  const snapshot = buildMerlinWeeklyScoreboardSnapshot({
    weekStart: input.weekStart,
    weekEnd: input.weekEnd,
    brandLane: input.brandLane
  });
  const generatedAt = input.generatedAt || new Date().toISOString();
  if (Number.isNaN(Date.parse(generatedAt))) throw new Error('invalid_generated_at');

  for (const kpiId of MERLIN_WEEKLY_SCOREBOARD_KPI_IDS) {
    const metric = snapshot.metrics[kpiId];
    if (!metric) throw new Error(`missing_metric:${kpiId}`);
    if (metric.status === 'unavailable' && !metric.missing_reason) {
      throw new Error(`missing_unavailable_reason:${kpiId}`);
    }
  }

  return {
    generated_at: generatedAt,
    ...snapshot,
    council_decision: null,
    notes: ''
  };
}

export function weeklyScoreboardArtifactPath(input: {
  artifactRoot?: string;
  weekStart: string;
}): { artifactPath: string; weekKey: string } {
  const weekKey = isoWeekKey(input.weekStart);
  return {
    weekKey,
    artifactPath: resolve(input.artifactRoot || 'artifacts/merlin-scoreboard', weekKey, 'weekly-scoreboard.json')
  };
}

export function writeMerlinWeeklyScoreboardSnapshotArtifact(input: {
  artifactRoot?: string;
  weekStart?: string;
  weekEnd?: string;
  brandLane?: string;
  generatedAt?: string;
} = {}): MerlinWeeklyScoreboardArtifactWrite {
  const artifact = buildMerlinWeeklyScoreboardSnapshotArtifact(input);
  const { artifactPath, weekKey } = weeklyScoreboardArtifactPath({
    artifactRoot: input.artifactRoot,
    weekStart: artifact.week.start
  });
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  return { artifact, artifactPath, weekKey };
}
