import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createHeldRoutingOperatorReviewDashboardFixture
} from '../src/merlin/intake/operatorReviewPresentationFixture.ts';
import { serializeHeldRoutingOperatorReviewPresentation } from '../src/merlin/intake/operatorReviewPresentation.ts';

test('dashboard fixture is deterministic and serializer-backed', () => {
  const a = createHeldRoutingOperatorReviewDashboardFixture();
  const b = createHeldRoutingOperatorReviewDashboardFixture();

  assert.deepEqual(a, b);
  assert.equal(a.serializedPresentation, b.serializedPresentation);
  assert.equal(a.serializedPresentation, serializeHeldRoutingOperatorReviewPresentation(a.presentation));

  const keys = Object.keys(JSON.parse(a.serializedPresentation) as Record<string, unknown>);
  assert.deepEqual(keys, [
    'presentationId',
    'status',
    'mode',
    'advisoryOnly',
    'summaryId',
    'packetId',
    'currentStatus',
    'nextRequiredAction',
    'operatorWarnings',
    'display',
    'evidenceBindings',
    'decisionLedgerPreview',
    'approvalGatePreview',
    'summary',
    'mutationAllowed',
    'implementationAllowed',
    'executionAllowed'
  ]);
});

test('dashboard fixture authority flags are hard-false and read-only', () => {
  const fixture = createHeldRoutingOperatorReviewDashboardFixture();

  assert.equal(fixture.status, 'ok');
  assert.equal(fixture.mode, 'read_only');
  assert.equal(fixture.advisoryOnly, true);
  assert.equal(fixture.mutationAllowed, false);
  assert.equal(fixture.implementationAllowed, false);
  assert.equal(fixture.executionAllowed, false);

  assert.equal(fixture.presentation.mode, 'read_only');
  assert.equal(fixture.presentation.advisoryOnly, true);
  assert.equal(fixture.presentation.mutationAllowed, false);
  assert.equal(fixture.presentation.implementationAllowed, false);
  assert.equal(fixture.presentation.executionAllowed, false);

  assert.equal(fixture.presentation.summary.mutationAllowed, false);
  assert.equal(fixture.presentation.summary.implementationAllowed, false);
  assert.equal(fixture.presentation.summary.executionAllowed, false);
});

test('dashboard fixture cannot execute or mutate', () => {
  const fixture = createHeldRoutingOperatorReviewDashboardFixture();

  assert.equal(Object.isFrozen(fixture), true);
  assert.equal(Object.isFrozen(fixture.presentation), true);
  assert.equal(Object.isFrozen(fixture.presentation.summary), true);
  assert.equal(Object.isFrozen(fixture.presentation.operatorWarnings), true);
  assert.equal(Object.isFrozen(fixture.presentation.display.detailLines), true);
  assert.equal(Object.isFrozen(fixture.presentation.evidenceBindings), true);
  assert.equal(Object.isFrozen(fixture.presentation.evidenceBindings.detailLines), true);
  assert.equal(Object.isFrozen(fixture.presentation.evidenceBindings.warnings), true);
  assert.equal(Object.isFrozen(fixture.presentation.decisionLedgerPreview), true);
  assert.equal(Object.isFrozen(fixture.presentation.decisionLedgerPreview.evidenceSummary), true);
  assert.equal(Object.isFrozen(fixture.presentation.decisionLedgerPreview.authoritySnapshot), true);
  assert.equal(Object.isFrozen(fixture.presentation.approvalGatePreview), true);
  assert.equal(Object.isFrozen(fixture.presentation.approvalGatePreview.evidenceBindingStatus), true);
  assert.equal(Object.isFrozen(fixture.presentation.approvalGatePreview.authoritySnapshot), true);

  assert.equal('execute' in (fixture as Record<string, unknown>), false);
  assert.equal('apply' in (fixture as Record<string, unknown>), false);
  assert.equal('mutate' in (fixture as Record<string, unknown>), false);
  assert.equal('implement' in (fixture as Record<string, unknown>), false);

  assert.throws(() => {
    (fixture as { mode: string }).mode = 'live';
  }, TypeError);
  assert.throws(() => {
    fixture.presentation.operatorWarnings.push('force_execute');
  }, TypeError);
  assert.throws(() => {
    fixture.presentation.display.detailLines.push('authority:execution=true');
  }, TypeError);
  assert.throws(() => {
    fixture.presentation.evidenceBindings.warnings.push({
      warning: 'forced_warning',
      sourceReferences: [],
      evidenceState: 'no_evidence',
      noEvidenceReason: 'not_applicable'
    });
  }, TypeError);
  assert.throws(() => {
    fixture.presentation.decisionLedgerPreview.timestampPolicy.previewedAt = '2026-06-11T00:00:00.000Z';
  }, TypeError);
  assert.throws(() => {
    fixture.presentation.approvalGatePreview.gateStatus = 'eligible_preview_only';
  }, TypeError);
});
