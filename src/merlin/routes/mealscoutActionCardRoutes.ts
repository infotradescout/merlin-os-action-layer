import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  buildApplyPlan,
  duplicateWarningsForCard,
  executeApplyPlan,
  normalizeApplyResult,
  resolveExistingProfile,
  validateApplyPlan
} from '../adapters/mealscoutApplyAdapter.js';
import { resolveOperatorIdentity, resolveOperatorRole } from '../../operatorIdentity.js';
import {
  findActionCardByNotificationTrackingId,
  getActionCard,
  listActionCards,
  listActionCardsByBatch,
  updateActionCardApplyState,
  updateActionCardContactEvidence,
  updateActionCardDecision,
  updateActionCardManualRecipient,
  updateActionCardNotificationState,
  type StoredActionCard
} from '../intake/actionCardQueue.js';

const ALLOWED_OPERATOR_ROLES = new Set(['admin', 'super-admin', 'super_admin', 'operator', 'staff']);

async function parseBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))));
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        resolve({ __invalid_body: true });
      }
    });
    req.on('error', () => resolve({ __invalid_body: true }));
  });
}

function responseJson(res: ServerResponse, payload: unknown, status = 200): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

function hasActionCardAccess(req: IncomingMessage): boolean {
  return ALLOWED_OPERATOR_ROLES.has(resolveOperatorRole(req).role);
}

function forbidden(res: ServerResponse): true {
  responseJson(res, { error: 'forbidden', reason: 'insufficient_permissions', mutationAllowed: false }, 403);
  return true;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}

function buildCanonicalProfileLink(profileId: string): string {
  return `/mealscout/profile/${encodeURIComponent(profileId)}`;
}

function resolveAppliedProfileId(card: StoredActionCard): string {
  const result = card.applyResult && typeof card.applyResult === 'object' ? (card.applyResult as Record<string, unknown>) : null;
  const createdEntity = result?.createdEntity;
  const updatedEntity = result?.updatedEntity;
  if (createdEntity && typeof createdEntity === 'object') {
    const id = asString((createdEntity as Record<string, unknown>).id);
    if (id) return id;
  }
  if (updatedEntity && typeof updatedEntity === 'object') {
    const id = asString((updatedEntity as Record<string, unknown>).id);
    if (id) return id;
  }
  return resolveExistingProfile(card)?.id || '';
}

type RecipientCandidate = {
  type: string;
  value: string;
  normalizedValue: string;
};

function normalizeRecipient(value: string): string {
  return value.includes('@') ? value.trim().toLowerCase() : value.replace(/[^0-9]/g, '');
}

function selectRecipientCandidates(card: StoredActionCard): {
  primary: RecipientCandidate | null;
  ambiguous: boolean;
  candidates: RecipientCandidate[];
  blockedReason: string | null;
} {
  if (card.manualNotificationRecipient) {
    const value = card.manualNotificationRecipient;
    return {
      primary: {
        type: card.manualNotificationRecipientType || (value.includes('@') ? 'email' : 'phone'),
        value,
        normalizedValue: normalizeRecipient(value)
      },
      ambiguous: false,
      candidates: [],
      blockedReason: null
    };
  }

  const fields = card.extractedFields as Record<string, unknown>;
  const candidateMap = new Map<string, RecipientCandidate>();
  const addCandidate = (type: string, value: string): void => {
    const normalizedValue = normalizeRecipient(value);
    if (!normalizedValue) return;
    candidateMap.set(`${type}:${normalizedValue}`, { type, value, normalizedValue });
  };

  const email = asString(fields.email);
  const phone = asString(fields.phone);
  if (email) addCandidate('email', email);
  if (phone) addCandidate('phone', phone);

  const contactCandidates = Array.isArray(fields.contactCandidates) ? fields.contactCandidates : [];
  for (const row of contactCandidates) {
    if (!row || typeof row !== 'object') continue;
    const candidate = row as Record<string, unknown>;
    const type = asString(candidate.type) || (asString(candidate.value).includes('@') ? 'email' : 'phone');
    const value = asString(candidate.value);
    if (value) addCandidate(type, value);
  }

  const candidates = Array.from(candidateMap.values());
  if (candidates.length === 0) {
    return { primary: null, ambiguous: false, candidates: [], blockedReason: 'recipient_missing' };
  }
  if (candidates.length > 1) {
    return { primary: null, ambiguous: true, candidates, blockedReason: 'recipient_ambiguous' };
  }
  return { primary: candidates[0], ambiguous: false, candidates, blockedReason: null };
}

