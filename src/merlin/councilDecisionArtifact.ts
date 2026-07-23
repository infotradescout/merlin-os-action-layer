import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { isoWeekKey } from './weeklyScoreboardSnapshotArtifact.js';

export const MERLIN_COUNCIL_DECISIONS = ['pass', 'fail', 'deferred'] as const;

export type MerlinCouncilDecision = (typeof MERLIN_COUNCIL_DECISIONS)[number];

export type MerlinCouncilOwnerLaneDecision = {
  owner_lane: string;
  decision: MerlinCouncilDecision;
  rationale: string;
};

export type MerlinCouncilDecisionArtifact = {
  generated_at: string;
  weekKey: string;
  snapshotPath: string;
  decision: MerlinCouncilDecision;
  rationale: string;
  blockers: string[];
  next_actions: string[];
  owner_lane_decisions: MerlinCouncilOwnerLaneDecision[];
  decided_by: string;
  mutationAllowed: false;
};

export type MerlinCouncilDecisionArtifactWrite = {
  artifact: MerlinCouncilDecisionArtifact;
  artifactPath: string;
  weekKey: string;
};

function assertNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`invalid_${label}`);
  }
  return value.trim();
}

function readSnapshotWeekKey(snapshotPath: string): string {
  const filePath = resolve(snapshotPath);
  if (!existsSync(filePath)) {
    throw new Error('snapshot_not_found');
  }

  const content = readFileSync(filePath, 'utf8');
  let parsed: { week?: { start?: string } };
  try {
    parsed = JSON.parse(content) as { week?: { start?: string } };
  } catch {
    throw new Error('invalid_snapshot_json');
  }

  const weekStart = parsed.week?.start;
  if (typeof weekStart !== 'string' || weekStart.trim().length === 0) {
    throw new Error('invalid_snapshot_week_start');
  }

  return isoWeekKey(weekStart);
}

function parseDecision(value: string): MerlinCouncilDecision {
  if ((MERLIN_COUNCIL_DECISIONS as readonly string[]).includes(value)) {
    return value as MerlinCouncilDecision;
  }
  throw new Error('invalid_decision');
}

function assertOwnerLaneDecision(entry: unknown): MerlinCouncilOwnerLaneDecision {
  if (!entry || typeof entry !== 'object') {
    throw new Error('invalid_owner_lane_decisions');
  }
  const candidate = entry as {
    owner_lane?: unknown;
    decision?: unknown;
    rationale?: unknown;
  };
  const ownerLane = assertNonEmptyString(candidate.owner_lane, 'owner_lane_decision_owner_lane');
  const laneDecision = assertNonEmptyString(candidate.decision, 'owner_lane_decision_decision');
  const rationale = assertNonEmptyString(candidate.rationale, 'owner_lane_decision_rationale');
  return {
    owner_lane: ownerLane,
    decision: parseDecision(laneDecision),
    rationale
  };
}

export function councilDecisionArtifactPath(input: {
  artifactRoot?: string;
  weekKey: string;
}): { artifactPath: string; weekKey: string } {
  const artifactPath = resolve(input.artifactRoot || 'artifacts/merlin-scoreboard', input.weekKey, 'council-decision.json');
  return {
    weekKey: input.weekKey,
    artifactPath
  };
}

export function buildMerlinCouncilDecisionArtifact(input: {
  snapshotPath?: string;
  decision: unknown;
  rationale?: string;
  blockers?: string[];
  nextActions?: string[];
  ownerLaneDecisions?: unknown[];
  decidedBy?: string;
  generatedAt?: string;
  weekKey?: string;
}): MerlinCouncilDecisionArtifact {
  const snapshotPath = assertNonEmptyString(input.snapshotPath, 'snapshot_path');
  const weekKey = input.weekKey ?? readSnapshotWeekKey(snapshotPath);
  const generatedAt = input.generatedAt || new Date().toISOString();
  if (Number.isNaN(Date.parse(generatedAt))) {
    throw new Error('invalid_generated_at');
  }

  const ownerLaneDecisions = Array.isArray(input.ownerLaneDecisions)
    ? input.ownerLaneDecisions.map(assertOwnerLaneDecision)
    : [];
  const blockers = Array.isArray(input.blockers) ? input.blockers : [];
  const nextActions = Array.isArray(input.nextActions) ? input.nextActions : [];
  const decidedBy = assertNonEmptyString(input.decidedBy ?? 'operator', 'decided_by');
  const rationale = typeof input.rationale === 'string' ? input.rationale : '';

  if (blockers.some((item) => typeof item !== 'string')) throw new Error('invalid_blockers');
  if (nextActions.some((item) => typeof item !== 'string')) throw new Error('invalid_next_actions');

  return {
    generated_at: generatedAt,
    weekKey,
    snapshotPath,
    decision: parseDecision(assertNonEmptyString(input.decision, 'decision')),
    rationale,
    blockers,
    next_actions: nextActions,
    owner_lane_decisions: ownerLaneDecisions,
    decided_by: decidedBy,
    mutationAllowed: false
  };
}

export function writeMerlinCouncilDecisionArtifact(input: {
  artifactRoot?: string;
  snapshotPath?: string;
  decision: unknown;
  rationale?: string;
  blockers?: string[];
  nextActions?: string[];
  ownerLaneDecisions?: unknown[];
  decidedBy?: string;
  generatedAt?: string;
  weekKey?: string;
}): MerlinCouncilDecisionArtifactWrite {
  const artifact = buildMerlinCouncilDecisionArtifact(input);
  const { artifactPath, weekKey } = councilDecisionArtifactPath({
    artifactRoot: input.artifactRoot,
    weekKey: artifact.weekKey
  });

  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  return { artifact, artifactPath, weekKey };
}
