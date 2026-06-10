import type {
  HeldRoutingDecisionStatus,
  HeldRoutingOperatorDecision,
  HeldRoutingReviewPacket,
  MerlinRoutedDestination,
  MerlinRoutingOperatorAction,
  RoutingDecision,
  UploadIntent
} from './intakeTypes.js';

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

const ROUTED_DESTINATIONS = new Set<MerlinRoutedDestination>(['menu', 'schedule', 'logo', 'photo', 'document']);

type HeldRoutingOperatorDecisionInput = {
  action: string;
  operatorId?: string;
  note?: string;
  selectedDestination?: string;
};

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

function normalizeOperatorId(operatorId?: string): string {
  return operatorId?.trim() || 'operator-fixture';
}

function normalizeNote(note?: string): string {
  return note?.trim() || 'operator_resolution_recorded';
}

function isOperatorAction(action: string): action is MerlinRoutingOperatorAction {
  return ROUTING_REVIEW_OPERATOR_ACTIONS.includes(action as MerlinRoutingOperatorAction);
}

function isRoutedDestination(destination: string | undefined): destination is MerlinRoutedDestination {
  return typeof destination === 'string' && ROUTED_DESTINATIONS.has(destination as MerlinRoutedDestination);
}

function decisionIdFor(input: {
  packetId: string;
  action: string;
  operatorId: string;
  resolvedDestination?: string;
}): string {
  return [
    'merlin-routing-decision',
    input.packetId,
    input.action,
    input.operatorId,
    input.resolvedDestination || 'none'
  ].join(':');
}

function decision(input: {
  packet: HeldRoutingReviewPacket;
  action: MerlinRoutingOperatorAction | 'invalid_action';
  operatorId: string;
  note: string;
  resultingStatus: HeldRoutingDecisionStatus;
  resolvedDestination?: MerlinRoutedDestination;
  stillRequiresApply: boolean;
}): HeldRoutingOperatorDecision {
  return {
    decisionId: decisionIdFor({
      packetId: input.packet.packetId,
      action: input.action,
      operatorId: input.operatorId,
      resolvedDestination: input.resolvedDestination
    }),
    packetId: input.packet.packetId,
    action: input.action,
    operatorId: input.operatorId,
    note: input.note,
    resultingStatus: input.resultingStatus,
    resolvedDestination: input.resolvedDestination,
    stillRequiresApply: input.stillRequiresApply,
    mutationAllowed: false,
    implementationAllowed: false
  };
}

export function applyHeldRoutingOperatorDecision(
  packet: HeldRoutingReviewPacket,
  input: HeldRoutingOperatorDecisionInput
): HeldRoutingOperatorDecision {
  const operatorId = normalizeOperatorId(input.operatorId);
  const note = normalizeNote(input.note);

  if (!isOperatorAction(input.action)) {
    return decision({
      packet,
      action: 'invalid_action',
      operatorId,
      note,
      resultingStatus: 'invalid_action',
      stillRequiresApply: false
    });
  }

  if (input.action === 'approve_route') {
    if (!packet.proposedDestination) {
      return decision({
        packet,
        action: 'invalid_action',
        operatorId,
        note: 'approve_route_requires_proposed_destination',
        resultingStatus: 'invalid_action',
        stillRequiresApply: false
      });
    }
    return decision({
      packet,
      action: input.action,
      operatorId,
      note,
      resultingStatus: 'approved_for_apply',
      resolvedDestination: packet.proposedDestination,
      stillRequiresApply: true
    });
  }

  if (input.action === 'change_destination') {
    if (!isRoutedDestination(input.selectedDestination)) {
      return decision({
        packet,
        action: 'invalid_action',
        operatorId,
        note: 'change_destination_requires_valid_destination',
        resultingStatus: 'invalid_action',
        stillRequiresApply: false
      });
    }
    return decision({
      packet,
      action: input.action,
      operatorId,
      note,
      resultingStatus: 'destination_changed_for_apply',
      resolvedDestination: input.selectedDestination,
      stillRequiresApply: true
    });
  }

  if (input.action === 'request_more_info') {
    return decision({
      packet,
      action: input.action,
      operatorId,
      note,
      resultingStatus: 'pending_more_info',
      stillRequiresApply: false
    });
  }

  if (input.action === 'reject_upload') {
    return decision({
      packet,
      action: input.action,
      operatorId,
      note,
      resultingStatus: 'rejected',
      stillRequiresApply: false
    });
  }

  return decision({
    packet,
    action: input.action,
    operatorId,
    note,
    resultingStatus: 'deferred',
    stillRequiresApply: false
  });
}
