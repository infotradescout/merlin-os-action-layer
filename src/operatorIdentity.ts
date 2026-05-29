import type { IncomingMessage } from 'node:http';

export type OperatorIdentitySource = 'trusted_header' | 'env' | 'unknown';

export type OperatorIdentity = {
  decidedBy: string;
  source: OperatorIdentitySource;
};

export type OperatorRole = {
  role: string;
  source: OperatorIdentitySource;
};

function readHeaderValue(req: IncomingMessage, headerName: string): string | undefined {
  const raw = req.headers[headerName.toLowerCase()];
  if (typeof raw === 'string') {
    const value = raw.trim();
    return value || undefined;
  }
  if (Array.isArray(raw) && raw.length > 0) {
    const value = raw[0]?.trim();
    return value || undefined;
  }
  return undefined;
}

export function resolveOperatorIdentity(req: IncomingMessage): OperatorIdentity {
  // Attribution headers are trusted only when injected by internal infrastructure
  // (for example, an auth proxy that strips user-supplied spoofed headers).
  // Decision routes never trust client-submitted decided_by as identity authority.
  const headerCandidates = [
    readHeaderValue(req, 'x-operator-id'),
    readHeaderValue(req, 'x-operator-email'),
    readHeaderValue(req, 'x-user-id'),
    readHeaderValue(req, 'x-user-email'),
    readHeaderValue(req, 'x-forwarded-user')
  ];
  for (const candidate of headerCandidates) {
    if (candidate) {
      return { decidedBy: candidate, source: 'trusted_header' };
    }
  }

  const envCandidate = process.env.MERLIN_OPERATOR_ID?.trim();
  if (envCandidate) {
    return { decidedBy: envCandidate, source: 'env' };
  }

  return { decidedBy: 'unknown', source: 'unknown' };
}

export function resolveOperatorRole(req: IncomingMessage): OperatorRole {
  const roleHeaderCandidates = [
    readHeaderValue(req, 'x-operator-role'),
    readHeaderValue(req, 'x-user-role'),
    readHeaderValue(req, 'x-forwarded-role')
  ];
  for (const candidate of roleHeaderCandidates) {
    if (candidate) {
      return { role: candidate.trim().toLowerCase(), source: 'trusted_header' };
    }
  }
  const envRole = process.env.MERLIN_OPERATOR_ROLE?.trim().toLowerCase();
  if (envRole) {
    return { role: envRole, source: 'env' };
  }
  return { role: 'unknown', source: 'unknown' };
}
