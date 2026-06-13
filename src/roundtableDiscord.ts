import { createPublicKey, randomUUID, timingSafeEqual, verify as verifySignature } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';

export type RoundTableDiscordAudience = 'roundtable' | 'albion_ai_council' | 'merlin_ops' | 'human_knights';

export type RoundTableDiscordPacket = {
  packetId: string;
  audience: RoundTableDiscordAudience;
  title: string;
  body: string;
  source: 'merlin' | 'albion_ai_council' | 'roundtable' | 'system';
  sourceRefs?: string[];
  approvedActionScopes: string[];
  authority: {
    routedBy: 'RoundTable' | 'Merlin';
    governedBy: 'Albion/AI Council';
    requiresHumanReview: boolean;
    escalationPath?: string[];
  };
  metadata?: Record<string, unknown>;
};

export type RoundTableDiscordWebhookPayload = {
  username: string;
  allowed_mentions: { parse: string[] };
  content: string;
  embeds: Array<{
    title: string;
    description: string;
    color: number;
    fields: Array<{ name: string; value: string; inline?: boolean }>;
    footer: { text: string };
    timestamp: string;
  }>;
  components?: Array<{
    type: 1;
    components: Array<{ type: 2; style: 3; label: string; custom_id: string }>;
  }>;
};

export type RoundTableDiscordDeliveryAttempt = {
  attemptId: string;
  packetId: string;
  status: 'sent' | 'failed';
  providerMessageId?: string;
  failureReason?: string;
  detail?: string;
  attemptedAt: string;
  webhookConfigured: boolean;
  payloadPreview: RoundTableDiscordWebhookPayload;
};

export type RoundTableDiscordVerifiedApprovalRecord = {
  approvalId: string;
  packetId: string;
  actionScope: string;
  discordInteractionId: string;
  discordUserId: string;
  discordGuildId: string;
  discordChannelId: string;
  discordRoleIds: string[];
  signatureVerified: true;
  allowlistedUserVerified: true;
  guildVerified: true;
  channelVerified: true;
  roleVerified: true;
  approvedAt: string;
  evidence: {
    packetId: string;
    actionScope: string;
    sourceRefs: string[];
    verificationChecks: string[];
  };
};

export type RoundTableDiscordEvidencePacket = {
  packetId?: string;
  actionScope?: string;
  bridge: 'merlin_discord_runtime';
  outcome: 'delivery_sent' | 'delivery_failed' | 'approval_verified' | 'approval_rejected';
  evidenceRefs: string[];
  checks: Array<{ name: string; passed: boolean; detail?: string }>;
  deliveryAttempt?: RoundTableDiscordDeliveryAttempt;
  verifiedApprovalRecord?: RoundTableDiscordVerifiedApprovalRecord;
  noExecutionPerformed: true;
  createdAt: string;
};

export type RoundTableDiscordApprovalResult =
  | {
      status: 'verified';
      verifiedApprovalRecord: RoundTableDiscordVerifiedApprovalRecord;
      roundTableEvidencePacket: RoundTableDiscordEvidencePacket;
    }
  | {
      status: 'rejected';
      failureReason: string;
      roundTableEvidencePacket: RoundTableDiscordEvidencePacket;
    };

type PacketRow = { packet_id: string; packet_json: string };
type DeliveryAttemptRow = {
  attempt_id: string;
  packet_id: string;
  status: 'sent' | 'failed';
  provider_message_id: string | null;
  failure_reason: string | null;
  detail: string | null;
  attempted_at: string;
  webhook_configured: number;
  payload_json: string;
};
type VerifiedApprovalRow = {
  approval_id: string;
  packet_id: string;
  action_scope: string;
  discord_interaction_id: string;
  discord_user_id: string;
  discord_guild_id: string;
  discord_channel_id: string;
  discord_role_ids_json: string;
  approved_at: string;
  evidence_json: string;
};

const DEFAULT_DB_PATH = './data/merlin-or.sqlite';
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
let db: Database.Database | null = null;
let dbPath: string | null = null;

function resolveDbPath(explicitPath?: string): string {
  return resolve(process.cwd(), explicitPath || process.env.MERLIN_DB_PATH || DEFAULT_DB_PATH);
}

