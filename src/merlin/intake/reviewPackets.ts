import type { HeldRoutingReviewPacket, MerlinRoutingOperatorAction, RoutingDecision, UploadIntent } from './intakeTypes.js';

export const ROUTING_REVIEW_OPERATOR_ACTIONS: MerlinRoutingOperatorAction[] = [
  'approve_route',
  'change_destination',
  'request_more_info',
  'reject_upload',
  'defer'
];

const REVIEW_SIGNAL_REASONS = new Set([
  'menu_signal_detected',
  'schedule_signal_detected',
  'logo_signal_detected',
  'photo_signal_detected',
  'document_signal_detected',
  'competing_destination_signals',
  'no_destination_signal_detected',
  'low_base_confidence',
  'low_destination_confidence',
  'intent_destination_mismatch',
  'ambiguous_or_wrong_domain'
]);

function detectedEvidenceSignals(row: RoutingDecision): string[] {
  const signals = row.reasons.filter((reason) => REVIEW_SIGNAL_REASONS.has(reason) || reason.startsWith('expected_route_'));
  return signals.length > 0 ? signals : ['operator_review_required'];
}

export function buildHeldRoutingReviewPackets(intent: UploadIntent, routing: RoutingDecision[] = intent.routing): HeldRoutingReviewPacket[] {
  return routing
    .filter((row) => row.routedType === 'held')
    .map((row) => ({
      packetId: `merlin-routing-review:${intent.uploadId}:${row.fileId}`,
      uploadId: intent.uploadId,
      fileId: row.fileId,
      fileName: row.fileName,
      declaredIntent: {
        brand: intent.brand,
        actionId: intent.actionId,
        actorScope: intent.actorScope,
        entityType: intent.entityType,
        entityId: intent.entityId
      },
      detectedEvidenceSignals: detectedEvidenceSignals(row),
      proposedDestination: row.proposedDestination,
      holdReason: row.holdReason || 'ambiguous',
      confidence: {
        score: row.confidence,
        reasons: row.reasons
      },
      operatorActionOptions: [...ROUTING_REVIEW_OPERATOR_ACTIONS],
      mutationAllowed: false,
      implementationAllowed: false
    }));
}
