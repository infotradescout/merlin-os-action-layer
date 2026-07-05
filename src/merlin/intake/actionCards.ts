import type { MealScoutEvidenceCluster } from '../../mealscoutEvidenceClustering.js';
import type { MealScoutProfileDraft } from '../../mealscoutProfileImport.js';

export type MerlinActionCardType =
  | 'create_profile_draft'
  | 'update_existing_profile'
  | 'claim_existing_profile'
  | 'request_missing_info'
  | 'defer_unclassified';

export type MerlinActionCard = {
  id: string;
  type: MerlinActionCardType;
  title: string;
  entityType: 'food_truck' | 'restaurant' | 'caterer_private_chef' | 'contractor_business' | 'unknown';
  confidence: number;
  sourceFileIds: string[];
  extractedFields: Record<string, unknown>;
  missingFields: string[];
  existingEntityMatch: {
    entityId: string;
    confidence: number;
    reason: string;
  } | null;
  duplicateWarnings?: string[];
  conflictWarnings?: string[];
  replacementCandidate?: {
    entityId: string;
    confidence: number;
    reason: string;
  } | null;
  extractionDebug?: {
    sourceTextSnippets: Array<{ sourceFileId: string; snippet: string }>;
    rawTextEvidence: Array<{ sourceFileId: string; rawSnippet: string }>;
  };
  recommendedAction: string;
  mutationAllowed: false;
};

function compact(values: Array<string | undefined>): string[] {
  return values.filter((value): value is string => Boolean(value && value.trim()));
}

function hasAdminOrDriveSource(draft: MealScoutProfileDraft): boolean {
  return draft.sourceFiles.some((file) => {
    const channel = file.sourceAttribution?.sourceChannel;
    return channel === 'admin_import' || channel === 'drive_upload' || Boolean(file.sourceAttribution?.intakeSubmittedBy);
  });
}

function hasStrongOperatorIdentityEvidence(draft: MealScoutProfileDraft): boolean {
  const hasNamedEntity = Boolean(draft.truckName && draft.truckName.trim());
  const hasContext =
    Boolean(draft.cityArea && draft.cityArea.trim()) ||
    Boolean(draft.cuisine && draft.cuisine.trim()) ||
    Boolean(draft.website && draft.website.trim()) ||
    Boolean(draft.socials.facebook && draft.socials.facebook.trim()) ||
    Boolean(draft.socials.instagram && draft.socials.instagram.trim());

  return hasNamedEntity && hasContext;
}

function buildCardMissingFields(draft: MealScoutProfileDraft): string[] {
  if (hasAdminOrDriveSource(draft) && hasStrongOperatorIdentityEvidence(draft)) {
    return draft.missingFields.filter((field) => field !== 'phone_or_email');
  }
  return [...draft.missingFields];
}

function buildExtractedFields(draft: MealScoutProfileDraft): Record<string, unknown> {
  const sourceTextSnippets = Array.from(
    new Set(
      Object.values(draft.extractedFieldEvidence || {})
        .flatMap((item) => (Array.isArray(item) ? item : [item]))
        .filter((item) => Boolean(item && typeof item === 'object'))
        .map((item) => {
          const row = item as { sourceFileId?: string; rawSnippet?: string };
          const snippet = (row.rawSnippet || '').trim();
          const sourceFileId = (row.sourceFileId || '').trim();
          return snippet && sourceFileId ? `${sourceFileId}::${snippet.slice(0, 180)}` : '';
        })
        .filter(Boolean)
    )
  ).map((row) => {
    const [sourceFileId, snippet] = row.split('::');
    return { sourceFileId, snippet };
  });
  const contactCandidates = [
    draft.extractedFieldEvidence.phone
      ? {
          type: 'phone',
          value: draft.extractedFieldEvidence.phone.value,
          sourceFileId: draft.extractedFieldEvidence.phone.sourceFileId
        }
      : null,
    draft.extractedFieldEvidence.email
      ? {
          type: 'email',
          value: draft.extractedFieldEvidence.email.value,
          sourceFileId: draft.extractedFieldEvidence.email.sourceFileId
        }
      : null
  ].filter(Boolean);

  return {
    truckName: draft.truckName,
    phone: draft.phone,
    email: draft.email,
    cityArea: draft.cityArea,
    cuisine: draft.cuisine,
    website: draft.website,
    socials: draft.socials,
    menuItems: draft.menu.map((item) => ({ name: item.name, price: item.price, description: item.description })),
    menuDeferred: draft.menuDeferred,
    contactCandidates,
    extractionDebug: {
      sourceTextSnippets,
      rawTextEvidence: sourceTextSnippets.map((item) => ({ sourceFileId: item.sourceFileId, rawSnippet: item.snippet }))
    }
  };
}