function getDb(): Database.Database {
  if (!db) initializeRoundTableDiscordStore();
  return db as Database.Database;
}

function nowIso(): string {
  return new Date().toISOString();
}

function envList(name: string): string[] {
  return (process.env[name] || '').split(',').map((entry) => entry.trim()).filter(Boolean);
}

function safeEqual(value: string, expected: string): boolean {
  const left = Buffer.from(value);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function audienceLabel(audience: RoundTableDiscordAudience): string {
  if (audience === 'albion_ai_council') return 'Albion/AI Council';
  if (audience === 'merlin_ops') return 'Merlin Ops';
  if (audience === 'human_knights') return 'Human Knights';
  return 'RoundTable';
}

function normalizePacket(packet: RoundTableDiscordPacket): RoundTableDiscordPacket {
  return {
    ...packet,
    packetId: packet.packetId.trim(),
    title: packet.title.trim(),
    body: packet.body.trim(),
    sourceRefs: Array.from(new Set((packet.sourceRefs || []).map((ref) => ref.trim()).filter(Boolean))),
    approvedActionScopes: Array.from(new Set(packet.approvedActionScopes.map((scope) => scope.trim()).filter(Boolean)))
  };
}

function customId(packetId: string, actionScope: string): string {
  return `roundtable.approve:${encodeURIComponent(packetId)}:${encodeURIComponent(actionScope)}`;
}

function parseCustomId(value?: string): { packetId?: string; actionScope?: string; error?: string } {
  const parts = (value || '').trim().split(':');
  if (parts.length !== 3 || parts[0] !== 'roundtable.approve') return { error: 'unsupported_discord_custom_id' };
  try {
    return { packetId: decodeURIComponent(parts[1]), actionScope: decodeURIComponent(parts[2]) };
  } catch {
    return { error: 'invalid_discord_custom_id_encoding' };
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function initializeRoundTableDiscordStore(explicitPath?: string): string {
  const nextPath = resolveDbPath(explicitPath);
  if (dbPath === nextPath && db) return nextPath;
  if (db) db.close();
  mkdirSync(dirname(nextPath), { recursive: true });
  db = new Database(nextPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS roundtable_discord_packets (
      packet_id TEXT PRIMARY KEY,
      packet_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS roundtable_discord_delivery_attempts (
      attempt_id TEXT PRIMARY KEY,
      packet_id TEXT NOT NULL,
      status TEXT NOT NULL,
      provider_message_id TEXT,
      failure_reason TEXT,
      detail TEXT,
      attempted_at TEXT NOT NULL,
      webhook_configured INTEGER NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS roundtable_discord_verified_approvals (
      approval_id TEXT PRIMARY KEY,
      packet_id TEXT NOT NULL,
      action_scope TEXT NOT NULL,
      discord_interaction_id TEXT NOT NULL,
      discord_user_id TEXT NOT NULL,
      discord_guild_id TEXT NOT NULL,
      discord_channel_id TEXT NOT NULL,
      discord_role_ids_json TEXT NOT NULL,
      approved_at TEXT NOT NULL,
      evidence_json TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS roundtable_discord_verified_approval_scope_idx
      ON roundtable_discord_verified_approvals(packet_id, action_scope, discord_user_id);
  `);
  dbPath = nextPath;
  return nextPath;
}

export function closeRoundTableDiscordStore(): void {
  if (!db) return;
  db.close();
  db = null;
  dbPath = null;
}

export function resetRoundTableDiscordForTest(): void {
  if (process.env.MERLIN_RUNTIME !== 'test') return;
  getDb().exec(`
    DELETE FROM roundtable_discord_verified_approvals;
    DELETE FROM roundtable_discord_delivery_attempts;
    DELETE FROM roundtable_discord_packets;
  `);
}

export function rememberRoundTableDiscordPacket(packetInput: RoundTableDiscordPacket): RoundTableDiscordPacket {
  const packet = normalizePacket(packetInput);
  if (!packet.packetId) throw new Error('packetId is required');
  if (!packet.title) throw new Error('title is required');
  if (!packet.body) throw new Error('body is required');
  if (packet.approvedActionScopes.length === 0) throw new Error('approvedActionScopes is required');
  getDb()
    .prepare(
      `INSERT INTO roundtable_discord_packets (packet_id, packet_json, created_at)
       VALUES (?, ?, ?)
       ON CONFLICT(packet_id) DO UPDATE SET packet_json = excluded.packet_json`
    )
    .run(packet.packetId, JSON.stringify(packet), nowIso());
  return packet;
}

export function getRoundTableDiscordPacket(packetId: string): RoundTableDiscordPacket | undefined {
  const row = getDb().prepare('SELECT * FROM roundtable_discord_packets WHERE packet_id = ?').get(packetId) as PacketRow | undefined;
  return row ? JSON.parse(row.packet_json) as RoundTableDiscordPacket : undefined;
}

function toDeliveryAttempt(row: DeliveryAttemptRow): RoundTableDiscordDeliveryAttempt {
  return {
    attemptId: row.attempt_id,
    packetId: row.packet_id,
    status: row.status,
    providerMessageId: row.provider_message_id || undefined,
    failureReason: row.failure_reason || undefined,
    detail: row.detail || undefined,
    attemptedAt: row.attempted_at,
    webhookConfigured: row.webhook_configured === 1,
    payloadPreview: JSON.parse(row.payload_json) as RoundTableDiscordWebhookPayload
  };
}

function toVerifiedApproval(row: VerifiedApprovalRow): RoundTableDiscordVerifiedApprovalRecord {
  return {
    approvalId: row.approval_id,
    packetId: row.packet_id,
    actionScope: row.action_scope,
    discordInteractionId: row.discord_interaction_id,
    discordUserId: row.discord_user_id,
    discordGuildId: row.discord_guild_id,
    discordChannelId: row.discord_channel_id,
    discordRoleIds: JSON.parse(row.discord_role_ids_json) as string[],
    signatureVerified: true,
    allowlistedUserVerified: true,
    guildVerified: true,
    channelVerified: true,
    roleVerified: true,
    approvedAt: row.approved_at,
    evidence: JSON.parse(row.evidence_json) as RoundTableDiscordVerifiedApprovalRecord['evidence']
  };
}

export function getRoundTableDiscordDeliveryAttempts(packetId: string): RoundTableDiscordDeliveryAttempt[] {
  const rows = getDb()
    .prepare('SELECT * FROM roundtable_discord_delivery_attempts WHERE packet_id = ? ORDER BY attempted_at DESC')
    .all(packetId) as DeliveryAttemptRow[];
  return rows.map(toDeliveryAttempt);
}

export function getRoundTableDiscordVerifiedApprovals(packetId: string): RoundTableDiscordVerifiedApprovalRecord[] {
  const rows = getDb()
    .prepare('SELECT * FROM roundtable_discord_verified_approvals WHERE packet_id = ? ORDER BY approved_at DESC')
    .all(packetId) as VerifiedApprovalRow[];
  return rows.map(toVerifiedApproval);
}

export function buildRoundTableDiscordPayload(packetInput: RoundTableDiscordPacket): RoundTableDiscordWebhookPayload {
  const packet = normalizePacket(packetInput);
  const primaryScope = packet.approvedActionScopes[0];
  return {
    username: 'Merlin x Albion',
    allowed_mentions: { parse: [] },
    content: `[${audienceLabel(packet.audience)}] ${truncate(packet.title, 120)}`,
    embeds: [
      {
        title: truncate(packet.title, 256),
        description: truncate(packet.body, 3900),
        color: packet.authority.requiresHumanReview ? 0xd69e2e : 0x4a5568,
        fields: [
          { name: 'Packet ID', value: packet.packetId, inline: true },
          { name: 'Source', value: packet.source, inline: true },
          { name: 'Routed by', value: packet.authority.routedBy, inline: true },
          { name: 'Governed by', value: packet.authority.governedBy, inline: true },
          { name: 'Human review required', value: packet.authority.requiresHumanReview ? 'yes' : 'no', inline: true },
          { name: 'Approved action scopes', value: truncate(packet.approvedActionScopes.join('\n'), 1024) },
          { name: 'Escalation path', value: truncate((packet.authority.escalationPath || []).join(' -> ') || 'not specified', 1024) },
          { name: 'Source refs', value: truncate((packet.sourceRefs || []).join('\n') || 'none', 1024) }
        ],
        footer: { text: 'Discord carries human interaction. Merlin verifies interactions; Albion/AI Council governs authority.' },
        timestamp: nowIso()
      }
    ],
    components: primaryScope
      ? [{ type: 1, components: [{ type: 2, style: 3, label: 'Approve scoped action', custom_id: customId(packet.packetId, primaryScope) }] }]
      : undefined
  };
}

function evidenceForDelivery(attempt: RoundTableDiscordDeliveryAttempt): RoundTableDiscordEvidencePacket {
  return {
    packetId: attempt.packetId,
    bridge: 'merlin_discord_runtime',
    outcome: attempt.status === 'sent' ? 'delivery_sent' : 'delivery_failed',
    evidenceRefs: [`discord_attempt:${attempt.attemptId}`, `roundtable_packet:${attempt.packetId}`],
    checks: [
      { name: 'webhook_configured', passed: attempt.webhookConfigured },
      { name: 'delivery_sent', passed: attempt.status === 'sent', detail: attempt.failureReason || attempt.detail }
    ],
    deliveryAttempt: attempt,
    noExecutionPerformed: true,
    createdAt: nowIso()
  };
}

function saveDeliveryAttempt(input: Omit<RoundTableDiscordDeliveryAttempt, 'attemptId' | 'attemptedAt'>): RoundTableDiscordDeliveryAttempt {
  const attempt = { ...input, attemptId: `discord-attempt-${randomUUID()}`, attemptedAt: nowIso() };
  getDb()
    .prepare(
      `INSERT INTO roundtable_discord_delivery_attempts
       (attempt_id, packet_id, status, provider_message_id, failure_reason, detail, attempted_at, webhook_configured, payload_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      attempt.attemptId,
      attempt.packetId,
      attempt.status,
      attempt.providerMessageId || null,
      attempt.failureReason || null,
      attempt.detail || null,
      attempt.attemptedAt,
      attempt.webhookConfigured ? 1 : 0,
      JSON.stringify(attempt.payloadPreview)
    );
  return attempt;
}

export async function dispatchRoundTableDiscordPacket(packetInput: RoundTableDiscordPacket): Promise<{
  status: 'sent' | 'failed';
  deliveryAttempt: RoundTableDiscordDeliveryAttempt;
  roundTableEvidencePacket: RoundTableDiscordEvidencePacket;
}> {
  const packet = rememberRoundTableDiscordPacket(packetInput);
  const payload = buildRoundTableDiscordPayload(packet);
  const url = (process.env.ROUNDTABLE_DISCORD_WEBHOOK_URL || '').trim();
  if (!url) {
    const deliveryAttempt = saveDeliveryAttempt({
      packetId: packet.packetId,
      status: 'failed',
      failureReason: 'roundtable_discord_webhook_not_configured',
      detail: 'No RoundTable Discord webhook is configured. Merlin did not simulate or mark Discord delivery as sent.',
      webhookConfigured: false,
      payloadPreview: payload
    });
    return { status: 'failed', deliveryAttempt, roundTableEvidencePacket: evidenceForDelivery(deliveryAttempt) };
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = (process.env.ROUNDTABLE_DISCORD_WEBHOOK_TOKEN || '').trim();
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
    const text = await response.text();
    let parsed: Record<string, unknown> = {};
    if (text) {
      try {
        const body = JSON.parse(text) as unknown;
        if (isObject(body)) parsed = body;
      } catch {
        parsed = { raw: text };
      }
    }
    const deliveryAttempt = saveDeliveryAttempt({
      packetId: packet.packetId,
      status: response.ok ? 'sent' : 'failed',
      providerMessageId: response.ok && typeof parsed.id === 'string' ? parsed.id : undefined,
      failureReason: response.ok ? undefined : `roundtable_discord_webhook_http_${response.status}`,
      detail: typeof parsed.detail === 'string' ? parsed.detail : typeof parsed.error === 'string' ? parsed.error : text || undefined,
      webhookConfigured: true,
      payloadPreview: payload
    });
    return { status: deliveryAttempt.status, deliveryAttempt, roundTableEvidencePacket: evidenceForDelivery(deliveryAttempt) };
  } catch (error) {
    const deliveryAttempt = saveDeliveryAttempt({
      packetId: packet.packetId,
      status: 'failed',
      failureReason: error instanceof Error ? error.message : 'roundtable_discord_dispatch_failed',
      webhookConfigured: true,
      payloadPreview: payload
    });
    return { status: 'failed', deliveryAttempt, roundTableEvidencePacket: evidenceForDelivery(deliveryAttempt) };
  }
}

function publicKeyFromDiscordHex(publicKeyHex: string): ReturnType<typeof createPublicKey> {
  const raw = Buffer.from(publicKeyHex, 'hex');
  if (raw.length !== 32) throw new Error('discord_public_key_must_be_32_byte_hex');
  return createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, raw]), format: 'der', type: 'spki' });
}

export function verifyDiscordInteractionSignature(input: { rawBody: string; timestamp: string; signature: string; publicKeyHex?: string }): boolean {
  const publicKeyHex = input.publicKeyHex || (process.env.ROUNDTABLE_DISCORD_PUBLIC_KEY || '').trim();
  if (!publicKeyHex || !/^[0-9a-fA-F]{128}$/.test(input.signature)) return false;
  try {
    return verifySignature(
      null,
      Buffer.from(`${input.timestamp}${input.rawBody}`, 'utf8'),
      publicKeyFromDiscordHex(publicKeyHex),
      Buffer.from(input.signature, 'hex')
    );
  } catch {
    return false;
  }
}

function rejectApproval(
  failureReason: string,
  checks: Array<{ name: string; passed: boolean; detail?: string }>,
  packetId?: string,
  actionScope?: string
): RoundTableDiscordApprovalResult {
  return {
    status: 'rejected',
    failureReason,
    roundTableEvidencePacket: {
      packetId,
      actionScope,
      bridge: 'merlin_discord_runtime',
      outcome: 'approval_rejected',
      evidenceRefs: packetId ? [`roundtable_packet:${packetId}`] : [],
      checks,
      noExecutionPerformed: true,
      createdAt: nowIso()
    }
  };
}

function saveVerifiedApproval(input: Omit<RoundTableDiscordVerifiedApprovalRecord, 'approvalId' | 'approvedAt'>): RoundTableDiscordVerifiedApprovalRecord {
  const record = { ...input, approvalId: `discord-approval-${randomUUID()}`, approvedAt: nowIso() };
  getDb()
    .prepare(
      `INSERT INTO roundtable_discord_verified_approvals
       (approval_id, packet_id, action_scope, discord_interaction_id, discord_user_id, discord_guild_id,
        discord_channel_id, discord_role_ids_json, approved_at, evidence_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      record.approvalId,
      record.packetId,
      record.actionScope,
      record.discordInteractionId,
      record.discordUserId,
      record.discordGuildId,
      record.discordChannelId,
      JSON.stringify(record.discordRoleIds),
      record.approvedAt,
      JSON.stringify(record.evidence)
    );
  return record;
}

export function verifyAndWriteDiscordApproval(input: { rawBody: string; timestamp: string; signature: string; publicKeyHex?: string }): RoundTableDiscordApprovalResult {
  const checks: Array<{ name: string; passed: boolean; detail?: string }> = [];
  const addCheck = (name: string, passed: boolean, detail?: string): void => {
    checks.push({ name, passed, ...(detail ? { detail } : {}) });
  };

  const signatureVerified = verifyDiscordInteractionSignature(input);
  addCheck('discord_signature_verified', signatureVerified);
  if (!signatureVerified) return rejectApproval('discord_signature_invalid', checks);

  let body: {
    id?: string;
    type?: number;
    guild_id?: string;
    channel_id?: string;
    member?: { user?: { id?: string }; roles?: string[] };
    user?: { id?: string };
    data?: { custom_id?: string };
  };
  try {
    body = JSON.parse(input.rawBody);
  } catch {
    return rejectApproval('discord_interaction_invalid_json', checks);
  }
  if (body.type === 1) return rejectApproval('discord_ping_is_not_approval', checks);

  const parsed = parseCustomId(body.data?.custom_id);
  addCheck('custom_id_scope_valid', !parsed.error, parsed.error);
  if (parsed.error || !parsed.packetId || !parsed.actionScope) return rejectApproval(parsed.error || 'invalid_discord_custom_id', checks);

  const packet = getRoundTableDiscordPacket(parsed.packetId);
  addCheck('packet_exists', Boolean(packet), parsed.packetId);
  if (!packet) return rejectApproval('packet_not_found', checks, parsed.packetId, parsed.actionScope);

  const scopeAllowed = packet.approvedActionScopes.some((scope) => safeEqual(scope, parsed.actionScope!));
  addCheck('approved_action_scope_matches_packet', scopeAllowed, parsed.actionScope);
  if (!scopeAllowed) return rejectApproval('approved_action_scope_mismatch', checks, packet.packetId, parsed.actionScope);

  const userId = body.member?.user?.id || body.user?.id || '';
  const guildId = body.guild_id || '';
  const channelId = body.channel_id || '';
  const roleIds = body.member?.roles || [];
  const allowedUsers = envList('ROUNDTABLE_DISCORD_APPROVER_USER_IDS');
  const allowedGuild = (process.env.ROUNDTABLE_DISCORD_GUILD_ID || '').trim();
  const allowedChannels = envList('ROUNDTABLE_DISCORD_APPROVAL_CHANNEL_IDS');
  const allowedRoles = envList('ROUNDTABLE_DISCORD_APPROVER_ROLE_IDS');
  const userAllowed = allowedUsers.length > 0 && allowedUsers.some((entry) => safeEqual(entry, userId));
  const guildAllowed = Boolean(allowedGuild) && safeEqual(allowedGuild, guildId);
  const channelAllowed = allowedChannels.length > 0 && allowedChannels.some((entry) => safeEqual(entry, channelId));
  const roleAllowed = allowedRoles.length === 0 || roleIds.some((roleId) => allowedRoles.some((entry) => safeEqual(entry, roleId)));
  addCheck('allowlisted_user_verified', userAllowed, userId);
  addCheck('guild_verified', guildAllowed, guildId);
  addCheck('channel_verified', channelAllowed, channelId);
  addCheck('role_verified', roleAllowed, roleIds.join(',') || 'none');
  if (!userAllowed) return rejectApproval('discord_user_not_allowlisted', checks, packet.packetId, parsed.actionScope);
  if (!guildAllowed) return rejectApproval('discord_guild_not_allowed', checks, packet.packetId, parsed.actionScope);
  if (!channelAllowed) return rejectApproval('discord_channel_not_allowed', checks, packet.packetId, parsed.actionScope);
  if (!roleAllowed) return rejectApproval('discord_role_not_allowed', checks, packet.packetId, parsed.actionScope);

  const record = saveVerifiedApproval({
    packetId: packet.packetId,
    actionScope: parsed.actionScope,
    discordInteractionId: body.id || 'unknown-interaction',
    discordUserId: userId,
    discordGuildId: guildId,
    discordChannelId: channelId,
    discordRoleIds: roleIds,
    signatureVerified: true,
    allowlistedUserVerified: true,
    guildVerified: true,
    channelVerified: true,
    roleVerified: true,
    evidence: {
      packetId: packet.packetId,
      actionScope: parsed.actionScope,
      sourceRefs: packet.sourceRefs || [],
      verificationChecks: checks.filter((check) => check.passed).map((check) => check.name)
    }
  });
  return {
    status: 'verified',
    verifiedApprovalRecord: record,
    roundTableEvidencePacket: {
      packetId: packet.packetId,
      actionScope: parsed.actionScope,
      bridge: 'merlin_discord_runtime',
      outcome: 'approval_verified',
      evidenceRefs: [`discord_approval:${record.approvalId}`, `roundtable_packet:${packet.packetId}`],
      checks,
      verifiedApprovalRecord: record,
      noExecutionPerformed: true,
      createdAt: nowIso()
    }
  };
}

initializeRoundTableDiscordStore();
