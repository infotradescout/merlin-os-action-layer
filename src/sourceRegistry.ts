type SourceType = 'drive' | 'gmail' | 'calendar' | 'stripe' | 'canva' | 'github' | 'web' | 'app' | 'manual';

export interface SourceRecord {
  id: string;
  name: string;
  type: SourceType;
  trustLevel: number;
  active: boolean;
  aliases: string[];
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

interface SourceSeed {
  id: string;
  name: string;
  type?: SourceType;
  trustLevel?: number;
  active?: boolean;
  aliases?: string[];
  notes?: string;
}

export interface SourceResolutionInput {
  sourceReference?: string;
  originSurface?: string;
  entityId?: string;
}

export interface ResolvedSource {
  id: string;
  name: string;
  type: SourceType;
  trustLevel: number;
  active: boolean;
  reference: string;
}

const DEFAULT_SOURCE_REGISTRY: SourceSeed[] = [
  {
    id: 'tradescout',
    name: 'TradeScout',
    type: 'app',
    trustLevel: 1,
    active: true,
    aliases: ['tradescout', 'trade-scout', 'ts']
  },
  {
    id: 'mealscout',
    name: 'MealScout',
    type: 'app',
    trustLevel: 0.95,
    active: false,
    aliases: ['mealscout', 'meal-scout', 'ms']
  }
];

const registryById = new Map<string, SourceRecord>();
const aliasIndex = new Map<string, string>();

function normalizeSourceId(value: string): string {
  return value.trim().toLowerCase();
}

function buildTimestamp(): string {
  return new Date().toISOString();
}

function normalizeAliases(sourceId: string, aliases: string[] = []): string[] {
  return Array.from(new Set([sourceId, ...aliases].map((alias) => normalizeSourceId(alias)))).filter(Boolean);
}

function seedRegistry(seed: SourceSeed): SourceRecord {
  const id = normalizeSourceId(seed.id);
  return {
    id,
    name: seed.name,
    type: seed.type || 'app',
    trustLevel: seed.trustLevel ?? 1,
    active: seed.active ?? true,
    aliases: normalizeAliases(id, seed.aliases),
    notes: seed.notes,
    createdAt: buildTimestamp(),
    updatedAt: buildTimestamp()
  };
}

function indexSource(record: SourceRecord): void {
  registryById.set(record.id, record);
  for (const alias of record.aliases) {
    aliasIndex.set(alias, record.id);
  }
}

function parseReferenceSurface(reference?: string): string | null {
  if (!reference || !reference.trim()) return null;
  const trimmed = reference.trim();
  const colonIndex = trimmed.indexOf(':');
  if (colonIndex > 0) return normalizeSourceId(trimmed.substring(0, colonIndex));
  return null;
}

export function initializeSourceRegistry(): void {
  if (registryById.size > 0 && aliasIndex.size > 0) {
    return;
  }
  for (const seed of DEFAULT_SOURCE_REGISTRY) {
    const record = seedRegistry(seed);
    indexSource(record);
  }
}

export function resetSourceRegistryForTest(): void {
  registryById.clear();
  aliasIndex.clear();
  initializeSourceRegistry();
}

export function getSource(sourceId: string): SourceRecord | undefined {
  return registryById.get(normalizeSourceId(sourceId));
}

export function registerSource(seed: SourceSeed): SourceRecord {
  const record = seedRegistry(seed);
  indexSource(record);
  return record;
}

export function resolveSource(input: SourceResolutionInput = {}): ResolvedSource {
  initializeSourceRegistry();

  const sourceReference = input.sourceReference || '';
  const refSurface = parseReferenceSurface(sourceReference);
  const originSurface = normalizeSourceId(input.originSurface || '');
  const sourceId = aliasIndex.get(originSurface || '') ?? aliasIndex.get(refSurface || '') ?? 'tradescout';
  const record = getSource(sourceId) ?? getSource('tradescout');

  return {
    id: record?.id || 'tradescout',
    name: record?.name || 'TradeScout',
    type: record?.type || 'app',
    trustLevel: record?.trustLevel ?? 1,
    active: record?.active ?? true,
    reference: sourceReference || `${sourceId}:${input.entityId || 'unknown'}`
  };
}

export function getRegisteredSources(): SourceRecord[] {
  initializeSourceRegistry();
  return [...registryById.values()].sort((a, b) => a.id.localeCompare(b.id));
}

initializeSourceRegistry();
