import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import type { MerlinActionCard } from './actionCards.js';

export type StoredActionCard = MerlinActionCard & {
  batchId?: string;
  decisionState: 'pending' | 'approved_for_apply' | 'rejected' | 'deferred';
  decisionBy?: string;
  decisionAt?: string;
  decisionReason?: string | null;
  applyState: 'not_applied' | 'applied' | 'apply_failed';
  appliedBy?: string;
  appliedAt?: string;
  applyResult?: Record<string, unknown> | null;
  applyError?: string | null;
  notificationState: 'not_ready' | 'ready' | 'sent' | 'failed' | 'blocked';
  notificationRecipient?: string | null;
  notificationChannel?: 'email' | 'sms' | 'manual_copy' | null;
  notificationPreview?: string | null;
  notificationSentBy?: string | null;
  notificationSentAt?: string | null;
  notificationResult?: Record<string, unknown> | null;
  notificationError?: string | null;
  notificationTrackingId?: string | null;
  notificationLink?: string | null;
  notificationOpenedAt?: string | null;
  notificationOpenCount: number;
  notificationLastOpenedAt?: string | null;
  notificationClaimStartedAt?: string | null;
  notificationReviewStartedAt?: string | null;
  notificationAuditEvents?: Array<{ type: string; at: string; by?: string | null; details?: Record<string, unknown> }>;
  submittedByUserId?: string | null;
  affiliateId?: string | null;
  affiliateCode?: string | null;
  submissionSource?: string | null;
  attributionSnapshot?: Record<string, unknown> | null;
  affiliateAuditState?: 'not_reviewed' | 'reviewable' | 'approved_for_payout_review' | 'rejected_for_payout_review' | 'needs_more_evidence';
  affiliateAuditReason?: string | null;
  affiliateAuditBy?: string | null;
  affiliateAuditAt?: string | null;
  affiliateEvidenceScore?: number | null;
  affiliateQualifiedSignals?: string[];
  affiliateDisqualifyingSignals?: string[];
  payoutReady?: boolean;
  payoutReadyAt?: string | null;
  payoutReadyBy?: string | null;
  payoutReadyReason?: string | null;
  qualityScore?: number | null;
  qualityBand?: 'unscored' | 'high' | 'medium' | 'low' | 'blocked';
  qualitySignals?: string[];
  qualityWarnings?: string[];
  qualityScoredAt?: string | null;
  qualityScoredBy?: string | null;
  qualityScoreVersion?: string | null;
  manualNotificationRecipient?: string | null;
  manualNotificationRecipientType?: 'email' | 'phone' | 'social' | 'other' | null;
  manualNotificationRecipientSource?: 'manual_verified' | 'known_contact' | 'social_profile' | 'operator_supplied' | null;
  manualNotificationRecipientReason?: string | null;
  manualNotificationRecipientBy?: string | null;
  manualNotificationRecipientAt?: string | null;
  addedContactEvidenceFileIds?: string[];
  addedContactEvidenceFileNames?: string[];
  addedContactEvidenceAt?: string | null;
  addedContactEvidenceBy?: string | null;
  addedContactEvidenceReason?: string | null;
  contactReprocessResult?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

type ActionCardRow = {
  id: string;
  batch_id: string | null;
  type: string;
  title: string;
  entity_type: string;
  confidence: number;
  source_file_ids_json: string;
  extracted_fields_json: string;
  missing_fields_json: string;
  existing_entity_match_json: string | null;
  recommended_action: string;
  mutation_allowed: number;
  duplicate_warnings_json: string | null;
  conflict_warnings_json: string | null;
  replacement_candidate_json: string | null;
  decision_state: string;
  decision_by: string | null;
  decision_at: string | null;
  decision_reason: string | null;
  apply_state: string;
  applied_by: string | null;
  applied_at: string | null;
  apply_result_json: string | null;
  apply_error: string | null;
  notification_state: string;
  notification_recipient: string | null;
  notification_channel: string | null;
  notification_preview: string | null;
  notification_sent_by: string | null;
  notification_sent_at: string | null;
  notification_result_json: string | null;
  notification_error: string | null;
  notification_tracking_id: string | null;
  notification_link: string | null;
  notification_opened_at: string | null;
  notification_open_count: number | null;
  notification_last_opened_at: string | null;
  notification_claim_started_at: string | null;
  notification_review_started_at: string | null;
  notification_audit_events_json: string | null;
  submitted_by_user_id: string | null;
  affiliate_id: string | null;
  affiliate_code: string | null;
  submission_source: string | null;
  attribution_snapshot_json: string | null;
  affiliate_audit_state: string | null;
  affiliate_audit_reason: string | null;
  affiliate_audit_by: string | null;
  affiliate_audit_at: string | null;
  affiliate_evidence_score: number | null;
  affiliate_qualified_signals_json: string | null;
  affiliate_disqualifying_signals_json: string | null;
  payout_ready: number | null;
  payout_ready_at: string | null;
  payout_ready_by: string | null;
  payout_ready_reason: string | null;
  quality_score: number | null;
  quality_band: string | null;
  quality_signals_json: string | null;
  quality_warnings_json: string | null;
  quality_scored_at: string | null;
  quality_scored_by: string | null;
  quality_score_version: string | null;
  manual_notification_recipient: string | null;
  manual_notification_recipient_type: string | null;
  manual_notification_recipient_source: string | null;
  manual_notification_recipient_reason: string | null;
  manual_notification_recipient_by: string | null;
  manual_notification_recipient_at: string | null;
  added_contact_evidence_file_ids_json: string | null;
  added_contact_evidence_file_names_json: string | null;
  added_contact_evidence_at: string | null;
  added_contact_evidence_by: string | null;
  added_contact_evidence_reason: string | null;
  contact_reprocess_result_json: string | null;
  created_at: string;
  updated_at: string;
};

const DEFAULT_DB_PATH = './data/merlin-or.sqlite';
let db: Database.Database | null = null;
let dbPath: string | null = null;

function nowIso(): string {
  return new Date().toISOString();
}

function resolveDbPath(explicitPath?: string): string {
  return resolve(process.cwd(), explicitPath || process.env.MERLIN_DB_PATH || DEFAULT_DB_PATH);
}

function getDb(): Database.Database {
  if (!db) initializeActionCardQueueStore();
  return db as Database.Database;
}

function ensureColumn(database: Database.Database, table: string, column: string, definition: string): void {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (columns.some((row) => row.name === column)) return;
  database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function mapRow(row: ActionCardRow): StoredActionCard {
  const extractedFields = parseJson<Record<string, unknown>>(row.extracted_fields_json, {});
  const extractionDebug = extractedFields.extractionDebug as StoredActionCard['extractionDebug'] | undefined;
  return {
    id: row.id,
    batchId: row.batch_id ?? undefined,
    type: row.type as MerlinActionCard['type'],
    title: row.title,
    entityType: row.entity_type as MerlinActionCard['entityType'],
    confidence: row.confidence,
    sourceFileIds: parseJson<string[]>(row.source_file_ids_json, []),
    extractedFields,
    missingFields: parseJson<string[]>(row.missing_fields_json, []),
    existingEntityMatch: parseJson<MerlinActionCard['existingEntityMatch']>(row.existing_entity_match_json, null),
    recommendedAction: row.recommended_action,
    mutationAllowed: false,
    duplicateWarnings: parseJson<string[]>(row.duplicate_warnings_json, []),
    conflictWarnings: parseJson<string[]>(row.conflict_warnings_json, []),
    replacementCandidate: parseJson<MerlinActionCard['replacementCandidate']>(row.replacement_candidate_json, null),
    extractionDebug,
    decisionState: row.decision_state as StoredActionCard['decisionState'],
    decisionBy: row.decision_by ?? undefined,
    decisionAt: row.decision_at ?? undefined,
    decisionReason: row.decision_reason ?? null,
    applyState: row.apply_state as StoredActionCard['applyState'],
    appliedBy: row.applied_by ?? undefined,
    appliedAt: row.applied_at ?? undefined,
    applyResult: parseJson<Record<string, unknown> | null>(row.apply_result_json, null),
    applyError: row.apply_error ?? null,
    notificationState: (row.notification_state || 'not_ready') as StoredActionCard['notificationState'],
    notificationRecipient: row.notification_recipient ?? null,
    notificationChannel: (row.notification_channel || null) as StoredActionCard['notificationChannel'],
    notificationPreview: row.notification_preview ?? null,
    notificationSentBy: row.notification_sent_by ?? null,
    notificationSentAt: row.notification_sent_at ?? null,
    notificationResult: parseJson<Record<string, unknown> | null>(row.notification_result_json, null),
    notificationError: row.notification_error ?? null,
    notificationTrackingId: row.notification_tracking_id ?? null,
    notificationLink: row.notification_link ?? null,
    notificationOpenedAt: row.notification_opened_at ?? null,
    notificationOpenCount: Number(row.notification_open_count || 0),
    notificationLastOpenedAt: row.notification_last_opened_at ?? null,
    notificationClaimStartedAt: row.notification_claim_started_at ?? null,
    notificationReviewStartedAt: row.notification_review_started_at ?? null,
    notificationAuditEvents: parseJson<Array<{ type: string; at: string; by?: string | null; details?: Record<string, unknown> }>>(row.notification_audit_events_json, []),
    submittedByUserId: row.submitted_by_user_id ?? null,
    affiliateId: row.affiliate_id ?? null,
    affiliateCode: row.affiliate_code ?? null,
    submissionSource: row.submission_source ?? null,
    attributionSnapshot: parseJson<Record<string, unknown> | null>(row.attribution_snapshot_json, null),
    affiliateAuditState: (row.affiliate_audit_state || 'not_reviewed') as StoredActionCard['affiliateAuditState'],
    affiliateAuditReason: row.affiliate_audit_reason ?? null,
    affiliateAuditBy: row.affiliate_audit_by ?? null,
    affiliateAuditAt: row.affiliate_audit_at ?? null,
    affiliateEvidenceScore: typeof row.affiliate_evidence_score === 'number' ? row.affiliate_evidence_score : null,
    affiliateQualifiedSignals: parseJson<string[]>(row.affiliate_qualified_signals_json, []),
    affiliateDisqualifyingSignals: parseJson<string[]>(row.affiliate_disqualifying_signals_json, []),
    payoutReady: Boolean(row.payout_ready || 0),
    payoutReadyAt: row.payout_ready_at ?? null,
    payoutReadyBy: row.payout_ready_by ?? null,
    payoutReadyReason: row.payout_ready_reason ?? null,
    qualityScore: typeof row.quality_score === 'number' ? row.quality_score : null,
    qualityBand: (row.quality_band || 'unscored') as StoredActionCard['qualityBand'],
    qualitySignals: parseJson<string[]>(row.quality_signals_json, []),
    qualityWarnings: parseJson<string[]>(row.quality_warnings_json, []),
    qualityScoredAt: row.quality_scored_at ?? null,
    qualityScoredBy: row.quality_scored_by ?? null,
    qualityScoreVersion: row.quality_score_version ?? null,
    manualNotificationRecipient: row.manual_notification_recipient ?? null,
    manualNotificationRecipientType: (row.manual_notification_recipient_type || null) as StoredActionCard['manualNotificationRecipientType'],
    manualNotificationRecipientSource: (row.manual_notification_recipient_source || null) as StoredActionCard['manualNotificationRecipientSource'],
    manualNotificationRecipientReason: row.manual_notification_recipient_reason ?? null,
    manualNotificationRecipientBy: row.manual_notification_recipient_by ?? null,
    manualNotificationRecipientAt: row.manual_notification_recipient_at ?? null,
    addedContactEvidenceFileIds: parseJson<string[]>(row.added_contact_evidence_file_ids_json, []),
    addedContactEvidenceFileNames: parseJson<string[]>(row.added_contact_evidence_file_names_json, []),
    addedContactEvidenceAt: row.added_contact_evidence_at ?? null,
    addedContactEvidenceBy: row.added_contact_evidence_by ?? null,
    addedContactEvidenceReason: row.added_contact_evidence_reason ?? null,
    contactReprocessResult: parseJson<Record<string, unknown> | null>(row.contact_reprocess_result_json, null),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function initializeActionCardQueueStore(explicitPath?: string): string {
  const nextPath = resolveDbPath(explicitPath);
  if (db && dbPath === nextPath) return nextPath;
  if (db) {
    db.close();
    db = null;
  }
  mkdirSync(dirname(nextPath), { recursive: true });
  const nextDb = new Database(nextPath);
  nextDb.pragma('journal_mode = WAL');
  nextDb.pragma('foreign_keys = ON');
  nextDb.exec(`
    CREATE TABLE IF NOT EXISTS merlin_intake_action_cards (
      id TEXT PRIMARY KEY,
      batch_id TEXT,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      confidence REAL NOT NULL,
      source_file_ids_json TEXT NOT NULL,
      extracted_fields_json TEXT NOT NULL,
      missing_fields_json TEXT NOT NULL,
      existing_entity_match_json TEXT,
      recommended_action TEXT NOT NULL,
      mutation_allowed INTEGER NOT NULL,
      duplicate_warnings_json TEXT,
      conflict_warnings_json TEXT,
      replacement_candidate_json TEXT,
      decision_state TEXT NOT NULL,
      decision_by TEXT,
      decision_at TEXT,
      decision_reason TEXT,
      apply_state TEXT NOT NULL,
      applied_by TEXT,
      applied_at TEXT,
      apply_result_json TEXT,
      apply_error TEXT,
      notification_state TEXT NOT NULL DEFAULT 'not_ready',
      notification_recipient TEXT,
      notification_channel TEXT,
      notification_preview TEXT,
      notification_sent_by TEXT,
      notification_sent_at TEXT,
      notification_result_json TEXT,
      notification_error TEXT,
      notification_tracking_id TEXT,
      notification_link TEXT,
      notification_opened_at TEXT,
      notification_open_count INTEGER NOT NULL DEFAULT 0,
      notification_last_opened_at TEXT,
      notification_claim_started_at TEXT,
      notification_review_started_at TEXT,
      notification_audit_events_json TEXT,
      submitted_by_user_id TEXT,
      affiliate_id TEXT,
      affiliate_code TEXT,
      submission_source TEXT,
      attribution_snapshot_json TEXT,
      affiliate_audit_state TEXT NOT NULL DEFAULT 'not_reviewed',
      affiliate_audit_reason TEXT,
      affiliate_audit_by TEXT,
      affiliate_audit_at TEXT,
      affiliate_evidence_score REAL,
      affiliate_qualified_signals_json TEXT,
      affiliate_disqualifying_signals_json TEXT,
      payout_ready INTEGER NOT NULL DEFAULT 0,
      payout_ready_at TEXT,
      payout_ready_by TEXT,
      payout_ready_reason TEXT,
      quality_score REAL,
      quality_band TEXT NOT NULL DEFAULT 'unscored',
      quality_signals_json TEXT,
      quality_warnings_json TEXT,
      quality_scored_at TEXT,
      quality_scored_by TEXT,
      quality_score_version TEXT,
      manual_notification_recipient TEXT,
      manual_notification_recipient_type TEXT,
      manual_notification_recipient_source TEXT,
      manual_notification_recipient_reason TEXT,
      manual_notification_recipient_by TEXT,
      manual_notification_recipient_at TEXT,
      added_contact_evidence_file_ids_json TEXT,
      added_contact_evidence_file_names_json TEXT,
      added_contact_evidence_at TEXT,
      added_contact_evidence_by TEXT,
      added_contact_evidence_reason TEXT,
      contact_reprocess_result_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS merlin_intake_action_cards_batch_idx ON merlin_intake_action_cards(batch_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS merlin_intake_action_cards_decision_idx ON merlin_intake_action_cards(decision_state, updated_at DESC);
    CREATE INDEX IF NOT EXISTS merlin_intake_action_cards_apply_idx ON merlin_intake_action_cards(apply_state, updated_at DESC);
  `);
  ensureColumn(nextDb, 'merlin_intake_action_cards', 'notification_state', "TEXT NOT NULL DEFAULT 'not_ready'");
  ensureColumn(nextDb, 'merlin_intake_action_cards', 'notification_recipient', 'TEXT');
  ensureColumn(nextDb, 'merlin_intake_action_cards', 'notification_channel', 'TEXT');
  ensureColumn(nextDb, 'merlin_intake_action_cards', 'notification_preview', 'TEXT');
  ensureColumn(nextDb, 'merlin_intake_action_cards', 'notification_sent_by', 'TEXT');
  ensureColumn(nextDb, 'merlin_intake_action_cards', 'notification_sent_at', 'TEXT');
  ensureColumn(nextDb, 'merlin_intake_action_cards', 'notification_result_json', 'TEXT');
  ensureColumn(nextDb, 'merlin_intake_action_cards', 'notification_error', 'TEXT');
  ensureColumn(nextDb, 'merlin_intake_action_cards', 'notification_tracking_id', 'TEXT');
  ensureColumn(nextDb, 'merlin_intake_action_cards', 'notification_link', 'TEXT');
  ensureColumn(nextDb, 'merlin_intake_action_cards', 'notification_opened_at', 'TEXT');
  ensureColumn(nextDb, 'merlin_intake_action_cards', 'notification_open_count', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(nextDb, 'merlin_intake_action_cards', 'notification_last_opened_at', 'TEXT');
  ensureColumn(nextDb, 'merlin_intake_action_cards', 'notification_claim_started_at', 'TEXT');
  ensureColumn(nextDb, 'merlin_intake_action_cards', 'notification_review_started_at', 'TEXT');
  ensureColumn(nextDb, 'merlin_intake_action_cards', 'notification_audit_events_json', 'TEXT');
  ensureColumn(nextDb, 'merlin_intake_action_cards', 'submitted_by_user_id', 'TEXT');
  ensureColumn(nextDb, 'merlin_intake_action_cards', 'affiliate_id', 'TEXT');
  ensureColumn(nextDb, 'merlin_intake_action_cards', 'affiliate_code', 'TEXT');
  ensureColumn(nextDb, 'merlin_intake_action_cards', 'submission_source', 'TEXT');
  ensureColumn(nextDb, 'merlin_intake_action_cards', 'attribution_snapshot_json', 'TEXT');
  ensureColumn(nextDb, 'merlin_intake_action_cards', 'affiliate_audit_state', "TEXT NOT NULL DEFAULT 'not_reviewed'");
  ensureColumn(nextDb, 'merlin_intake_action_cards', 'affiliate_audit_reason', 'TEXT');
  ensureColumn(nextDb, 'merlin_intake_action_cards', 'affiliate_audit_by', 'TEXT');
  ensureColumn(nextDb, 'merlin_intake_action_cards', 'affiliate_audit_at', 'TEXT');
  ensureColumn(nextDb, 'merlin_intake_action_cards', 'affiliate_evidence_score', 'REAL');
  ensureColumn(nextDb, 'merlin_intake_action_cards', 'affiliate_qualified_signals_json', 'TEXT');
  ensureColumn(nextDb, 'merlin_intake_action_cards', 'affiliate_disqualifying_signals_json', 'TEXT');
  ensureColumn(nextDb, 'merlin_intake_action_cards', 'payout_ready', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(nextDb, 'merlin_intake_action_cards', 'payout_ready_at', 'TEXT');
  ensureColumn(nextDb, 'merlin_intake_action_cards', 'payout_ready_by', 'TEXT');
  ensureColumn(nextDb, 'merlin_intake_action_cards', 'payout_ready_reason', 'TEXT');
  ensureColumn(nextDb, 'merlin_intake_action_cards', 'quality_score', 'REAL');
  ensureColumn(nextDb, 'merlin_intake_action_cards', 'quality_band', "TEXT NOT NULL DEFAULT 'unscored'");
  ensureColumn(nextDb, 'merlin_intake_action_cards', 'quality_signals_json', 'TEXT');
  ensureColumn(nextDb, 'merlin_intake_action_cards', 'quality_warnings_json', 'TEXT');
  ensureColumn(nextDb, 'merlin_intake_action_cards', 'quality_scored_at', 'TEXT');
  ensureColumn(nextDb, 'merlin_intake_action_cards', 'quality_scored_by', 'TEXT');
  ensureColumn(nextDb, 'merlin_intake_action_cards', 'quality_score_version', 'TEXT');
  ensureColumn(nextDb, 'merlin_intake_action_cards', 'manual_notification_recipient', 'TEXT');
  ensureColumn(nextDb, 'merlin_intake_action_cards', 'manual_notification_recipient_type', 'TEXT');
  ensureColumn(nextDb, 'merlin_intake_action_cards', 'manual_notification_recipient_source', 'TEXT');
  ensureColumn(nextDb, 'merlin_intake_action_cards', 'manual_notification_recipient_reason', 'TEXT');
  ensureColumn(nextDb, 'merlin_intake_action_cards', 'manual_notification_recipient_by', 'TEXT');
  ensureColumn(nextDb, 'merlin_intake_action_cards', 'manual_notification_recipient_at', 'TEXT');
  ensureColumn(nextDb, 'merlin_intake_action_cards', 'added_contact_evidence_file_ids_json', 'TEXT');
  ensureColumn(nextDb, 'merlin_intake_action_cards', 'added_contact_evidence_file_names_json', 'TEXT');
  ensureColumn(nextDb, 'merlin_intake_action_cards', 'added_contact_evidence_at', 'TEXT');
  ensureColumn(nextDb, 'merlin_intake_action_cards', 'added_contact_evidence_by', 'TEXT');
  ensureColumn(nextDb, 'merlin_intake_action_cards', 'added_contact_evidence_reason', 'TEXT');
  ensureColumn(nextDb, 'merlin_intake_action_cards', 'contact_reprocess_result_json', 'TEXT');
  db = nextDb;
  dbPath = nextPath;
  return nextPath;
}

export function closeActionCardQueueStore(): void {
  if (!db) return;
  db.close();
  db = null;
  dbPath = null;
}

export function rememberActionCards(cards: MerlinActionCard[], batchId?: string): StoredActionCard[] {
  const db = getDb();
  const selectStmt = db.prepare('SELECT * FROM merlin_intake_action_cards WHERE id = ?');
  const insertStmt = db.prepare(`
    INSERT INTO merlin_intake_action_cards (
      id,batch_id,type,title,entity_type,confidence,source_file_ids_json,extracted_fields_json,missing_fields_json,
      existing_entity_match_json,recommended_action,mutation_allowed,duplicate_warnings_json,conflict_warnings_json,replacement_candidate_json,
      decision_state,decision_by,decision_at,decision_reason,apply_state,applied_by,applied_at,apply_result_json,apply_error,
      notification_state,notification_recipient,notification_channel,notification_preview,notification_sent_by,notification_sent_at,notification_result_json,notification_error,
      notification_tracking_id,notification_link,notification_opened_at,notification_open_count,notification_last_opened_at,notification_claim_started_at,notification_review_started_at,notification_audit_events_json,
      submitted_by_user_id,affiliate_id,affiliate_code,submission_source,attribution_snapshot_json,
      affiliate_audit_state,affiliate_audit_reason,affiliate_audit_by,affiliate_audit_at,affiliate_evidence_score,affiliate_qualified_signals_json,affiliate_disqualifying_signals_json,payout_ready,payout_ready_at,payout_ready_by,payout_ready_reason,
      quality_score,quality_band,quality_signals_json,quality_warnings_json,quality_scored_at,quality_scored_by,quality_score_version,
      created_at,updated_at
    ) VALUES (
      @id,@batch_id,@type,@title,@entity_type,@confidence,@source_file_ids_json,@extracted_fields_json,@missing_fields_json,
      @existing_entity_match_json,@recommended_action,@mutation_allowed,@duplicate_warnings_json,@conflict_warnings_json,@replacement_candidate_json,
      @decision_state,@decision_by,@decision_at,@decision_reason,@apply_state,@applied_by,@applied_at,@apply_result_json,@apply_error,
      @notification_state,@notification_recipient,@notification_channel,@notification_preview,@notification_sent_by,@notification_sent_at,@notification_result_json,@notification_error,
      @notification_tracking_id,@notification_link,@notification_opened_at,@notification_open_count,@notification_last_opened_at,@notification_claim_started_at,@notification_review_started_at,@notification_audit_events_json,
      @submitted_by_user_id,@affiliate_id,@affiliate_code,@submission_source,@attribution_snapshot_json,
      @affiliate_audit_state,@affiliate_audit_reason,@affiliate_audit_by,@affiliate_audit_at,@affiliate_evidence_score,@affiliate_qualified_signals_json,@affiliate_disqualifying_signals_json,@payout_ready,@payout_ready_at,@payout_ready_by,@payout_ready_reason,
      @quality_score,@quality_band,@quality_signals_json,@quality_warnings_json,@quality_scored_at,@quality_scored_by,@quality_score_version,
      @created_at,@updated_at
    )
  `);
  const updateStmt = db.prepare(`
    UPDATE merlin_intake_action_cards
    SET batch_id = COALESCE(@batch_id, batch_id),
        type = @type,
        title = @title,
        entity_type = @entity_type,
        confidence = @confidence,
        source_file_ids_json = @source_file_ids_json,
        extracted_fields_json = @extracted_fields_json,
        missing_fields_json = @missing_fields_json,
        existing_entity_match_json = @existing_entity_match_json,
        recommended_action = @recommended_action,
        mutation_allowed = @mutation_allowed,
        duplicate_warnings_json = @duplicate_warnings_json,
        conflict_warnings_json = @conflict_warnings_json,
        replacement_candidate_json = @replacement_candidate_json,
        updated_at = @updated_at
    WHERE id = @id
  `);

  const createdAt = nowIso();
  const updatedAt = nowIso();
  const tx = db.transaction((rows: MerlinActionCard[]) => {
    for (const row of rows) {
      const payload = {
        id: row.id,
        batch_id: batchId || null,
        type: row.type,
        title: row.title,
        entity_type: row.entityType,
        confidence: row.confidence,
        source_file_ids_json: JSON.stringify(row.sourceFileIds || []),
        extracted_fields_json: JSON.stringify(row.extractedFields || {}),
        missing_fields_json: JSON.stringify(row.missingFields || []),
        existing_entity_match_json: row.existingEntityMatch ? JSON.stringify(row.existingEntityMatch) : null,
        recommended_action: row.recommendedAction,
        mutation_allowed: 0,
        duplicate_warnings_json: JSON.stringify(row.duplicateWarnings || []),
        conflict_warnings_json: JSON.stringify(row.conflictWarnings || []),
        replacement_candidate_json: row.replacementCandidate ? JSON.stringify(row.replacementCandidate) : null,
        decision_state: 'pending',
        decision_by: null,
        decision_at: null,
        decision_reason: null,
        apply_state: 'not_applied',
        applied_by: null,
        applied_at: null,
        apply_result_json: null,
        apply_error: null,
        notification_state: 'not_ready',
        notification_recipient: null,
        notification_channel: null,
        notification_preview: null,
        notification_sent_by: null,
        notification_sent_at: null,
        notification_result_json: null,
        notification_error: null,
        notification_tracking_id: null,
        notification_link: null,
        notification_opened_at: null,
        notification_open_count: 0,
        notification_last_opened_at: null,
        notification_claim_started_at: null,
        notification_review_started_at: null,
        notification_audit_events_json: JSON.stringify([]),
        submitted_by_user_id: null,
        affiliate_id: null,
        affiliate_code: null,
        submission_source: null,
        attribution_snapshot_json: null,
        affiliate_audit_state: 'not_reviewed',
        affiliate_audit_reason: null,
        affiliate_audit_by: null,
        affiliate_audit_at: null,
        affiliate_evidence_score: null,
        affiliate_qualified_signals_json: JSON.stringify([]),
        affiliate_disqualifying_signals_json: JSON.stringify([]),
        payout_ready: 0,
        payout_ready_at: null,
        payout_ready_by: null,
        payout_ready_reason: null,
        quality_score: null,
        quality_band: 'unscored',
        quality_signals_json: JSON.stringify([]),
        quality_warnings_json: JSON.stringify([]),
        quality_scored_at: null,
        quality_scored_by: null,
        quality_score_version: null,
        created_at: createdAt,
        updated_at: updatedAt
      };
      const existing = selectStmt.get(row.id) as ActionCardRow | undefined;
      if (!existing) {
        insertStmt.run(payload);
      } else {
        // Preserve existing decision/apply state while refreshing evidence payload.
        updateStmt.run(payload);
      }
    }
  });
  tx(cards);

  const rows = cards
    .map((card) => selectStmt.get(card.id) as ActionCardRow | undefined)
    .filter((row): row is ActionCardRow => Boolean(row));
  return rows.map(mapRow);
}

export function getActionCard(cardId: string): StoredActionCard | undefined {
  const row = getDb().prepare('SELECT * FROM merlin_intake_action_cards WHERE id = ?').get(cardId) as ActionCardRow | undefined;
  return row ? mapRow(row) : undefined;
}

export function updateActionCardDecision(input: {
  cardId: string;
  decisionState: 'approved_for_apply' | 'rejected' | 'deferred';
  decisionBy: string;
  decisionReason?: string | null;
}): StoredActionCard | undefined {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM merlin_intake_action_cards WHERE id = ?').get(input.cardId) as ActionCardRow | undefined;
  if (!existing) return undefined;
  const decisionAt = nowIso();
  db.prepare(`
    UPDATE merlin_intake_action_cards
    SET decision_state = ?, decision_by = ?, decision_at = ?, decision_reason = ?, updated_at = ?
    WHERE id = ?
  `).run(input.decisionState, input.decisionBy, decisionAt, input.decisionReason ?? null, decisionAt, input.cardId);
  const row = db.prepare('SELECT * FROM merlin_intake_action_cards WHERE id = ?').get(input.cardId) as ActionCardRow;
  return mapRow(row);
}

export function updateActionCardApplyState(input: {
  cardId: string;
  applyState: 'applied' | 'apply_failed';
  appliedBy: string;
  applyResult?: Record<string, unknown> | null;
  applyError?: string | null;
}): StoredActionCard | undefined {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM merlin_intake_action_cards WHERE id = ?').get(input.cardId) as ActionCardRow | undefined;
  if (!existing) return undefined;
  const appliedAt = nowIso();
  db.prepare(`
    UPDATE merlin_intake_action_cards
    SET apply_state = ?, applied_by = ?, applied_at = ?, apply_result_json = ?, apply_error = ?, updated_at = ?
    WHERE id = ?
  `).run(
    input.applyState,
    input.appliedBy,
    appliedAt,
    input.applyResult ? JSON.stringify(input.applyResult) : null,
    input.applyError ?? null,
    appliedAt,
    input.cardId
  );
  const row = db.prepare('SELECT * FROM merlin_intake_action_cards WHERE id = ?').get(input.cardId) as ActionCardRow;
  return mapRow(row);
}

export function updateActionCardNotificationState(input: {
  cardId: string;
  notificationState: StoredActionCard['notificationState'];
  notificationRecipient?: string | null;
  notificationChannel?: StoredActionCard['notificationChannel'];
  notificationPreview?: string | null;
  notificationSentBy?: string | null;
  notificationSentAt?: string | null;
  notificationResult?: Record<string, unknown> | null;
  notificationError?: string | null;
  notificationTrackingId?: string | null;
  notificationLink?: string | null;
  notificationOpenedAt?: string | null;
  notificationOpenCount?: number;
  notificationLastOpenedAt?: string | null;
  notificationClaimStartedAt?: string | null;
  notificationReviewStartedAt?: string | null;
  notificationAuditEvents?: Array<{ type: string; at: string; by?: string | null; details?: Record<string, unknown> }>;
}): StoredActionCard | undefined {
  const database = getDb();
  const existing = database.prepare('SELECT * FROM merlin_intake_action_cards WHERE id = ?').get(input.cardId) as ActionCardRow | undefined;
  if (!existing) return undefined;
  const updatedAt = nowIso();
  database.prepare(`
    UPDATE merlin_intake_action_cards
    SET notification_state = ?, notification_recipient = ?, notification_channel = ?, notification_preview = ?,
        notification_sent_by = ?, notification_sent_at = ?, notification_result_json = ?, notification_error = ?,
        notification_tracking_id = ?, notification_link = ?, notification_opened_at = ?, notification_open_count = ?,
        notification_last_opened_at = ?, notification_claim_started_at = ?, notification_review_started_at = ?,
        notification_audit_events_json = ?, updated_at = ?
    WHERE id = ?
  `).run(
    input.notificationState,
    input.notificationRecipient ?? null,
    input.notificationChannel ?? null,
    input.notificationPreview ?? null,
    input.notificationSentBy ?? null,
    input.notificationSentAt ?? null,
    input.notificationResult ? JSON.stringify(input.notificationResult) : null,
    input.notificationError ?? null,
    input.notificationTrackingId ?? existing.notification_tracking_id ?? null,
    input.notificationLink ?? existing.notification_link ?? null,
    input.notificationOpenedAt ?? existing.notification_opened_at ?? null,
    typeof input.notificationOpenCount === 'number' ? input.notificationOpenCount : Number(existing.notification_open_count || 0),
    input.notificationLastOpenedAt ?? existing.notification_last_opened_at ?? null,
    input.notificationClaimStartedAt ?? existing.notification_claim_started_at ?? null,
    input.notificationReviewStartedAt ?? existing.notification_review_started_at ?? null,
    JSON.stringify(input.notificationAuditEvents || parseJson(existing.notification_audit_events_json, [])),
    updatedAt,
    input.cardId
  );
  const row = database.prepare('SELECT * FROM merlin_intake_action_cards WHERE id = ?').get(input.cardId) as ActionCardRow;
  return mapRow(row);
}

export function updateActionCardManualRecipient(input: {
  cardId: string;
  recipient: string;
  recipientType: 'email' | 'phone' | 'social' | 'other';
  recipientSource: 'manual_verified' | 'known_contact' | 'social_profile' | 'operator_supplied';
  reason: string;
  decidedBy: string;
}): StoredActionCard | undefined {
  const database = getDb();
  const existing = database.prepare('SELECT * FROM merlin_intake_action_cards WHERE id = ?').get(input.cardId) as ActionCardRow | undefined;
  if (!existing) return undefined;
  const updatedAt = nowIso();
  database.prepare(`
    UPDATE merlin_intake_action_cards
    SET manual_notification_recipient = ?,
        manual_notification_recipient_type = ?,
        manual_notification_recipient_source = ?,
        manual_notification_recipient_reason = ?,
        manual_notification_recipient_by = ?,
        manual_notification_recipient_at = ?,
        updated_at = ?
    WHERE id = ?
  `).run(
    input.recipient,
    input.recipientType,
    input.recipientSource,
    input.reason,
    input.decidedBy,
    updatedAt,
    updatedAt,
    input.cardId
  );
  const row = database.prepare('SELECT * FROM merlin_intake_action_cards WHERE id = ?').get(input.cardId) as ActionCardRow;
  return mapRow(row);
}

export function updateActionCardContactEvidence(input: {
  cardId: string;
  fileIds: string[];
  fileNames: string[];
  reason: string;
  decidedBy: string;
  contactReprocessResult: Record<string, unknown>;
  extractedFields: Record<string, unknown>;
}): StoredActionCard | undefined {
  const database = getDb();
  const existing = database.prepare('SELECT * FROM merlin_intake_action_cards WHERE id = ?').get(input.cardId) as ActionCardRow | undefined;
  if (!existing) return undefined;
  const updatedAt = nowIso();
  const priorIds = parseJson<string[]>(existing.added_contact_evidence_file_ids_json, []);
  const priorNames = parseJson<string[]>(existing.added_contact_evidence_file_names_json, []);
  const mergedIds = Array.from(new Set([...priorIds, ...(input.fileIds || [])]));
  const mergedNames = Array.from(new Set([...priorNames, ...(input.fileNames || [])]));
  database.prepare(`
    UPDATE merlin_intake_action_cards
    SET extracted_fields_json = ?,
        added_contact_evidence_file_ids_json = ?,
        added_contact_evidence_file_names_json = ?,
        added_contact_evidence_at = ?,
        added_contact_evidence_by = ?,
        added_contact_evidence_reason = ?,
        contact_reprocess_result_json = ?,
        updated_at = ?
    WHERE id = ?
  `).run(
    JSON.stringify(input.extractedFields || {}),
    JSON.stringify(mergedIds),
    JSON.stringify(mergedNames),
    updatedAt,
    input.decidedBy,
    input.reason,
    JSON.stringify(input.contactReprocessResult || {}),
    updatedAt,
    input.cardId
  );
  const row = database.prepare('SELECT * FROM merlin_intake_action_cards WHERE id = ?').get(input.cardId) as ActionCardRow;
  return mapRow(row);
}

export function listActionCards(): StoredActionCard[] {
  const rows = getDb().prepare('SELECT * FROM merlin_intake_action_cards ORDER BY created_at DESC, id DESC').all() as ActionCardRow[];
  return rows.map(mapRow);
}

export function listActionCardsByBatch(batchId: string): StoredActionCard[] {
  const rows = getDb()
    .prepare('SELECT * FROM merlin_intake_action_cards WHERE batch_id = ? ORDER BY created_at DESC, id DESC')
    .all(batchId) as ActionCardRow[];
  return rows.map(mapRow);
}

export function findActionCardByNotificationTrackingId(trackingId: string): StoredActionCard | undefined {
  const row = getDb()
    .prepare('SELECT * FROM merlin_intake_action_cards WHERE notification_tracking_id = ?')
    .get(trackingId) as ActionCardRow | undefined;
  return row ? mapRow(row) : undefined;
}

export function updateActionCardsBatchAttribution(input: {
  batchId: string;
  submittedByUserId?: string | null;
  affiliateId?: string | null;
  affiliateCode?: string | null;
  submissionSource?: string | null;
  attributionSnapshot?: Record<string, unknown> | null;
}): number {
  const database = getDb();
  const updatedAt = nowIso();
  const result = database
    .prepare(`
      UPDATE merlin_intake_action_cards
      SET submitted_by_user_id = COALESCE(?, submitted_by_user_id),
          affiliate_id = COALESCE(?, affiliate_id),
          affiliate_code = COALESCE(?, affiliate_code),
          submission_source = COALESCE(?, submission_source),
          attribution_snapshot_json = COALESCE(?, attribution_snapshot_json),
          updated_at = ?
      WHERE batch_id = ?
    `)
    .run(
      input.submittedByUserId ?? null,
      input.affiliateId ?? null,
      input.affiliateCode ?? null,
      input.submissionSource ?? null,
      input.attributionSnapshot ? JSON.stringify(input.attributionSnapshot) : null,
      updatedAt,
      input.batchId
    );
  return result.changes;
}

export function updateActionCardAffiliateAudit(input: {
  cardId: string;
  affiliateAuditState: 'reviewable' | 'approved_for_payout_review' | 'rejected_for_payout_review' | 'needs_more_evidence';
  affiliateAuditBy: string;
  affiliateAuditReason?: string | null;
  affiliateEvidenceScore?: number | null;
  affiliateQualifiedSignals?: string[];
  affiliateDisqualifyingSignals?: string[];
  payoutReady?: boolean;
  payoutReadyReason?: string | null;
  payoutReadyBy?: string | null;
}): StoredActionCard | undefined {
  const database = getDb();
  const existing = database.prepare('SELECT * FROM merlin_intake_action_cards WHERE id = ?').get(input.cardId) as ActionCardRow | undefined;
  if (!existing) return undefined;
  const updatedAt = nowIso();
  const affiliateAuditAt = updatedAt;
  const payoutReady = input.payoutReady === true ? 1 : 0;
  const payoutReadyAt = payoutReady ? updatedAt : null;
  database.prepare(`
    UPDATE merlin_intake_action_cards
    SET affiliate_audit_state = ?, affiliate_audit_reason = ?, affiliate_audit_by = ?, affiliate_audit_at = ?,
        affiliate_evidence_score = ?, affiliate_qualified_signals_json = ?, affiliate_disqualifying_signals_json = ?,
        payout_ready = ?, payout_ready_at = ?, payout_ready_by = ?, payout_ready_reason = ?, updated_at = ?
    WHERE id = ?
  `).run(
    input.affiliateAuditState,
    input.affiliateAuditReason ?? null,
    input.affiliateAuditBy,
    affiliateAuditAt,
    typeof input.affiliateEvidenceScore === 'number' ? input.affiliateEvidenceScore : null,
    JSON.stringify(input.affiliateQualifiedSignals || []),
    JSON.stringify(input.affiliateDisqualifyingSignals || []),
    payoutReady,
    payoutReadyAt,
    payoutReady ? (input.payoutReadyBy || input.affiliateAuditBy) : null,
    payoutReady ? (input.payoutReadyReason ?? input.affiliateAuditReason ?? null) : null,
    updatedAt,
    input.cardId
  );
  const row = database.prepare('SELECT * FROM merlin_intake_action_cards WHERE id = ?').get(input.cardId) as ActionCardRow;
  return mapRow(row);
}

export function resetActionCardQueueForTest(): void {
  getDb().prepare('DELETE FROM merlin_intake_action_cards').run();
}

export function updateActionCardQuality(input: {
  cardId: string;
  qualityScore?: number | null;
  qualityBand: 'unscored' | 'high' | 'medium' | 'low' | 'blocked';
  qualitySignals?: string[];
  qualityWarnings?: string[];
  qualityScoredBy: string;
  qualityScoreVersion?: string | null;
}): StoredActionCard | undefined {
  const database = getDb();
  const existing = database.prepare('SELECT * FROM merlin_intake_action_cards WHERE id = ?').get(input.cardId) as ActionCardRow | undefined;
  if (!existing) return undefined;
  const updatedAt = nowIso();
  database.prepare(`
    UPDATE merlin_intake_action_cards
    SET quality_score = ?, quality_band = ?, quality_signals_json = ?, quality_warnings_json = ?,
        quality_scored_at = ?, quality_scored_by = ?, quality_score_version = ?, updated_at = ?
    WHERE id = ?
  `).run(
    typeof input.qualityScore === 'number' ? input.qualityScore : null,
    input.qualityBand,
    JSON.stringify(input.qualitySignals || []),
    JSON.stringify(input.qualityWarnings || []),
    updatedAt,
    input.qualityScoredBy,
    input.qualityScoreVersion ?? null,
    updatedAt,
    input.cardId
  );
  const row = database.prepare('SELECT * FROM merlin_intake_action_cards WHERE id = ?').get(input.cardId) as ActionCardRow;
  return mapRow(row);
}
