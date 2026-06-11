import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHeldRoutingOperatorReviewDashboardFixture } from '../intake/operatorReviewPresentationFixture.js';

const AUTHORITY_REFERENCE = 'docs/merlin/MERLIN_OPERATOR_REVIEW_PRESENTATION_CLOSEOUT.md';

function responseJson(res: ServerResponse, payload: unknown, status = 200): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

export async function handleMerlinOperatorReviewPresentationRoute(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string
): Promise<boolean> {
  const method = (req.method || 'GET').toUpperCase();
  if (method !== 'GET') return false;

  if (pathname !== '/api/merlin/operator-review/presentation') {
    return false;
  }

  const fixture = createHeldRoutingOperatorReviewDashboardFixture();
  const parsedPresentation = JSON.parse(fixture.serializedPresentation) as {
    decisionLedgerPreview?: unknown;
    approvalGatePreview?: unknown;
  };

  responseJson(res, {
    status: 'ok',
    mode: 'read_only',
    advisoryOnly: true,
    authorityReference: AUTHORITY_REFERENCE,
    generatedAt: fixture.generatedAt,
    serializedPresentation: fixture.serializedPresentation,
    decisionLedgerPreview: parsedPresentation.decisionLedgerPreview,
    approvalGatePreview: parsedPresentation.approvalGatePreview,
    mutationAllowed: false,
    implementationAllowed: false,
    executionAllowed: false
  });

  return true;
}
