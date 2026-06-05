import { randomUUID } from 'node:crypto';
import type { PreviewPacket, RoutingDecision, UploadIntent } from './intakeTypes.js';

function buildMealScoutDetectedChanges(intent: UploadIntent, actionable: RoutingDecision[]): Record<string, unknown> {
  const changes: Record<string, unknown> = {};
  if (actionable.some((row) => row.routedType === 'menu')) {
    changes.menuUpdate = {
      evidenceFileIds: actionable.filter((row) => row.routedType === 'menu').map((row) => row.fileId),
      extractedPreview: actionable
        .filter((row) => row.routedType === 'menu')
        .map((row) => ({ fileId: row.fileId, textPreview: (row.extractedText || '').slice(0, 220) }))
    };
  }
  if (actionable.some((row) => row.routedType === 'schedule')) {
    changes.scheduleUpdate = {
      evidenceFileIds: actionable.filter((row) => row.routedType === 'schedule').map((row) => row.fileId),
      extractedPreview: actionable
        .filter((row) => row.routedType === 'schedule')
        .map((row) => ({ fileId: row.fileId, textPreview: (row.extractedText || '').slice(0, 220) }))
    };
  }
  if (actionable.some((row) => row.routedType === 'logo')) {
    changes.logoCandidates = actionable.filter((row) => row.routedType === 'logo').map((row) => row.fileId);
  }
  if (actionable.some((row) => row.routedType === 'photo')) {
    changes.photoCandidates = actionable.filter((row) => row.routedType === 'photo').map((row) => row.fileId);
  }
  return changes;
}

export function buildPreviewPacket(intent: UploadIntent, routing: RoutingDecision[], linkedEvidenceIds: string[] = []): PreviewPacket {
  const held = routing.filter((row) => row.routedType === 'held');
  const actionable = routing.filter((row) => row.routedType !== 'held');
  const confidence = actionable.length > 0
    ? Number((actionable.reduce((sum, row) => sum + row.confidence, 0) / actionable.length).toFixed(2))
    : 0;
  const detectedChanges = intent.brand === 'MEALSCOUT' ? buildMealScoutDetectedChanges(intent, actionable) : {};
  return {
    draftId: `merlin-preview-${randomUUID()}`,
    uploadId: intent.uploadId,
    brand: intent.brand,
    actionId: intent.actionId,
    detectedChanges,
    sourceFiles: routing.map((row) => ({ fileId: row.fileId, fileName: row.fileName })),
    linkedEvidenceIds,
    confidence,
    fieldsNeedingConfirmation: held.map((row) => row.fileName || row.fileId),
    allowedFieldsApplied: intent.actionSnapshot.allowedFieldPaths,
    forbiddenFieldsIgnored: intent.actionSnapshot.forbiddenFieldPaths,
    holdReasons: held.map((row) => row.holdReason || 'ambiguous'),
    mutationAllowed: false,
    implementationAllowed: false
  };
}
