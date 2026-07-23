import type {
  HeldRoutingOperatorReviewPresentation,
  HeldRoutingOperatorReviewSummary
} from './intakeTypes.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function loadOperatorReviewPresentationRuntime(): {
  createHeldRoutingOperatorReviewPresentation: (
    summary: HeldRoutingOperatorReviewSummary,
    input: { presentationId?: string }
  ) => HeldRoutingOperatorReviewPresentation;
  serializeHeldRoutingOperatorReviewPresentation: (presentation: HeldRoutingOperatorReviewPresentation) => string;
} {
  try {
    return require('./operatorReviewPresentation.ts');
  } catch {
    return require('./operatorReviewPresentation.js');
  }
}

export type HeldRoutingOperatorReviewDashboardFixture = {
  fixtureId: 'held_routing_operator_review_dashboard_fixture_v1';
  status: 'ok';
  mode: 'read_only';
  advisoryOnly: true;
  generatedAt: '2026-06-10T00:00:00.000Z';
  presentation: HeldRoutingOperatorReviewPresentation;
  serializedPresentation: string;
  mutationAllowed: false;
  implementationAllowed: false;
  executionAllowed: false;
};

const DASHBOARD_SUMMARY_FIXTURE: HeldRoutingOperatorReviewSummary = {
  summaryId: 'summary-dashboard-fixture-v1',
  packetId: 'held-routing-packet-dashboard-fixture-v1',
  currentStatus: 'ready',
  decisionSummary: {
    present: true,
    decisionId: 'decision-dashboard-fixture-v1',
    resultingStatus: 'approved_for_apply',
    resolvedDestination: 'menu',
    valid: true
  },
  eligibilitySummary: {
    present: true,
    decisionId: 'decision-dashboard-fixture-v1',
    applyEligible: true,
    reason: 'apply_ready_requires_explicit_approval',
    valid: true
  },
  explicitApprovalSummary: {
    present: true,
    approvalId: 'approval-dashboard-fixture-v1',
    decisionId: 'decision-dashboard-fixture-v1',
    applyApproved: true,
    reason: 'explicit_apply_approval_recorded',
    valid: true
  },
  finalExecutorPreviewSummary: {
    present: true,
    previewId: 'preview-dashboard-fixture-v1',
    approvalId: 'approval-dashboard-fixture-v1',
    readyForFinalExecutor: true,
    reason: 'final_executor_preview_ready',
    valid: true
  },
  dryRunPlanSummary: {
    present: true,
    dryRunId: 'dry-run-dashboard-fixture-v1',
    previewId: 'preview-dashboard-fixture-v1',
    plannedOperation: 'route_to_resolved_destination',
    reason: 'dry_run_ready_for_live_executor',
    valid: true
  },
  nextRequiredAction: 'ready_for_live_executor',
  operatorWarnings: [],
  mutationAllowed: false,
  implementationAllowed: false,
  executionAllowed: false
};

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;

  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return value;
}

export function createHeldRoutingOperatorReviewDashboardFixture(): HeldRoutingOperatorReviewDashboardFixture {
  const {
    createHeldRoutingOperatorReviewPresentation,
    serializeHeldRoutingOperatorReviewPresentation
  } = loadOperatorReviewPresentationRuntime();

  const presentation = createHeldRoutingOperatorReviewPresentation(DASHBOARD_SUMMARY_FIXTURE, {
    presentationId: 'presentation-dashboard-fixture-v1'
  });

  const fixture: HeldRoutingOperatorReviewDashboardFixture = {
    fixtureId: 'held_routing_operator_review_dashboard_fixture_v1',
    status: 'ok',
    mode: 'read_only',
    advisoryOnly: true,
    generatedAt: '2026-06-10T00:00:00.000Z',
    presentation,
    serializedPresentation: serializeHeldRoutingOperatorReviewPresentation(presentation),
    mutationAllowed: false,
    implementationAllowed: false,
    executionAllowed: false
  };

  return deepFreeze(fixture);
}
