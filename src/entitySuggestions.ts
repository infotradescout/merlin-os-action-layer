import { getManifestEntryByDriveFileId } from './driveManifest.js';
import { getEntitySuggestionProfiles, type EntitySuggestionProfile } from './lisa.js';

export interface EntitySuggestion {
  entity_id: string;
  entity_type?: string;
  label: string;
  confidence: number;
  reasons: string[];
  matched_fields: string[];
}

function normalizeText(value: string | undefined): string {
  return (value || '').trim().toLowerCase();
}

function normalizePhone(value: string | undefined): string {
  return (value || '').replace(/\D/g, '');
}

function normalizeDomain(value: string | undefined): string {
  const base = normalizeText(value).replace(/^https?:\/\//, '').replace(/^www\./, '');
  return base.split('/')[0];
}

function tokenIncludes(haystack: string, needle: string): boolean {
  if (!haystack || !needle) return false;
  return haystack.includes(needle);
}

type DriveMatchInput = {
  name: string;
  text: string;
  email: string;
  phone: string;
  domain: string;
  county: string;
  location: string;
};

function buildDriveMatchInput(driveFileId: string): DriveMatchInput | null {
  const manifest = getManifestEntryByDriveFileId(driveFileId);
  if (!manifest) return null;
  const extractedFields = manifest.extracted_fields || {};
  const email = typeof extractedFields.email === 'string' ? extractedFields.email : '';
  const phone = typeof extractedFields.phone === 'string' ? extractedFields.phone : '';
  const domain = typeof extractedFields.domain === 'string' ? extractedFields.domain : '';
  const county = typeof extractedFields.county === 'string' ? extractedFields.county : '';
  const location = typeof extractedFields.location === 'string' ? extractedFields.location : '';
  return {
    name: normalizeText(manifest.file_name),
    text: normalizeText(manifest.extracted_text || ''),
    email: normalizeText(email),
    phone: normalizePhone(phone),
    domain: normalizeDomain(domain),
    county: normalizeText(county),
    location: normalizeText(location)
  };
}

function scoreSuggestion(input: DriveMatchInput, profile: EntitySuggestionProfile): EntitySuggestion | null {
  const reasons: string[] = [];
  const matchedFields: string[] = [];
  let score = 0;

  const businessName = normalizeText(profile.business_name);
  const email = normalizeText(profile.email);
  const phone = normalizePhone(profile.phone);
  const domain = normalizeDomain(profile.domain);
  const county = normalizeText(profile.county);
  const location = normalizeText(profile.location);
  const aliases = (profile.aliases || []).map((alias) => normalizeText(alias));

  if (email && (email === input.email || tokenIncludes(input.text, email))) {
    score += 0.45;
    reasons.push(`Email matched ${email}`);
    matchedFields.push('email');
  }
  if (phone && (phone === input.phone || tokenIncludes(input.text, phone))) {
    score += 0.4;
    reasons.push(`Phone matched ${phone}`);
    matchedFields.push('phone');
  }
  if (domain && (domain === input.domain || tokenIncludes(input.text, domain) || tokenIncludes(input.name, domain))) {
    score += 0.4;
    reasons.push(`Domain matched ${domain}`);
    matchedFields.push('domain');
  }
  if (businessName && (tokenIncludes(input.name, businessName) || tokenIncludes(input.text, businessName))) {
    score += 0.25;
    reasons.push(`Business name matched ${profile.business_name}`);
    matchedFields.push('business_name');
  }
  if (county && (county === input.county || tokenIncludes(input.text, county))) {
    score += 0.15;
    reasons.push(`County matched ${profile.county}`);
    matchedFields.push('county');
  }
  if (location && (location === input.location || tokenIncludes(input.text, location))) {
    score += 0.15;
    reasons.push(`Location matched ${profile.location}`);
    matchedFields.push('location');
  }
  for (const alias of aliases) {
    if (alias && (tokenIncludes(input.name, alias) || tokenIncludes(input.text, alias))) {
      score += 0.2;
      reasons.push(`Alias matched ${alias}`);
      matchedFields.push('aliases');
      break;
    }
  }

  if (score <= 0) return null;
  return {
    entity_id: profile.entity_id,
    entity_type: 'entity',
    label: profile.business_name || profile.label || profile.entity_id,
    confidence: Math.min(1, Number(score.toFixed(3))),
    reasons,
    matched_fields: Array.from(new Set(matchedFields))
  };
}

export function suggestEntitiesForDriveFile(driveFileId: string): EntitySuggestion[] {
  const input = buildDriveMatchInput(driveFileId);
  if (!input) return [];
  const profiles = getEntitySuggestionProfiles(500);
  return profiles
    .map((profile) => scoreSuggestion(input, profile))
    .filter((item): item is EntitySuggestion => Boolean(item))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 8);
}
