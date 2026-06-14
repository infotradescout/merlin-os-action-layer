import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import type { ThomasApprovalSweep } from '../src/mealscoutThomasApprovalSweep.ts';
import {
  buildThomasApprovedDraftExport,
  type ThomasAnnotatedApprovalSweepItem
} from '../src/mealscoutThomasApprovedDraftExport.ts';

function readApprovalSweep(): ThomasApprovalSweep & { candidates: ThomasAnnotatedApprovalSweepItem[] } {
  return JSON.parse(readFileSync('artifacts/mealscout-draft-profile-packets/thomas-clean-candidate-approval-sweep.json', 'utf8')) as ThomasApprovalSweep & {
    candidates: ThomasAnnotatedApprovalSweepItem[];
  };
}

function annotatedFixture(): ThomasApprovalSweep & { candidates: ThomasAnnotatedApprovalSweepItem[] } {
  const sweep = readApprovalSweep();
  return {
    ...sweep,
    candidates: sweep.candidates.slice(0, 5).map((candidate, index) => ({
      ...candidate,
      thomasDecision: (
        ['approve_draft', 'hold_for_more_evidence', 'wrong_business_name', 'duplicate_existing_profile', 'quarantine'] as const
      )[index]
    }))
  };
}

test('Thomas approved draft export includes only approve_draft decisions', () => {
  const exportPacket = buildThomasApprovedDraftExport({
    approvalSweep: annotatedFixture(),
    generatedAt: '2026-06-14T00:00:00.000Z'
  });

  assert.equal(exportPacket.summary.approvedDraftCount, 1);
  assert.equal(exportPacket.approvedDrafts.length, 1);
  assert.equal(exportPacket.approvedDrafts[0].thomasDecision, 'approve_draft');
  assert.equal(exportPacket.summary.excludedCount, 4);
});

test('Thomas approved draft export excludes held rejected duplicate and quarantine decisions', () => {
  const exportPacket = buildThomasApprovedDraftExport({
    approvalSweep: annotatedFixture(),
    generatedAt: '2026-06-14T00:00:00.000Z'
  });

  assert.deepEqual(exportPacket.summary.excludedByDecisionType, {
    hold_for_more_evidence: 1,
    wrong_business_name: 1,
    duplicate_existing_profile: 1,
    quarantine: 1
  });
  const serialized = JSON.stringify(exportPacket.approvedDrafts);
  assert.equal(serialized.includes('hold_for_more_evidence'), false);
  assert.equal(serialized.includes('wrong_business_name'), false);
  assert.equal(serialized.includes('duplicate_existing_profile'), false);
  assert.equal(serialized.includes('quarantine'), false);
});

test('Thomas approved draft export keeps production flags false', () => {
  const exportPacket = buildThomasApprovedDraftExport({
    approvalSweep: annotatedFixture(),
    generatedAt: '2026-06-14T00:00:00.000Z'
  });

  assert.equal(exportPacket.mutationAllowed, false);
  assert.equal(exportPacket.productionApplied, false);
  assert.equal(exportPacket.approvedDrafts.every((draft) => draft.mutationAllowed === false && draft.productionApplied === false), true);
});

test('Thomas approved draft export preserves source evidence and visible facts', () => {
  const exportPacket = buildThomasApprovedDraftExport({
    approvalSweep: annotatedFixture(),
    generatedAt: '2026-06-14T00:00:00.000Z'
  });
  const approved = exportPacket.approvedDrafts[0];

  assert.equal(approved.sourceEvidenceIds.length > 0, true);
  assert.equal(approved.sourceScreenshots.length, approved.sourceEvidenceIds.length);
  assert.equal(approved.sourceScreenshots[0].driveFileId, approved.sourceEvidenceIds[0]);
  assert.equal(Boolean(approved.extractedVisibleFacts.businessName), true);
  assert.equal(approved.nonProductionWarning.includes('review-only'), true);
});

test('Thomas approved draft export refuses to use recommendation without explicit Thomas decision input', () => {
  const sweep = readApprovalSweep();

  assert.throws(
    () =>
      buildThomasApprovedDraftExport({
        approvalSweep: sweep,
        generatedAt: '2026-06-14T00:00:00.000Z'
      }),
    /explicit_thomas_decision_required/
  );
});
