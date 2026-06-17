import { createHash } from 'node:crypto';
import type { MerlinActorScope } from './intakeTypes.js';

export type MerlinTargetProduct =
  | 'MealScout'
  | 'TradeScout'
  | 'Sway'
  | 'HomeID'
  | 'CodeScout'
  | 'AutoBott';

export type MerlinUniversalUpdateType =
  | 'menu_update'
  | 'schedule_update'
  | 'logo_update'
  | 'cover_update'
  | 'social_link_update'
  | 'profile_correction'
  | 'business_profile_update'
  | 'community_update'
  | 'direct_connect_context_update'
  | 'service_area_update'
  | 'proof_update'
  | 'venue_profile_update'
  | 'request_configuration_evidence'
  | 'gig_event_metadata_update'
  | 'home_record_evidence'
  | 'completed_work_evidence'
  | 'contractor_proof_attachment'
  | 'municipal_evidence_packet'
  | 'permit_requirement_update'
  | 'ahj_clarification_evidence'
  | 'market_snapshot_evidence'
  | 'validation_record'
  | 'risk_control_update';

export type MerlinTargetResolutionStatus =
  | 'resolved_exact_target_id'
  | 'resolved_name_only'
  | 'ambiguous_target'
  | 'unknown_target';

export type MerlinRequiredVerificationStep =
  | 'no_fake_prices'
  | 'no_fake_schedules'
  | 'preview_before_apply'
  | 'exact_target_id_required_for_production_apply'
  | 'fail_closed_on_ambiguous_target'
  | 'owner_or_operator_must_verify_missing_prices'
  | 'recurring_schedule_must_be_explicit'
  | 'preserve_source_evidence';

export type MerlinPacketSourceActor = {
  actorScope: MerlinActorScope;
  actorId?: string;
  actorLabel?: string;
};

export type MerlinPacketEvidenceReference = {
  sourceFileName: string;
  sourceMimeType: string;
  sourceReference: string;
  sourcePage?: number;
};

export type MealScoutMenuItemOption = {
  name: string;
  price?: string;
  pricesMissing: boolean;
};

export type MealScoutMenuItemPayload = {
  name: string;
  description?: string;
  options: MealScoutMenuItemOption[];
  price?: string;
  pricesMissing: boolean;
  availabilityNotes?: string[];
  sourcePage?: number;
  sourceFileName: string;
};

export type MealScoutMenuSectionPayload = {
  sectionName: string;
  items: MealScoutMenuItemPayload[];
};

export type MealScoutMenuUpdatePayload = {
  packetSubtype: 'MealScoutOwnerProfileUpdatePacket';
  updateType: 'menu_update';
  sections: MealScoutMenuSectionPayload[];
  pricesMissing: boolean;
  availabilityNotes: string[];
  sourceEvidence: MerlinPacketEvidenceReference[];
};

export type MealScoutScheduleUpdatePayload = {
  packetSubtype: 'MealScoutOwnerProfileUpdatePacket';
  updateType: 'schedule_update';
  entries: Array<{
    date?: string;
    startTime?: string;
    endTime?: string;
    timezone?: string;
    locationName?: string;
    address?: string;
    closed?: boolean;
    recurrence: 'recurring' | 'current_week_only' | 'unknown';
    mapEligible: boolean;
    liveFeedEligible: boolean;
    sourceEvidence: MerlinPacketEvidenceReference[];
  }>;
};

export type MealScoutAssetUpdatePayload = {
  packetSubtype: 'MealScoutOwnerProfileUpdatePacket';
  updateType: 'logo_update' | 'cover_update';
  sourceEvidence: MerlinPacketEvidenceReference[];
};

export type MealScoutSocialLinkUpdatePayload = {
  packetSubtype: 'MealScoutOwnerProfileUpdatePacket';
  updateType: 'social_link_update';
  socialLinks: Record<string, string>;
  sourceEvidence: MerlinPacketEvidenceReference[];
};

export type MealScoutProfileCorrectionPayload = {
  packetSubtype: 'MealScoutOwnerProfileUpdatePacket';
  updateType: 'profile_correction';
  correctedFields: Record<string, string>;
  sourceEvidence: MerlinPacketEvidenceReference[];
};

export type MerlinMealScoutProductSpecificPayload =
  | MealScoutMenuUpdatePayload
  | MealScoutScheduleUpdatePayload
  | MealScoutAssetUpdatePayload
  | MealScoutSocialLinkUpdatePayload
  | MealScoutProfileCorrectionPayload;

export type MerlinUniversalProductUpdatePacket = {
  packetId: string;
  sourceActor: MerlinPacketSourceActor;
  targetProduct: MerlinTargetProduct;
  targetEntityName: string;
  targetEntityId: string | null;
  targetResolutionStatus: MerlinTargetResolutionStatus;
  updateType: MerlinUniversalUpdateType;
  evidenceReferences: MerlinPacketEvidenceReference[];
  extractedStructuredData: Record<string, unknown>;
  missingFields: string[];
  confidence: number;
  safetyFlags: string[];
  ownerSubmittedEquivalent: boolean;
  productionApplied: false;
  mutationAllowed: false;
  implementationAllowed: false;
  applyEligible: false;
  requiredVerificationSteps: MerlinRequiredVerificationStep[];
  productSpecificPayload: MerlinMealScoutProductSpecificPayload;
};