function validateManualRecipient(input: {
  recipient: string;
  recipientType: string;
  recipientSource: string;
  reason: string;
}): string | null {
  if (!input.reason) return 'reason_required';
  if (!['email', 'phone', 'social', 'other'].includes(input.recipientType)) return 'invalid_recipient_type';
  if (!['manual_verified', 'known_contact', 'social_profile', 'operator_supplied'].includes(input.recipientSource)) {
    return 'invalid_recipient_source';
  }
  if (input.recipientType === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.recipient)) return 'invalid_recipient';
  if (input.recipientType === 'phone' && normalizeRecipient(input.recipient).length < 10) return 'invalid_recipient';
  if (!input.recipient) return 'recipient_required';
  return null;
}

async function buildNotificationPreview(card: StoredActionCard): Promise<{
  eligible: boolean;
  blockedReason: string | null;
  notificationState: StoredActionCard['notificationState'];
  recipientCandidate?: RecipientCandidate | null;
  recipientCandidates?: RecipientCandidate[];
  recipientAmbiguous?: boolean;
  profileLink?: string;
  notificationTrackingId?: string;
  notificationLink?: string;
}> {
  if (card.applyState !== 'applied') {
    updateActionCardNotificationState({
      cardId: card.id,
      notificationState: 'blocked',
      notificationError: 'card_not_applied'
    });
    return { eligible: false, blockedReason: 'card_not_applied', notificationState: 'blocked' };
  }

  const profileId = resolveAppliedProfileId(card);
  if (!profileId) {
    updateActionCardNotificationState({
      cardId: card.id,
      notificationState: 'blocked',
      notificationError: 'profile_missing_after_apply'
    });
    return { eligible: false, blockedReason: 'profile_missing_after_apply', notificationState: 'blocked' };
  }

  const recipient = selectRecipientCandidates(card);
  if (recipient.ambiguous) {
    updateActionCardNotificationState({
      cardId: card.id,
      notificationState: 'blocked',
      notificationError: 'recipient_ambiguous'
    });
    return {
      eligible: false,
      blockedReason: 'recipient_ambiguous',
      notificationState: 'blocked',
      recipientAmbiguous: true,
      recipientCandidates: recipient.candidates
    };
  }
  if (!recipient.primary) {
    updateActionCardNotificationState({
      cardId: card.id,
      notificationState: 'blocked',
      notificationError: recipient.blockedReason || 'recipient_missing'
    });
    return {
      eligible: false,
      blockedReason: recipient.blockedReason || 'recipient_missing',
      notificationState: 'blocked'
    };
  }

  const notificationTrackingId = card.notificationTrackingId || `ms-ac-track-${randomUUID()}`;
  const notificationLink = `/api/mealscout/intake/notifications/${encodeURIComponent(notificationTrackingId)}/open`;
  updateActionCardNotificationState({
    cardId: card.id,
    notificationState: 'ready',
    notificationRecipient: recipient.primary.value,
    notificationTrackingId,
    notificationLink,
    notificationPreview: `Open your profile: ${notificationLink}`
  });

  return {
    eligible: true,
    blockedReason: null,
    notificationState: 'ready',
    recipientCandidate: recipient.primary,
    profileLink: buildCanonicalProfileLink(profileId),
    notificationTrackingId,
    notificationLink
  };
}

function invalidJson(res: ServerResponse): true {
  responseJson(res, { error: 'Invalid JSON body', mutationAllowed: false }, 400);
  return true;
}

