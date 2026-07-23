import { randomUUID } from 'node:crypto';
import type {
  MealScoutAccountIntakeDetectedChange,
  PreviewPacket,
  RoutingDecision,
  UploadIntent
} from './intakeTypes.js';
import type { MerlinUniversalProductUpdatePacketPreview } from './universalProductUpdatePacketPreview.js';
import { buildUniversalProductUpdatePacketPreviewBridge } from './universalProductUpdatePacketPreviewBridge.js';

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

function buildAccountIntakeDetectedChange(
  preview: MerlinUniversalProductUpdatePacketPreview | undefined
): MealScoutAccountIntakeDetectedChange | undefined {
  if (!preview || preview.status !== 'supported' || preview.updateType !== 'account_intake') {
    return undefined;
  }

  const accountIntake = (preview.extractedStructuredData as { accountIntake?: Record<string, unknown> }).accountIntake;
  if (!accountIntake || typeof accountIntake.businessName !== 'string' || typeof accountIntake.accountType !== 'string') {
    return undefined;
  }

  const contactSummary = [
    typeof accountIntake.phone === 'string' ? `phone: ${accountIntake.phone}` : undefined,
    typeof accountIntake.email === 'string' ? `email: ${accountIntake.email}` : undefined,
    typeof accountIntake.website === 'string' ? `website: ${accountIntake.website}` : undefined
  ].filter((value): value is string => typeof value === 'string');
  const locationSummary = [
    typeof accountIntake.address === 'string' ? accountIntake.address : undefined,
    typeof accountIntake.city === 'string' ? accountIntake.city : undefined,
    typeof accountIntake.state === 'string' ? accountIntake.state : undefined,
    typeof accountIntake.postalCode === 'string' ? accountIntake.postalCode : undefined,
    typeof accountIntake.serviceArea === 'string' ? `service area: ${accountIntake.serviceArea}` : undefined
  ].filter((value): value is string => typeof value === 'string');

  return {
    kind: 'account_intake',
    businessName: accountIntake.businessName,
    accountType: accountIntake.accountType as MealScoutAccountIntakeDetectedChange['accountType'],
    contactSummary,
    locationSummary,
    sourceEvidenceReferences: preview.sourceEvidenceReferences.map((reference) => reference.sourceReference),
    sourceFolderReference: preview.sourceFolderReference,
    missingFields: [...preview.missingFields],
    requiredNextStep: typeof accountIntake.requiredNextStep === 'string'
      ? accountIntake.requiredNextStep
      : 'operator review required',
    safetyFlags: [...preview.safetyFlags],
    ownerSubmittedEquivalent: preview.ownerSubmittedEquivalent,
    reviewMode: 'read_only',
    productionApplied: false,
    mutationAllowed: false,
    implementationAllowed: false,
    applyEligible: false
  };
}

export function buildPreviewPacket(intent: UploadIntent, routing: RoutingDecision[], linkedEvidenceIds: string[] = []): PreviewPacket {
  const held = routing.filter((row) => row.routedType === 'held');
  const actionable = routing.filter((row) => row.routedType !== 'held');
  const confidence = actionable.length > 0
    ? Number((actionable.reduce((sum, row) => sum + row.confidence, 0) / actionable.length).toFixed(2))
    : 0;
  const universalProductUpdatePacketPreview = buildUniversalProductUpdatePacketPreviewBridge({
    brand: intent.brand,
    files: intent.files
  });
  const detectedChanges = intent.brand === 'MEALSCOUT' ? buildMealScoutDetectedChanges(intent, actionable) : {};
  const accountIntakeDetectedChange = buildAccountIntakeDetectedChange(universalProductUpdatePacketPreview);
  if (accountIntakeDetectedChange) {
    detectedChanges.accountIntake = accountIntakeDetectedChange;
  }
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
    universalProductUpdatePacketPreview,
    mutationAllowed: false,
    implementationAllowed: false
  };
}
