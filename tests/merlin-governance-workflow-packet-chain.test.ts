import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGovernanceWorkflowPacketChain } from '../src/merlin/governance/workflowPacketChain.ts';

function buildInput(overrides: Partial<Parameters<typeof createGovernanceWorkflowPacketChain>[0]> = {}) {
  return {
    operatorRequest: 'Add draft packet-chain generation for governance review.',
    repoName: 'merlin-os-action-layer',
    laneName: 'Merlin Governance Workflow Automation',
    routeContext: 'governance/workflow-packet-chain',
    baselineSha: 'be67b0fb50ac0cb3cdd8538187c88440defa707d',
    allowedFiles: ['docs/merlin/**', 'docs/ai-build-process/**', 'src/merlin/governance/**'],
    bannedFiles: ['public/**', 'server/**', 'src/merlin/intake/**'],
    validationRequirements: ['npm run check'],
    evidenceRequirements: ['governance_diff_review'],
    reviewRequirements: ['gawain_merge_review'],
    ...overrides
  };
}

test('packet ids are deterministic from stable input', () => {
  const a = createGovernanceWorkflowPacketChain(buildInput());
  const b = createGovernanceWorkflowPacketChain(buildInput());

  assert.deepEqual(a, b);
  assert.equal(a.customerRequestPacket.customer_request_packet_id, b.customerRequestPacket.customer_request_packet_id);
  assert.equal(a.routePacket.route_packet_id, b.routePacket.route_packet_id);
  assert.equal(a.slicePacket.slice_id, b.slicePacket.slice_id);
  assert.equal(a.ledgerEventDraft.ledger_event_id, b.ledgerEventDraft.ledger_event_id);
});

test('missing baseline sha fails closed', () => {
  const chain = createGovernanceWorkflowPacketChain(
    buildInput({
      baselineSha: undefined
    })
  );

  assert.equal(chain.baselineSha, null);
  assert.equal(chain.customerRequestPacket.status, 'incomplete');
  assert.equal(chain.routePacket.status, 'blocked');
  assert.equal(chain.slicePacket.status, 'blocked');
  assert.equal(chain.ledgerEventDraft.status, 'blocked');
  assert.equal(chain.routePacket.statusReasonCodes.includes('missing_baseline_sha'), true);
});

test('packets separate confirmed facts, claims, assumptions, missing evidence, and approvals', () => {
  const chain = createGovernanceWorkflowPacketChain(buildInput());

  assert.equal(chain.routePacket.confirmedFacts.includes('repo_name:merlin-os-action-layer'), true);
  assert.equal(
    chain.routePacket.operatorProvidedClaims.includes(
      'operator_request:Add draft packet-chain generation for governance review.'
    ),
    true
  );
  assert.equal(
    chain.routePacket.assumptions.includes('generated_packets_remain_drafts_until_evidence_review_and_approval_complete'),
    true
  );
  assert.equal(chain.routePacket.missingEvidence.includes('validation_evidence:npm run check'), true);
  assert.equal(chain.routePacket.requiredApprovals.includes('merge:gawain_approval'), true);
});

test('missing validation evidence prevents completion and keeps ledger pending', () => {
  const chain = createGovernanceWorkflowPacketChain(buildInput());

  assert.equal(chain.evidencePacket.completionEligible, false);
  assert.equal(chain.evidencePacket.status, 'pending_evidence');
  assert.equal(chain.evidencePacket.statusReasonCodes.includes('validation_evidence:npm run check'), true);
  assert.equal(chain.ledgerEventDraft.status, 'pending');
});

test('review packet cannot be auto-approved by codex', () => {
  const chain = createGovernanceWorkflowPacketChain(
    buildInput({
      suppliedEvidenceRefs: ['governance_diff_review'],
      validationResults: [
        {
          requirement: 'npm run check',
          status: 'pass',
          evidenceRef: 'npm-run-check-pass'
        }
      ],
      reviewDecision: {
        reviewedBy: 'codex',
        disposition: 'approve',
        evidenceRefs: ['review-note']
      }
    })
  );

  assert.equal(chain.reviewPacket.autoApprovalBlocked, true);
  assert.equal(chain.reviewPacket.status, 'pending_review');
  assert.equal(chain.reviewPacket.statusReasonCodes.includes('codex_cannot_auto_approve_review'), true);
  assert.equal(chain.reconciliationPacket.mergeReady, false);
});

test('gawain approval is required before merge-ready status', () => {
  const chainWithoutApproval = createGovernanceWorkflowPacketChain(
    buildInput({
      suppliedEvidenceRefs: ['governance_diff_review'],
      validationResults: [
        {
          requirement: 'npm run check',
          status: 'pass',
          evidenceRef: 'npm-run-check-pass'
        }
      ],
      reviewDecision: {
        reviewedBy: 'gemini',
        disposition: 'approve',
        evidenceRefs: ['gemini-review']
      }
    })
  );

  assert.equal(chainWithoutApproval.reconciliationPacket.mergeReady, false);
  assert.equal(chainWithoutApproval.reconciliationPacket.statusReasonCodes.includes('gawain_approval_required'), true);

  const chainWithApproval = createGovernanceWorkflowPacketChain(
    buildInput({
      suppliedEvidenceRefs: ['governance_diff_review'],
      validationResults: [
        {
          requirement: 'npm run check',
          status: 'pass',
          evidenceRef: 'npm-run-check-pass'
        }
      ],
      reviewDecision: {
        reviewedBy: 'gemini',
        disposition: 'approve',
        evidenceRefs: ['gemini-review']
      },
      gawainApproval: {
        approvedBy: 'gawain',
        disposition: 'approve'
      },
      commitSha: '1234567890abcdef'
    })
  );

  assert.equal(chainWithApproval.reconciliationPacket.mergeReady, true);
  assert.equal(chainWithApproval.ledgerEventDraft.status, 'merge_ready');
});

test('no packet claims execution without evidence', () => {
  const chain = createGovernanceWorkflowPacketChain(buildInput());

  assert.equal(chain.slicePacket.executionRecordStatus, 'no_execution_claim');
  assert.equal(chain.ledgerEventDraft.executedBy.actor_id, null);
  assert.equal(
    chain.ledgerEventDraft.executedBy.reason,
    'No packet may claim execution happened unless evidence is supplied.'
  );
});

test('governance namespace stays neutral and does not hardcode product brands', () => {
  const chain = createGovernanceWorkflowPacketChain(buildInput());

  assert.equal(chain.governanceNamespace, 'merlin_governance');
  for (const packet of [
    chain.customerRequestPacket,
    chain.routePacket,
    chain.slicePacket,
    chain.evidencePacket,
    chain.reviewPacket,
    chain.reconciliationPacket,
    chain.ledgerEventDraft
  ]) {
    assert.equal(packet.governanceNamespace, 'merlin_governance');
    assert.equal(packet.governanceNamespace.includes('TradeScout'), false);
    assert.equal(packet.governanceNamespace.includes('MealScout'), false);
    assert.equal(packet.governanceNamespace.includes('Sway'), false);
    assert.equal(packet.governanceNamespace.includes('Albion'), false);
    assert.equal(packet.governanceNamespace.includes('AutoBott'), false);
  }
});