export async function handleMealScoutActionCardRoute(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
  const method = (req.method || 'GET').toUpperCase();

  const openMatch = pathname.match(/^\/api\/mealscout\/intake\/notifications\/([^/]+)\/open$/);
  if (method === 'GET' && openMatch) {
    const trackingId = decodeURIComponent(openMatch[1]);
    const card = findActionCardByNotificationTrackingId(trackingId);
    if (!card) {
      responseJson(res, { error: 'notification_not_found', mutationAllowed: false }, 404);
      return true;
    }
    const profileId = resolveAppliedProfileId(card);
    if (!profileId) {
      responseJson(res, { error: 'profile_not_found', mutationAllowed: false }, 404);
      return true;
    }
    const now = new Date().toISOString();
    updateActionCardNotificationState({
      cardId: card.id,
      notificationState: card.notificationState,
      notificationOpenedAt: card.notificationOpenedAt || now,
      notificationLastOpenedAt: now,
      notificationOpenCount: Number(card.notificationOpenCount || 0) + 1
    });
    res.statusCode = 302;
    res.setHeader('Location', buildCanonicalProfileLink(profileId));
    res.end();
    return true;
  }

  if (
    pathname === '/api/mealscout/intake/action-cards' ||
    pathname.startsWith('/api/mealscout/intake/action-cards/') ||
    pathname.match(/^\/api\/mealscout\/intake\/batches\/[^/]+\/action-cards$/)
  ) {
    if (!hasActionCardAccess(req)) return forbidden(res);
  }

  const batchMatch = pathname.match(/^\/api\/mealscout\/intake\/batches\/([^/]+)\/action-cards$/);
  if (method === 'GET' && batchMatch) {
    const batchId = decodeURIComponent(batchMatch[1]);
    responseJson(res, { mutationAllowed: false, actionCards: listActionCardsByBatch(batchId) });
    return true;
  }

  if (method === 'GET' && pathname === '/api/mealscout/intake/action-cards') {
    responseJson(res, { mutationAllowed: false, actionCards: listActionCards() });
    return true;
  }

  const dryRunMatch = pathname.match(/^\/api\/mealscout\/intake\/action-cards\/([^/]+)\/dry-run$/);
  if (method === 'POST' && dryRunMatch) {
    const cardId = decodeURIComponent(dryRunMatch[1]);
    const card = getActionCard(cardId);
    if (!card) return responseJson(res, { error: 'action_card_not_found', mutationAllowed: false }, 404), true;

    if (card.type === 'create_profile_draft') {
      const plan = buildApplyPlan(card, 'create_new');
      return responseJson(res, {
        mutationAllowed: false,
        wouldCreate: {
          fields: plan.record.profileFields,
          duplicateWarnings: plan.duplicateWarnings
        },
        wouldUpdate: null,
        skippedReason: null,
        duplicateWarnings: plan.duplicateWarnings
      }), true;
    }

    if (card.type === 'update_existing_profile') {
      const plan = buildApplyPlan(card, 'update_existing');
      return responseJson(res, {
        mutationAllowed: false,
        wouldCreate: null,
        wouldUpdate: {
          entityId: card.existingEntityMatch?.entityId,
          fieldDiffs: plan.fieldDiff
        },
        skippedReason: null
      }), true;
    }

    if (card.type === 'request_missing_info') {
      return responseJson(res, {
        mutationAllowed: false,
        wouldCreate: null,
        wouldUpdate: null,
        skippedReason: 'missing_required_fields',
        missingFields: card.missingFields
      }), true;
    }

    if (card.type === 'defer_unclassified') {
      return responseJson(res, {
        mutationAllowed: false,
        wouldCreate: null,
        wouldUpdate: null,
        skippedReason: 'deferred_unclassified_evidence'
      }), true;
    }

    return responseJson(res, {
      mutationAllowed: false,
      wouldCreate: null,
      wouldUpdate: null,
      skippedReason: 'claim_existing_profile_not_supported'
    }), true;
  }

  const decisionMatch = pathname.match(/^\/api\/mealscout\/intake\/action-cards\/([^/]+)\/decision$/);
  if (method === 'PATCH' && decisionMatch) {
    const body = await parseBody(req);
    if (typeof body === 'object' && body !== null && '__invalid_body' in body) return invalidJson(res);
    const payload = (body || {}) as Record<string, unknown>;
    const decisionState = asString(payload.decisionState).toLowerCase();
    if (!['approved_for_apply', 'rejected', 'deferred'].includes(decisionState)) {
      return responseJson(res, { error: 'invalid_decision_state', mutationAllowed: false }, 400), true;
    }
    const updated = updateActionCardDecision({
      cardId: decodeURIComponent(decisionMatch[1]),
      decisionState: decisionState as 'approved_for_apply' | 'rejected' | 'deferred',
      decisionBy: resolveOperatorIdentity(req).decidedBy,
      decisionReason: asString(payload.decisionReason) || null
    });
    if (!updated) return responseJson(res, { error: 'action_card_not_found', mutationAllowed: false }, 404), true;
    responseJson(res, {
      mutationAllowed: false,
      decisionState: updated.decisionState,
      sourceFileIds: updated.sourceFileIds,
      extractedFields: updated.extractedFields
    });
    return true;
  }

  const applyMatch = pathname.match(/^\/api\/mealscout\/intake\/action-cards\/([^/]+)\/apply$/);
  if (method === 'POST' && applyMatch) {
    const cardId = decodeURIComponent(applyMatch[1]);
    const card = getActionCard(cardId);
    if (!card) return responseJson(res, { error: 'action_card_not_found', mutationAllowed: false }, 404), true;

    const body = await parseBody(req);
    if (typeof body === 'object' && body !== null && '__invalid_body' in body) return invalidJson(res);
    const payload = (body || {}) as Record<string, unknown>;
    const allowDuplicateCreate = payload.allowDuplicateCreate === true;
    const applyReason = asString(payload.applyReason);
    const auditWarnings = applyReason ? [`apply_reason:${applyReason}`] : [];

    if (card.decisionState !== 'approved_for_apply') {
      return responseJson(res, { error: 'card_not_approved_for_apply', mutationAllowed: false }, 409), true;
    }
    if (card.applyState === 'applied') {
      return responseJson(res, {
        mutationAllowed: false,
        applyState: 'applied',
        skippedReason: 'already_applied'
      }), true;
    }

    if (card.type === 'create_profile_draft') {
      const plan = buildApplyPlan(card, 'create_new');
      const validation = validateApplyPlan(plan, { allowDuplicateCreate });
      if (!validation.ok) {
        updateActionCardApplyState({
          cardId,
          applyState: 'apply_failed',
          appliedBy: resolveOperatorIdentity(req).decidedBy,
          applyError: validation.blockedReason,
          applyResult: {
            skippedReason: validation.blockedReason,
            duplicateWarnings: plan.duplicateWarnings,
            auditWarnings
          }
        });
        return responseJson(res, {
          mutationAllowed: false,
          applyState: 'apply_failed',
          skippedReason: validation.blockedReason,
          applyError: validation.blockedReason,
          duplicateWarnings: plan.duplicateWarnings,
          auditWarnings
        }), true;
      }

      const execution = executeApplyPlan(plan);
      const normalized = normalizeApplyResult(execution, plan.fieldDiff);
      updateActionCardApplyState({
        cardId,
        applyState: 'applied',
        appliedBy: resolveOperatorIdentity(req).decidedBy,
        applyResult: { ...normalized, auditWarnings }
      });
      return responseJson(res, {
        mutationAllowed: true,
        applyState: 'applied',
        ...normalized,
        auditWarnings
      }), true;
    }

    if (card.type === 'update_existing_profile') {
      const plan = buildApplyPlan(card, 'update_existing');
      const validation = validateApplyPlan(plan, { allowDuplicateCreate });
      if (!validation.ok) {
        updateActionCardApplyState({
          cardId,
          applyState: 'apply_failed',
          appliedBy: resolveOperatorIdentity(req).decidedBy,
          applyError: validation.blockedReason,
          applyResult: {
            skippedReason: validation.blockedReason,
            auditWarnings
          }
        });
        return responseJson(res, {
          mutationAllowed: false,
          applyState: 'apply_failed',
          skippedReason: validation.blockedReason,
          auditWarnings
        }), true;
      }

      const execution = executeApplyPlan(plan);
      if (execution.status === 'failed') {
        updateActionCardApplyState({
          cardId,
          applyState: 'apply_failed',
          appliedBy: resolveOperatorIdentity(req).decidedBy,
          applyError: execution.failureReason,
          applyResult: {
            skippedReason: execution.failureReason,
            auditWarnings
          }
        });
        return responseJson(res, {
          mutationAllowed: false,
          applyState: 'apply_failed',
          skippedReason: execution.failureReason,
          auditWarnings
        }), true;
      }

      const normalized = normalizeApplyResult(execution, plan.fieldDiff);
      updateActionCardApplyState({
        cardId,
        applyState: 'applied',
        appliedBy: resolveOperatorIdentity(req).decidedBy,
        applyResult: { ...normalized, auditWarnings }
      });
      return responseJson(res, {
        mutationAllowed: true,
        applyState: 'applied',
        ...normalized,
        auditWarnings
      }), true;
    }

    const skippedReason =
      card.type === 'claim_existing_profile'
        ? 'pending_claim_not_supported'
        : card.type === 'request_missing_info'
          ? 'missing_info_task_not_supported'
          : 'defer_unclassified_no_apply';
    updateActionCardApplyState({
      cardId,
      applyState: 'apply_failed',
      appliedBy: resolveOperatorIdentity(req).decidedBy,
      applyError: skippedReason,
      applyResult: {
        skippedReason,
        claimResult: null,
        auditWarnings
      }
    });
    return responseJson(res, {
      mutationAllowed: false,
      applyState: 'apply_failed',
      skippedReason,
      claimResult: null,
      auditWarnings
    }), true;
  }

  const notificationPreviewMatch = pathname.match(/^\/api\/mealscout\/intake\/action-cards\/([^/]+)\/notification\/preview$/);
  if (method === 'POST' && notificationPreviewMatch) {
    const card = getActionCard(decodeURIComponent(notificationPreviewMatch[1]));
    if (!card) return responseJson(res, { error: 'action_card_not_found', mutationAllowed: false }, 404), true;
    const preview = await buildNotificationPreview(card);
    responseJson(res, { mutationAllowed: false, ...preview });
    return true;
  }

  const notificationSendMatch = pathname.match(/^\/api\/mealscout\/intake\/action-cards\/([^/]+)\/notification\/send$/);
  if (method === 'POST' && notificationSendMatch) {
    const cardId = decodeURIComponent(notificationSendMatch[1]);
    const card = getActionCard(cardId);
    if (!card) return responseJson(res, { error: 'action_card_not_found', mutationAllowed: false }, 404), true;
    const body = await parseBody(req);
    if (typeof body === 'object' && body !== null && '__invalid_body' in body) return invalidJson(res);
    const payload = (body || {}) as Record<string, unknown>;
    const channel = asString(payload.channel) || 'manual_copy';

    if (duplicateWarningsForCard(card).length > 0 && payload.allowConflictSend !== true) {
      updateActionCardNotificationState({
        cardId,
        notificationState: 'blocked',
        notificationError: 'conflict_override_required'
      });
      return responseJson(res, {
        mutationAllowed: false,
        notificationState: 'blocked',
        blockedReason: 'conflict_override_required'
      }), true;
    }

    if (channel !== 'manual_copy') {
      updateActionCardNotificationState({
        cardId,
        notificationState: 'blocked',
        notificationError: 'channel_not_available'
      });
      return responseJson(res, {
        mutationAllowed: false,
        notificationState: 'blocked',
        blockedReason: 'channel_not_available'
      }), true;
    }

    const preview = await buildNotificationPreview(card);
    if (!preview.eligible || !preview.recipientCandidate || !preview.notificationTrackingId || !preview.notificationLink) {
      return responseJson(res, {
        mutationAllowed: false,
        notificationState: preview.notificationState,
        blockedReason: preview.blockedReason
      }), true;
    }

    const recipient = asString(payload.recipient) || preview.recipientCandidate.value;
    const messageSent = `Profile review ready: ${preview.notificationLink}`;
    updateActionCardNotificationState({
      cardId,
      notificationState: 'ready',
      notificationRecipient: recipient,
      notificationChannel: 'manual_copy',
      notificationTrackingId: preview.notificationTrackingId,
      notificationLink: preview.notificationLink,
      notificationPreview: messageSent,
      notificationResult: { mode: 'copy_only', recipient }
    });
    return responseJson(res, {
      mutationAllowed: false,
      notificationState: 'ready',
      messageSent,
      notificationResult: { mode: 'copy_only', recipient },
      notificationTrackingId: preview.notificationTrackingId,
      notificationLink: preview.notificationLink
    }), true;
  }

  const notificationStatusMatch = pathname.match(/^\/api\/mealscout\/intake\/action-cards\/([^/]+)\/notification\/status$/);
  if (method === 'GET' && notificationStatusMatch) {
    const card = getActionCard(decodeURIComponent(notificationStatusMatch[1]));
    if (!card) return responseJson(res, { error: 'action_card_not_found', mutationAllowed: false }, 404), true;
    responseJson(res, {
      mutationAllowed: false,
      notificationState: card.notificationState,
      notificationOpenCount: card.notificationOpenCount,
      notificationOpenedAt: card.notificationOpenedAt || null,
      notificationLastOpenedAt: card.notificationLastOpenedAt || null
    });
    return true;
  }

  const notificationRecipientMatch = pathname.match(/^\/api\/mealscout\/intake\/action-cards\/([^/]+)\/notification\/recipient$/);
  if (method === 'PATCH' && notificationRecipientMatch) {
    const body = await parseBody(req);
    if (typeof body === 'object' && body !== null && '__invalid_body' in body) return invalidJson(res);
    const payload = (body || {}) as Record<string, unknown>;
    const validation = validateManualRecipient({
      recipient: asString(payload.recipient),
      recipientType: asString(payload.recipientType),
      recipientSource: asString(payload.recipientSource),
      reason: asString(payload.reason)
    });
    if (validation) return responseJson(res, { error: validation, mutationAllowed: false }, 400), true;
    const updated = updateActionCardManualRecipient({
      cardId: decodeURIComponent(notificationRecipientMatch[1]),
      recipient: asString(payload.recipient),
      recipientType: asString(payload.recipientType) as 'email' | 'phone' | 'social' | 'other',
      recipientSource: asString(payload.recipientSource) as 'manual_verified' | 'known_contact' | 'social_profile' | 'operator_supplied',
      reason: asString(payload.reason),
      decidedBy: resolveOperatorIdentity(req).decidedBy
    });
    if (!updated) return responseJson(res, { error: 'action_card_not_found', mutationAllowed: false }, 404), true;
    responseJson(res, {
      mutationAllowed: false,
      manualNotificationRecipient: updated.manualNotificationRecipient
    });
    return true;
  }

  const contactEvidenceMatch = pathname.match(/^\/api\/mealscout\/intake\/action-cards\/([^/]+)\/contact-evidence$/);
  if (method === 'POST' && contactEvidenceMatch) {
    const body = await parseBody(req);
    if (typeof body === 'object' && body !== null && '__invalid_body' in body) return invalidJson(res);
    const payload = (body || {}) as Record<string, unknown>;
    const sourceFileIds = asStringArray(payload.sourceFileIds);
    const reason = asString(payload.reason);
    if (sourceFileIds.length === 0) {
      return responseJson(res, { error: 'source_file_ids_required', mutationAllowed: false }, 400), true;
    }
    if (!reason) {
      return responseJson(res, { error: 'reason_required', mutationAllowed: false }, 400), true;
    }
    const card = getActionCard(decodeURIComponent(contactEvidenceMatch[1]));
    if (!card) return responseJson(res, { error: 'action_card_not_found', mutationAllowed: false }, 404), true;
    const extractedFields = {
      ...card.extractedFields,
      addedContactEvidenceSourceFileIds: sourceFileIds
    };
    const updated = updateActionCardContactEvidence({
      cardId: card.id,
      fileIds: sourceFileIds,
      fileNames: sourceFileIds,
      reason,
      decidedBy: resolveOperatorIdentity(req).decidedBy,
      contactReprocessResult: {
        reprocessContactOnly: payload.reprocessContactOnly === true,
        sourceFileIds
      },
      extractedFields
    });
    if (!updated) return responseJson(res, { error: 'action_card_not_found', mutationAllowed: false }, 404), true;
    responseJson(res, {
      mutationAllowed: false,
      sourceFileIds: updated.addedContactEvidenceFileIds || []
    });
    return true;
  }

  return false;
}