export type CreateUniversalProductUpdatePacketInput = {
  sourceActor: MerlinPacketSourceActor;
  targetProduct: 'MealScout';
  targetBusinessName: string;
  targetProfileId?: string;
  targetResolutionStatus?: MerlinTargetResolutionStatus;
  updateType: MerlinMealScoutProductSpecificPayload['updateType'];
  evidenceReferences: MerlinPacketEvidenceReference[];
  confidence?: number;
  menuSections?: Array<{
    sectionName: string;
    items: Array<{
      name: string;
      description?: string;
      options?: Array<{ name: string; price?: string }>;
      price?: string;
      availabilityNotes?: string[];
      sourcePage?: number;
      sourceFileName?: string;
    }>;
  }>;
  scheduleEntries?: MealScoutScheduleUpdatePayload['entries'];
  socialLinks?: Record<string, string>;
  correctedFields?: Record<string, string>;
};

function stablePacketId(input: {
  targetProduct: MerlinTargetProduct;
  targetBusinessName: string;
  targetProfileId?: string;
  updateType: MerlinUniversalUpdateType;
  evidenceReferences: MerlinPacketEvidenceReference[];
}): string {
  const digest = createHash('sha1')
    .update(
      JSON.stringify({
        targetProduct: input.targetProduct,
        targetBusinessName: input.targetBusinessName,
        targetProfileId: input.targetProfileId || null,
        updateType: input.updateType,
        evidenceReferences: input.evidenceReferences
      })
    )
    .digest('hex')
    .slice(0, 16);
  return `merlin-universal-product-update:${digest}`;
}

function normalizeConfidence(value: number | undefined): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0.5;
  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}

function ownerSubmittedEquivalent(actorScope: MerlinActorScope): boolean {
  return actorScope === 'owner' || actorScope === 'homeowner' || actorScope === 'contractor' || actorScope === 'rep';
}

function normalizeTargetResolutionStatus(input: CreateUniversalProductUpdatePacketInput): MerlinTargetResolutionStatus {
  if (input.targetResolutionStatus) return input.targetResolutionStatus;
  if (input.targetProfileId) return 'resolved_exact_target_id';
  if (input.targetBusinessName.trim()) return 'resolved_name_only';
  return 'unknown_target';
}

function buildMenuPayload(input: CreateUniversalProductUpdatePacketInput): {
  extractedStructuredData: Record<string, unknown>;
  missingFields: string[];
  safetyFlags: string[];
  requiredVerificationSteps: MerlinRequiredVerificationStep[];
  productSpecificPayload: MealScoutMenuUpdatePayload;
} {
  const evidence = input.evidenceReferences;
  const sections = (input.menuSections || []).map((section) => ({
    sectionName: section.sectionName,
    items: section.items.map((item) => {
      const options = (item.options || []).map((option) => ({
        name: option.name,
        price: option.price,
        pricesMissing: !option.price
      }));
      return {
        name: item.name,
        description: item.description,
        options,
        price: item.price,
        pricesMissing: !item.price,
        availabilityNotes: item.availabilityNotes || [],
        sourcePage: item.sourcePage,
        sourceFileName: item.sourceFileName || evidence[0]?.sourceFileName || 'unknown-source'
      };
    })
  }));

  const anyItemMissingPrice = sections.some((section) => section.items.some((item) => item.pricesMissing));
  const missingFields = anyItemMissingPrice ? ['menu.items.price'] : [];
  const safetyFlags = ['preserve_source_evidence'];
  if (anyItemMissingPrice) {
    safetyFlags.push('missing_menu_prices');
  }

  const requiredVerificationSteps: MerlinRequiredVerificationStep[] = [
    'no_fake_prices',
    'preview_before_apply',
    'exact_target_id_required_for_production_apply',
    'preserve_source_evidence'
  ];

  if (anyItemMissingPrice) {
    requiredVerificationSteps.push('owner_or_operator_must_verify_missing_prices');
  }

  return {
    extractedStructuredData: {
      menu: {
        sections,
        pricesMissing: anyItemMissingPrice
      }
    },
    missingFields,
    safetyFlags,
    requiredVerificationSteps,
    productSpecificPayload: {
      packetSubtype: 'MealScoutOwnerProfileUpdatePacket',
      updateType: 'menu_update',
      sections,
      pricesMissing: anyItemMissingPrice,
      availabilityNotes: Array.from(
        new Set(
          sections.flatMap((section) => section.items.flatMap((item) => item.availabilityNotes || []))
        )
      ),
      sourceEvidence: evidence
    }
  };
}

