import { createHash } from 'node:crypto';

export type MealScoutCandidateImportCandidate = {
  candidateId: string;
  businessName: string;
  extractedCandidateFields: Record<string, string>;
  confidence: number;
  source: 'gemini_drive_summary';
};

export type MealScoutCandidateEvidence = {
  fileId: string;
  fileName: string;
  extractedText?: string;
};

export type MealScoutCandidateEvidenceMatch = {
  fileId: string;
  fileName: string;
  matchScore: number;
  reasons: string[];
};

export type MealScoutMatchedCandidate = MealScoutCandidateImportCandidate & {
  evidenceStatus: 'matched' | 'unmatched';
  matches: MealScoutCandidateEvidenceMatch[];
};

function normalizeText(value: unknown): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizePhone(value: unknown): string {
  return String(value || '').replace(/\D/g, '');
}

function stableCandidateId(name: string, index: number): string {
  const hash = createHash('sha1').update(`${name}:${index}`).digest('hex').slice(0, 10);
  return `ms-candidate-${hash}`;
}

function cleanValue(value: string): string {
  return value.replace(/^[-*•\s]+/, '').replace(/\s+/g, ' ').trim();
}

function parseField(line: string): { key: string; value: string } | undefined {
  const match = line.match(/^\s*(?:[-*]\s*)?([A-Za-z][A-Za-z\s_/.-]{1,40})\s*[:\-]\s*(.+?)\s*$/);
  if (!match) return undefined;
  return { key: normalizeText(match[1]).replace(/\s+/g, '_'), value: cleanValue(match[2]) };
}

function looksLikeHeading(line: string): boolean {
  const cleaned = cleanValue(line).replace(/^#+\s*/, '');
  if (cleaned.length < 3 || cleaned.length > 80) return false;
  if (/^(candidate|business|vendor|truck|food truck)\s*\d*$/i.test(cleaned)) return false;
  if (/^(phone|email|city|location|website|facebook|instagram|notes|menu|cuisine)\b/i.test(cleaned)) return false;
  if (/[.:]\s+\S/.test(cleaned)) return false;
  return /[a-z]/i.test(cleaned);
}

function finishCandidate(name: string, fields: Record<string, string>, index: number): MealScoutCandidateImportCandidate | undefined {
  const businessName = cleanValue(name);
  if (!businessName) return undefined;
  return {
    candidateId: stableCandidateId(businessName, index),
    businessName,
    extractedCandidateFields: fields,
    confidence: Object.keys(fields).length > 0 ? 0.8 : 0.55,
    source: 'gemini_drive_summary'
  };
}

export function parseGeminiVendorSummary(markdownText: string): MealScoutCandidateImportCandidate[] {
  const lines = String(markdownText || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const candidates: MealScoutCandidateImportCandidate[] = [];
  let currentName = '';
  let currentFields: Record<string, string> = {};

  for (const rawLine of lines) {
    const line = rawLine.replace(/^#+\s*/, '').trim();
    const field = parseField(line);
    if (field) {
      const fieldLooksLikeName = ['business_name', 'business', 'vendor', 'truck_name', 'food_truck', 'name'].includes(field.key);
      if (fieldLooksLikeName) {
        if (currentName) {
          const candidate = finishCandidate(currentName, currentFields, candidates.length + 1);
          if (candidate) candidates.push(candidate);
        }
        currentName = field.value;
        currentFields = {};
      } else if (currentName) {
        currentFields[field.key] = field.value;
      }
      continue;
    }

    if (looksLikeHeading(line)) {
      if (currentName) {
        const candidate = finishCandidate(currentName, currentFields, candidates.length + 1);
        if (candidate) candidates.push(candidate);
      }
      currentName = cleanValue(line);
      currentFields = {};
    }
  }

  if (currentName) {
    const candidate = finishCandidate(currentName, currentFields, candidates.length + 1);
    if (candidate) candidates.push(candidate);
  }

  return candidates;
}

export function matchCandidatesToEvidence(
  candidates: MealScoutCandidateImportCandidate[],
  evidence: MealScoutCandidateEvidence[]
): MealScoutMatchedCandidate[] {
  return candidates.map((candidate) => {
    const candidateName = normalizeText(candidate.businessName);
    const candidatePhone = normalizePhone(candidate.extractedCandidateFields.phone);
    const candidateLocation = normalizeText(candidate.extractedCandidateFields.location || candidate.extractedCandidateFields.city);

    const matches = evidence
      .map((file) => {
        const haystack = normalizeText(`${file.fileName} ${file.extractedText || ''}`);
        const phoneHaystack = normalizePhone(file.extractedText || '');
        const reasons: string[] = [];
        let score = 0;

        if (candidateName && haystack.includes(candidateName)) {
          score += 0.6;
          reasons.push('business_name_match');
        }
        if (candidatePhone && phoneHaystack.includes(candidatePhone)) {
          score += 0.35;
          reasons.push('phone_match');
        }
        if (candidateLocation && haystack.includes(candidateLocation)) {
          score += 0.2;
          reasons.push('location_match');
        }

        return {
          fileId: file.fileId,
          fileName: file.fileName,
          matchScore: Number(Math.min(1, score).toFixed(2)),
          reasons
        };
      })
      .filter((match) => match.matchScore > 0)
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, 5);

    return {
      ...candidate,
      evidenceStatus: matches.length > 0 ? 'matched' : 'unmatched',
      matches
    };
  });
}
