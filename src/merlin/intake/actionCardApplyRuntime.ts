export type MealScoutApplyEntity = {
  entityId: string;
  entityType: 'food_truck' | 'restaurant' | 'caterer_private_chef';
  fields: Record<string, unknown>;
  sourceFileIds: string[];
  updatedAt: string;
};

const entities = new Map<string, MealScoutApplyEntity>();

function nowIso(): string {
  return new Date().toISOString();
}

export function createApplyEntity(input: {
  entityId: string;
  entityType: 'food_truck' | 'restaurant' | 'caterer_private_chef';
  fields: Record<string, unknown>;
  sourceFileIds: string[];
}): MealScoutApplyEntity {
  const row: MealScoutApplyEntity = {
    entityId: input.entityId,
    entityType: input.entityType,
    fields: { ...input.fields },
    sourceFileIds: Array.from(new Set(input.sourceFileIds)),
    updatedAt: nowIso()
  };
  entities.set(row.entityId, row);
  return row;
}

export function getApplyEntity(entityId: string): MealScoutApplyEntity | undefined {
  return entities.get(entityId);
}

export function updateApplyEntity(input: {
  entityId: string;
  patch: Array<{ field: string; before: unknown; after: unknown }>;
  sourceFileIds: string[];
}): { entity: MealScoutApplyEntity; fieldDiff: Array<{ field: string; before: unknown; after: unknown }> } {
  const existing = entities.get(input.entityId);
  if (!existing) {
    throw new Error('stale_before_state_conflict');
  }
  const fields = { ...existing.fields };
  const fieldDiff: Array<{ field: string; before: unknown; after: unknown }> = [];
  for (const row of input.patch) {
    const before = fields[row.field];
    if (before !== row.before) {
      throw new Error('stale_before_state_conflict');
    }
    // Never overwrite non-empty value with empty
    const emptyAfter = row.after === '' || row.after === null || row.after === undefined || (Array.isArray(row.after) && row.after.length === 0);
    const nonEmptyBefore = !(before === '' || before === null || before === undefined || (Array.isArray(before) && before.length === 0));
    if (emptyAfter && nonEmptyBefore) continue;
    fields[row.field] = row.after;
    fieldDiff.push({ field: row.field, before, after: row.after });
  }
  const updated: MealScoutApplyEntity = {
    ...existing,
    fields,
    sourceFileIds: Array.from(new Set([...existing.sourceFileIds, ...input.sourceFileIds])),
    updatedAt: nowIso()
  };
  entities.set(input.entityId, updated);
  return { entity: updated, fieldDiff };
}

export function resetActionCardApplyRuntimeForTest(): void {
  entities.clear();
}