function buildMealScoutPayload(input: CreateUniversalProductUpdatePacketInput): {
  extractedStructuredData: Record<string, unknown>;
  missingFields: string[];
  safetyFlags: string[];
  requiredVerificationSteps: MerlinRequiredVerificationStep[];
  productSpecificPayload: MerlinMealScoutProductSpecificPayload;
} {
  if (input.updateType === 'menu_update') {
    return buildMenuPayload(input);
  }

  if (input.updateType === 'schedule_update') {
    return {
      extractedStructuredData: { schedule: input.scheduleEntries || [] },
      missingFields: [],
      safetyFlags: ['preserve_source_evidence'],
      requiredVerificationSteps: [
        'no_fake_schedules',
        'preview_before_apply',
        'exact_target_id_required_for_production_apply',
        'recurring_schedule_must_be_explicit',
        'preserve_source_evidence'
      ],
      productSpecificPayload: {
        packetSubtype: 'MealScoutOwnerProfileUpdatePacket',
        updateType: 'schedule_update',
        entries: input.scheduleEntries || []
      }
    };
  }

  if (input.updateType === 'logo_update' || input.updateType === 'cover_update') {
    return {
      extractedStructuredData: { assetEvidence: input.evidenceReferences },
      missingFields: [],
      safetyFlags: ['preserve_source_evidence'],
      requiredVerificationSteps: [
        'preview_before_apply',
        'exact_target_id_required_for_production_apply',
        'preserve_source_evidence'
      ],
      productSpecificPayload: {
        packetSubtype: 'MealScoutOwnerProfileUpdatePacket',
        updateType: input.updateType,
        sourceEvidence: input.evidenceReferences
      }
    };
  }

  if (input.updateType === 'social_link_update') {
    return {
      extractedStructuredData: { socialLinks: input.socialLinks || {} },
      missingFields: [],
      safetyFlags: ['preserve_source_evidence'],
      requiredVerificationSteps: [
        'preview_before_apply',
        'exact_target_id_required_for_production_apply',
        'preserve_source_evidence'
      ],
      productSpecificPayload: {
        packetSubtype: 'MealScoutOwnerProfileUpdatePacket',
        updateType: 'social_link_update',
        socialLinks: input.socialLinks || {},
        sourceEvidence: input.evidenceReferences
      }
    };
  }

  return {
    extractedStructuredData: { correctedFields: input.correctedFields || {} },
    missingFields: [],
    safetyFlags: ['preserve_source_evidence'],
    requiredVerificationSteps: [
      'preview_before_apply',
      'exact_target_id_required_for_production_apply',
      'preserve_source_evidence'
    ],
    productSpecificPayload: {
      packetSubtype: 'MealScoutOwnerProfileUpdatePacket',
      updateType: 'profile_correction',
      correctedFields: input.correctedFields || {},
      sourceEvidence: input.evidenceReferences
    }
  };
}

export function createUniversalProductUpdatePacket(
  input: CreateUniversalProductUpdatePacketInput
): MerlinUniversalProductUpdatePacket {
  const targetResolutionStatus = normalizeTargetResolutionStatus(input);
  const mealScoutPayload = buildMealScoutPayload(input);
  const safetyFlags = [...mealScoutPayload.safetyFlags];
  const requiredVerificationSteps = [...mealScoutPayload.requiredVerificationSteps];

  if (targetResolutionStatus !== 'resolved_exact_target_id') {
    if (!requiredVerificationSteps.includes('exact_target_id_required_for_production_apply')) {
      requiredVerificationSteps.push('exact_target_id_required_for_production_apply');
    }
  }
  if (targetResolutionStatus === 'ambiguous_target') {
    safetyFlags.push('ambiguous_target');
    if (!requiredVerificationSteps.includes('fail_closed_on_ambiguous_target')) {
      requiredVerificationSteps.push('fail_closed_on_ambiguous_target');
    }
  }

  return {
    packetId: stablePacketId({
      targetProduct: input.targetProduct,
      targetBusinessName: input.targetBusinessName,
      targetProfileId: input.targetProfileId,
      updateType: input.updateType,
      evidenceReferences: input.evidenceReferences
    }),
    sourceActor: input.sourceActor,
    targetProduct: input.targetProduct,
    targetEntityName: input.targetBusinessName,
    targetEntityId: input.targetProfileId || null,
    targetResolutionStatus,
    updateType: input.updateType,
    evidenceReferences: input.evidenceReferences,
    extractedStructuredData: mealScoutPayload.extractedStructuredData,
    missingFields: mealScoutPayload.missingFields,
    confidence: normalizeConfidence(input.confidence),
    safetyFlags,
    ownerSubmittedEquivalent: ownerSubmittedEquivalent(input.sourceActor.actorScope),
    productionApplied: false,
    mutationAllowed: false,
    implementationAllowed: false,
    applyEligible: false,
    requiredVerificationSteps,
    productSpecificPayload: mealScoutPayload.productSpecificPayload
  };
}
