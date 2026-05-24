export interface EntityResolutionInput {
  entity_id: string;
  entity_name?: string;
  business_name?: string;
  phone?: string;
  phone_number?: string;
  email?: string;
  domain?: string;
  location?: string;
  county?: string;
  aliases?: string[];
}

interface ResolvedEntityRecord {
  canonical_entity_id: string;
  aliases: Set<string>;
  businessName?: string;
  location?: string;
  county?: string;
  phone?: string;
  email?: string;
  domain?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EntityResolutionResult {
  canonical_entity_id: string;
  confidence: 'high' | 'medium' | 'low';
  matchType: 'exact' | 'phone' | 'email' | 'domain' | 'name_location' | 'none';
  candidates: string[];
}

const records = new Map<string, ResolvedEntityRecord>();
const aliasById = new Map<string, string>();
const indexByPhone = new Map<string, Set<string>>();
const indexByEmail = new Map<string, Set<string>>();
const indexByDomain = new Map<string, Set<string>>();
const indexByNameLocation = new Map<string, Set<string>>();

function normalizeText(value: string | undefined): string {
  if (!value) return '';
  return value.trim().toLowerCase();
}

function normalizeEntityId(value: string | undefined): string {
  return (value || '').trim();
}

function normalizeBusinessName(value: string | undefined): string {
  if (!value) return '';
  const collapsed = normalizeText(value).replace(/[\.,]/g, '').replace(/\b(ltd|llc|inc|llp|co|corp)\b/g, '');
  return collapsed.replace(/\s+/g, ' ').trim();
}

function normalizeEmail(value: string | undefined): string {
  if (!value) return '';
  return normalizeText(value).toLowerCase();
}

function normalizePhone(value: string | undefined): string {
  if (!value) return '';
  return value.replace(/\D/g, '');
}

function normalizeDomain(value: string | undefined): string {
  if (!value) return '';
  const trimmed = normalizeText(value);
  if (!trimmed) return '';
  const noProtocol = trimmed.replace(/^https?:\/\//, '').replace(/^www\./, '');
  return noProtocol.split('/')[0];
}

function normalizeLocation(value: string | undefined): string {
  return normalizeText(value).replace(/[,\.\;]/g, '').replace(/\s+/g, ' ');
}

function makeNameLocationKey(name: string, location: string): string {
  const canonicalName = normalizeBusinessName(name);
  const canonicalLocation = normalizeLocation(location);
  return `${canonicalName}|${canonicalLocation}`;
}

function upsertIndex<T>(index: Map<string, Set<string>>, key: string | undefined, canonicalId: string): void {
  if (!key) return;
  const existing = index.get(key);
  if (existing) {
    existing.add(canonicalId);
    return;
  }
  index.set(key, new Set([canonicalId]));
}

function currentTime(): string {
  return new Date().toISOString();
}

function addAlias(canonicalId: string, alias: string): void {
  const next = normalizeText(alias);
  if (!next || next === canonicalId) return;
  aliasById.set(next, canonicalId);
}

function registerRecord(record: ResolvedEntityRecord): void {
  records.set(record.canonical_entity_id, record);
  aliasById.set(normalizeText(record.canonical_entity_id), record.canonical_entity_id);
  for (const alias of record.aliases) {
    addAlias(record.canonical_entity_id, alias);
  }
  if (record.phone) upsertIndex(indexByPhone, record.phone, record.canonical_entity_id);
  if (record.email) upsertIndex(indexByEmail, record.email, record.canonical_entity_id);
  if (record.domain) upsertIndex(indexByDomain, record.domain, record.canonical_entity_id);
  if (record.businessName && record.location) {
    upsertIndex(
      indexByNameLocation,
      makeNameLocationKey(record.businessName, record.location),
      record.canonical_entity_id
    );
  }
}

function mergeCandidates(keys: string[], index: Map<string, Set<string>>): string[] {
  const set = new Set<string>();
  for (const key of keys) {
    const candidates = index.get(key);
    if (!candidates) continue;
    for (const candidate of candidates) set.add(candidate);
  }
  return [...set];
}

export function resetEntityResolutionForTest(): void {
  records.clear();
  aliasById.clear();
  indexByPhone.clear();
  indexByEmail.clear();
  indexByDomain.clear();
  indexByNameLocation.clear();
}

export function resolveEntityIdentity(input: EntityResolutionInput): EntityResolutionResult {
  const entityId = normalizeEntityId(input.entity_id);
  const exactCanonical = aliasById.get(normalizeText(entityId));
  if (exactCanonical) {
    return {
      canonical_entity_id: exactCanonical,
      confidence: 'high',
      matchType: 'exact',
      candidates: [exactCanonical]
    };
  }

  const businessName = normalizeBusinessName(input.entity_name || input.business_name);
  const location = normalizeLocation(input.location || input.county);
  const phone = normalizePhone(input.phone || input.phone_number);
  const email = normalizeEmail(input.email);
  const domain = normalizeDomain(input.domain);

  const phoneCandidates = mergeCandidates([phone], indexByPhone);
  if (phoneCandidates.length === 1) {
    return {
      canonical_entity_id: phoneCandidates[0],
      confidence: 'high',
      matchType: 'phone',
      candidates: phoneCandidates
    };
  }
  if (phoneCandidates.length > 1) {
    return {
      canonical_entity_id: entityId,
      confidence: 'low',
      matchType: 'none',
      candidates: phoneCandidates
    };
  }

  const emailCandidates = mergeCandidates([email], indexByEmail);
  if (emailCandidates.length === 1) {
    return {
      canonical_entity_id: emailCandidates[0],
      confidence: 'high',
      matchType: 'email',
      candidates: emailCandidates
    };
  }
  if (emailCandidates.length > 1) {
    return {
      canonical_entity_id: entityId,
      confidence: 'low',
      matchType: 'none',
      candidates: emailCandidates
    };
  }

  const domainCandidates = mergeCandidates([domain], indexByDomain);
  if (domainCandidates.length === 1) {
    return {
      canonical_entity_id: domainCandidates[0],
      confidence: 'high',
      matchType: 'domain',
      candidates: domainCandidates
    };
  }
  if (domainCandidates.length > 1) {
    return {
      canonical_entity_id: entityId,
      confidence: 'low',
      matchType: 'none',
      candidates: domainCandidates
    };
  }

  const nameLocationKey = businessName && location ? makeNameLocationKey(businessName, location) : '';
  const nameLocationCandidates = mergeCandidates([nameLocationKey], indexByNameLocation);
  if (nameLocationCandidates.length === 1) {
    return {
      canonical_entity_id: nameLocationCandidates[0],
      confidence: 'medium',
      matchType: 'name_location',
      candidates: nameLocationCandidates
    };
  }
  if (nameLocationCandidates.length > 1) {
    return {
      canonical_entity_id: entityId,
      confidence: 'low',
      matchType: 'none',
      candidates: nameLocationCandidates
    };
  }

  return {
    canonical_entity_id: entityId,
    confidence: 'low',
    matchType: 'none',
    candidates: []
  };
}

export function resolveAndTrackEntity(input: EntityResolutionInput): EntityResolutionResult {
  const resolved = resolveEntityIdentity(input);
  const canonicalId = normalizeEntityId(resolved.canonical_entity_id);

  const normalizedRecord: ResolvedEntityRecord = {
    canonical_entity_id: canonicalId,
    aliases: new Set([normalizeText(input.entity_id)]),
    businessName: normalizeBusinessName(input.business_name || input.entity_name),
    location: normalizeLocation(input.location),
    county: normalizeLocation(input.county),
    phone: normalizePhone(input.phone || input.phone_number),
    email: normalizeEmail(input.email),
    domain: normalizeDomain(input.domain),
    createdAt: currentTime(),
    updatedAt: currentTime()
  };

  const existing = records.get(canonicalId);
  if (!existing) {
    if (input.aliases) {
      for (const alias of input.aliases) {
        normalizedRecord.aliases.add(normalizeText(alias));
      }
    }
    registerRecord(normalizedRecord);
    return resolved;
  }

  existing.aliases.add(normalizeText(input.entity_id));
  if (input.aliases) {
    for (const alias of input.aliases) existing.aliases.add(normalizeText(alias));
  }
  if (!existing.businessName && normalizedRecord.businessName) {
    existing.businessName = normalizedRecord.businessName;
  }
  if (!existing.location && normalizedRecord.location) {
    existing.location = normalizedRecord.location;
  }
  if (!existing.county && normalizedRecord.county) {
    existing.county = normalizedRecord.county;
  }
  if (!existing.phone && normalizedRecord.phone) {
    existing.phone = normalizedRecord.phone;
    upsertIndex(indexByPhone, existing.phone, existing.canonical_entity_id);
  }
  if (!existing.email && normalizedRecord.email) {
    existing.email = normalizedRecord.email;
    upsertIndex(indexByEmail, existing.email, existing.canonical_entity_id);
  }
  if (!existing.domain && normalizedRecord.domain) {
    existing.domain = normalizedRecord.domain;
    upsertIndex(indexByDomain, existing.domain, existing.canonical_entity_id);
  }
  if (!existing.businessName || !existing.location) {
    if (!existing.businessName && normalizedRecord.businessName) {
      existing.businessName = normalizedRecord.businessName;
    }
    if (!existing.location && normalizedRecord.location) {
      existing.location = normalizedRecord.location;
    }
    if (existing.businessName && existing.location) {
      const mergeKey = makeNameLocationKey(existing.businessName, existing.location);
      upsertIndex(indexByNameLocation, mergeKey, existing.canonical_entity_id);
    }
  }
  existing.updatedAt = currentTime();
  registerRecord(existing);
  return resolved;
}
