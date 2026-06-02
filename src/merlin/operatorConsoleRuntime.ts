import { listMerlinActionCards, type MerlinActionCardRecord } from './actionCardRuntime.js';
import { getMerlinEntityConflicts, getMerlinEntityById, listMerlinEntities, type MerlinEntityRecord } from './entityMemoryRuntime.js';
import { listMerlinIntakeItems, type MerlinIntakeItemRecord } from './intakeRuntime.js';
import { getMerlinKpiRollup, listMerlinOutcomes, type MerlinOutcomeRecord } from './outcomeRuntime.js';

export type MerlinOperatorConsoleFilters = {
  brand_lane?: string;
  entity_id?: string;
  limit?: number;
};

export type MerlinOperatorConsolePayload = {
  status: 'ok';
  mode: 'read_only';
  mutationAllowed: false;
  generatedAt: string;
  summary: {
    intakeOpenCount: number;
    intakeBlockedCount: number;
    entityConflictCount: number;
    actionCardPendingCount: number;
    actionCardBlockedCount: number;
    outcomeRecordedCount: number;
    verifiedOutcomeCount: number;
  };
  attention: {
    blockedIntake: MerlinIntakeItemRecord[];
    openEntityConflicts: Array<ReturnType<typeof getMerlinEntityConflicts>[number] & { entity?: MerlinEntityRecord }>;
    approvalRequiredActionCards: MerlinActionCardRecord[];
    blockedActionCards: MerlinActionCardRecord[];
    needsMoreDataOutcomes: MerlinOutcomeRecord[];
  };
  kpiRollups: ReturnType<typeof getMerlinKpiRollup>;
  recent: {
    intake: MerlinIntakeItemRecord[];
    entities: MerlinEntityRecord[];
    actionCards: MerlinActionCardRecord[];
    outcomes: MerlinOutcomeRecord[];
  };
};

function clampLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit || NaN)) return 25;
  return Math.max(1, Math.min(100, Math.floor(limit as number)));
}

function matchesEntity<T extends { entity_id?: string }>(row: T, entityId?: string): boolean {
  return !entityId || row.entity_id === entityId;
}

export function getMerlinOperatorConsolePayload(filters: MerlinOperatorConsoleFilters = {}): MerlinOperatorConsolePayload {
  const limit = clampLimit(filters.limit);
  const brand = filters.brand_lane?.trim().toLowerCase();
  const entityId = filters.entity_id?.trim();

  const intake = listMerlinIntakeItems({ brand_lane: brand, limit: 100 }).filter((row) => !entityId || row.resolved_entity_id === entityId);
  const entities = entityId
    ? [getMerlinEntityById(entityId)].filter((row): row is MerlinEntityRecord => Boolean(row))
    : listMerlinEntities({ brand_lane: brand, limit: 100 });
  const actionCards = listMerlinActionCards({ brand, limit: 100 }).filter((row) => matchesEntity(row, entityId));
  const outcomes = listMerlinOutcomes({ brand_lane: brand, limit: 100 }).filter((row) => matchesEntity(row, entityId));

  const openEntityConflicts = entities.flatMap((entity) =>
    getMerlinEntityConflicts(entity.id)
      .filter((conflict) => conflict.status === 'open')
      .map((conflict) => ({ ...conflict, entity }))
  );
  const blockedIntake = intake.filter((row) => row.status === 'blocked');
  const approvalRequiredActionCards = actionCards.filter((row) => row.policy_result.requires_approval);
  const blockedActionCards = actionCards.filter((row) => row.status === 'blocked' || row.policy_result.blocked);
  const needsMoreDataOutcomes = outcomes.filter((row) => row.outcome_type === 'needs_more_data');

  const visibleIntake = intake.slice(0, limit);
  const visibleEntities = entities.slice(0, limit);
  const visibleActionCards = actionCards.slice(0, limit);
  const visibleOutcomes = outcomes.slice(0, limit);

  return {
    status: 'ok',
    mode: 'read_only',
    mutationAllowed: false,
    generatedAt: new Date().toISOString(),
    summary: {
      intakeOpenCount: intake.filter((row) => ['received', 'classified', 'needs_more_data'].includes(row.status)).length,
      intakeBlockedCount: blockedIntake.length,
      entityConflictCount: openEntityConflicts.length,
      actionCardPendingCount: actionCards.filter((row) => ['suggested', 'action_card_generated', 'approved'].includes(row.status)).length,
      actionCardBlockedCount: blockedActionCards.length,
      outcomeRecordedCount: outcomes.filter((row) => row.status === 'recorded').length,
      verifiedOutcomeCount: outcomes.filter((row) => row.status === 'verified').length
    },
    attention: {
      blockedIntake: blockedIntake.slice(0, limit),
      openEntityConflicts: openEntityConflicts.slice(0, limit),
      approvalRequiredActionCards: approvalRequiredActionCards.slice(0, limit),
      blockedActionCards: blockedActionCards.slice(0, limit),
      needsMoreDataOutcomes: needsMoreDataOutcomes.slice(0, limit)
    },
    kpiRollups: getMerlinKpiRollup({ brand_lane: brand }).slice(0, limit),
    recent: {
      intake: visibleIntake,
      entities: visibleEntities,
      actionCards: visibleActionCards,
      outcomes: visibleOutcomes
    }
  };
}