function detectCardType(draft: MealScoutProfileDraft): MerlinActionCardType {
  const missingFields = buildCardMissingFields(draft);
  const hasIdentity = Boolean(
    draft.truckName ||
      draft.phone ||
      draft.email ||
      draft.website ||
      draft.socials.facebook ||
      draft.socials.instagram
  );

  if (!hasIdentity) return 'defer_unclassified';
  if (draft.existingTruckId) return 'update_existing_profile';
  if (draft.draftType === 'uncertain_match' && draft.duplicateCandidates.length > 0) return 'claim_existing_profile';
  const missingOnlyMenu = missingFields.length > 0 && missingFields.every((field) => field === 'menu');
  const adminOrDriveSource = hasAdminOrDriveSource(draft);
  if (missingOnlyMenu && adminOrDriveSource) return 'create_profile_draft';
  if (missingFields.length > 0 || draft.reviewStatus === 'missing_required') return 'request_missing_info';
  return 'create_profile_draft';
}

function titleForType(type: MerlinActionCardType, truckName?: string): string {
  const name = truckName || 'Unresolved Upload';
  switch (type) {
    case 'create_profile_draft':
      return `Create profile draft for ${name}`;
    case 'update_existing_profile':
      return `Update existing profile for ${name}`;
    case 'claim_existing_profile':
      return `Claim existing profile for ${name}`;
    case 'request_missing_info':
      return `Request missing info for ${name}`;
    case 'defer_unclassified':
    default:
      return `Defer unclassified evidence for ${name}`;
  }
}

function recommendedActionForType(type: MerlinActionCardType): string {
  switch (type) {
    case 'create_profile_draft':
      return 'review_create_profile_draft';
    case 'update_existing_profile':
      return 'review_update_existing_profile';
    case 'claim_existing_profile':
      return 'review_claim_existing_profile';
    case 'request_missing_info':
      return 'collect_required_fields';
    case 'defer_unclassified':
    default:
      return 'hold_for_manual_review';
  }
}

export function buildMealScoutActionCards(params: {
  drafts: MealScoutProfileDraft[];
  clusters: MealScoutEvidenceCluster[];
}): MerlinActionCard[] {
  const { drafts, clusters } = params;
  const cards: MerlinActionCard[] = drafts.map((draft) => {
    const type = detectCardType(draft);
    const extractedFields = buildExtractedFields(draft);
    const missingFields = buildCardMissingFields(draft);
    const sourceFileIds = Array.from(new Set(draft.sourceFiles.map((file) => file.sourceFileId))).filter(Boolean);
    const existingEntityMatch = draft.existingTruckId
      ? {
          entityId: draft.existingTruckId,
          confidence: 0.95,
          reason: 'direct_existing_truck_match'
        }
      : draft.duplicateCandidates.length > 0
        ? {
            entityId: draft.duplicateCandidates[0].existingProfileId,
            confidence: draft.duplicateCandidates[0].confidence,
            reason: draft.duplicateCandidates[0].reason
          }
        : null;

    return {
      id: `action-card-${draft.draftId}`,
      type,
      title: titleForType(type, draft.truckName),
      entityType: 'food_truck',
      confidence: Number((draft.confidence || 0).toFixed(2)),
      sourceFileIds,
      extractedFields,
      missingFields,
      existingEntityMatch,
      duplicateWarnings: existingEntityMatch && type === 'create_profile_draft' ? ['possible_duplicate_existing_entity_match'] : [],
      conflictWarnings: [],
      replacementCandidate: existingEntityMatch
        ? {
            entityId: existingEntityMatch.entityId,
            confidence: existingEntityMatch.confidence,
            reason: existingEntityMatch.reason
          }
        : null,
      extractionDebug: (extractedFields.extractionDebug as MerlinActionCard['extractionDebug']) || {
        sourceTextSnippets: [],
        rawTextEvidence: []
      },
      recommendedAction: recommendedActionForType(type),
      mutationAllowed: false
    };
  });

  if (cards.length > 0) return cards;

  // If no draft was generated, surface defer cards for unresolved clusters.
  return clusters.map((cluster) => ({
    id: `action-card-${cluster.clusterId}`,
    type: 'defer_unclassified',
    title: titleForType('defer_unclassified', cluster.likelyTruckName),
    entityType: 'unknown',
    confidence: Number((cluster.confidence || 0).toFixed(2)),
    sourceFileIds: compact(cluster.files.map((file) => file.fileId)),
    extractedFields: {
      likelyTruckName: cluster.likelyTruckName,
      matchSignals: cluster.matchSignals,
      reviewStatus: cluster.reviewStatus
    },
    missingFields: ['identity'],
    existingEntityMatch: null,
    duplicateWarnings: [],
    conflictWarnings: [],
    replacementCandidate: null,
    recommendedAction: recommendedActionForType('defer_unclassified'),
    mutationAllowed: false
  }));
}
