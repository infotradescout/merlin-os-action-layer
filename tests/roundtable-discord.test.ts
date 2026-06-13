import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { generateKeyPairSync, sign } from 'node:crypto';
import { after, afterEach, beforeEach, test } from 'node:test';
import type { AddressInfo } from 'node:net';

const tempDir = mkdtempSync(resolve(tmpdir(), 'merlin-roundtable-discord-'));
process.env.MERLIN_RUNTIME = 'test';
process.env.MERLIN_DB_PATH = resolve(tempDir, 'roundtable-discord.sqlite');

const {
  buildRoundTableDiscordPayload,
  closeRoundTableDiscordStore,
  dispatchRoundTableDiscordPacket,
  getRoundTableDiscordDeliveryAttempts,
  getRoundTableDiscordVerifiedApprovals,
  rememberRoundTableDiscordPacket,
  resetRoundTableDiscordForTest,
  verifyAndWriteDiscordApproval,
  verifyDiscordInteractionSignature
} = await import('../src/roundtableDiscord.ts');

const originalEnv = { ...process.env };

function resetEnv(): void {
  for (const key of [
    'ROUNDTABLE_DISCORD_WEBHOOK_URL',
    'ROUNDTABLE_DISCORD_WEBHOOK_TOKEN',
    'ROUNDTABLE_DISCORD_PUBLIC_KEY',
    'ROUNDTABLE_DISCORD_APPROVER_USER_IDS',
    'ROUNDTABLE_DISCORD_GUILD_ID',
    'ROUNDTABLE_DISCORD_APPROVAL_CHANNEL_IDS',
    'ROUNDTABLE_DISCORD_APPROVER_ROLE_IDS'
  ]) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
}

beforeEach(() => {
  resetEnv();
  resetRoundTableDiscordForTest();
});

afterEach(resetEnv);

after(() => {
  closeRoundTableDiscordStore();
  try {
    rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // SQLite WAL handles can briefly outlive store closure on Windows test runners.
  }
});

async function withWebhookServer(handler: (req: { headers: Record<string, string | string[] | undefined>; body: unknown }) => { status: number; body: unknown }) {
  const received: Array<{ headers: Record<string, string | string[] | undefined>; body: unknown }> = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      const parsed = text ? JSON.parse(text) as unknown : {};
      const event = { headers: req.headers, body: parsed };
      received.push(event);
      const response = handler(event);
      res.statusCode = response.status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(response.body));
    });
  });
  await new Promise<void>((resolveStart, reject) => {
    server.listen(0, () => resolveStart());
    server.on('error', reject);
  });
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}/discord`,
    received,
    close: () => new Promise<void>((resolveStop) => server.close(() => resolveStop()))
  };
}

const packet = {
  packetId: 'rt-discord-autoBott-correction-001',
  audience: 'human_knights' as const,
  title: 'RoundTable alignment correction: AutoBott spelling',
  body: 'Rename the Lancelot Project from Autobott to AutoBott. Do not create a duplicate.',
  source: 'roundtable' as const,
  sourceRefs: ['roundtable:knight-clean-slate-protocol', 'project:AutoBott'],
  approvedActionScopes: ['project.rename:Autobott->AutoBott'],
  authority: {
    routedBy: 'RoundTable' as const,
    governedBy: 'Albion/AI Council' as const,
    requiresHumanReview: true,
    escalationPath: ['RoundTable', 'Albion/AI Council', 'Human Knights']
  }
};

function signingFixture() {
  const pair = generateKeyPairSync('ed25519');
  const publicDer = pair.publicKey.export({ format: 'der', type: 'spki' }) as Buffer;
  const publicKeyHex = publicDer.subarray(-32).toString('hex');
  const signBody = (body: string, timestamp = '2026-06-13T00:00:00.000Z') => ({
    rawBody: body,
    timestamp,
    signature: sign(null, Buffer.from(`${timestamp}${body}`, 'utf8'), pair.privateKey).toString('hex'),
    publicKeyHex
  });
  return { publicKeyHex, signBody };
}

function interactionBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: 'interaction-1',
    type: 3,
    guild_id: 'guild-1',
    channel_id: 'channel-1',
    member: { user: { id: 'user-1' }, roles: ['role-approver'] },
    data: { custom_id: 'roundtable.approve:rt-discord-autoBott-correction-001:project.rename%3AAutobott-%3EAutoBott' },
    ...overrides
  });
}

function configureApprovalEnv(publicKeyHex: string): void {
  process.env.ROUNDTABLE_DISCORD_PUBLIC_KEY = publicKeyHex;
  process.env.ROUNDTABLE_DISCORD_APPROVER_USER_IDS = 'user-1';
  process.env.ROUNDTABLE_DISCORD_GUILD_ID = 'guild-1';
  process.env.ROUNDTABLE_DISCORD_APPROVAL_CHANNEL_IDS = 'channel-1';
  process.env.ROUNDTABLE_DISCORD_APPROVER_ROLE_IDS = 'role-approver';
}

test('Discord payload carries packet contract and no AI approval text authority', () => {
  const payload = buildRoundTableDiscordPayload(packet);

  assert.equal(payload.username, 'Merlin x Albion');
  assert.equal(payload.allowed_mentions.parse.length, 0);
  assert.equal(payload.content.includes('Human Knights'), true);
  const fields = payload.embeds[0].fields;
  assert.equal(fields.some((field) => field.name === 'Packet ID' && field.value === packet.packetId), true);
  assert.equal(fields.some((field) => field.name === 'Routed by' && field.value === 'RoundTable'), true);
  assert.equal(fields.some((field) => field.name === 'Governed by' && field.value === 'Albion/AI Council'), true);
  assert.equal(fields.some((field) => field.name === 'Approved by'), false);
  assert.ok(payload.components?.[0].components[0].custom_id.includes('roundtable.approve'));
});

test('unconfigured Discord webhook records failed delivery attempt without fake success', async () => {
  delete process.env.ROUNDTABLE_DISCORD_WEBHOOK_URL;
  const result = await dispatchRoundTableDiscordPacket(packet);

  assert.equal(result.status, 'failed');
  assert.equal(result.deliveryAttempt.failureReason, 'roundtable_discord_webhook_not_configured');
  assert.equal(result.roundTableEvidencePacket.outcome, 'delivery_failed');
  assert.equal(result.roundTableEvidencePacket.noExecutionPerformed, true);
  assert.equal(getRoundTableDiscordDeliveryAttempts(packet.packetId).length, 1);
});

test('configured Discord webhook records packet delivery attempt', async () => {
  const webhook = await withWebhookServer(() => ({ status: 200, body: { id: 'discord-message-1', detail: 'posted' } }));
  try {
    process.env.ROUNDTABLE_DISCORD_WEBHOOK_URL = webhook.url;
    process.env.ROUNDTABLE_DISCORD_WEBHOOK_TOKEN = 'discord-token';

    const result = await dispatchRoundTableDiscordPacket(packet);

    assert.equal(result.status, 'sent');
    assert.equal(result.deliveryAttempt.providerMessageId, 'discord-message-1');
    assert.equal(result.roundTableEvidencePacket.outcome, 'delivery_sent');
    assert.equal(webhook.received.length, 1);
    assert.equal(webhook.received[0].headers.authorization, 'Bearer discord-token');
  } finally {
    await webhook.close();
  }
});

test('Discord interaction signature verification accepts valid Ed25519 signature and rejects tampering', () => {
  const { publicKeyHex, signBody } = signingFixture();
  const body = interactionBody();
  const signed = signBody(body);

  assert.equal(verifyDiscordInteractionSignature({ ...signed, publicKeyHex }), true);
  assert.equal(verifyDiscordInteractionSignature({ ...signed, rawBody: `${body} `, publicKeyHex }), false);
});

test('verified Discord approval writes record only after signature allowlist and scope checks', () => {
  const { publicKeyHex, signBody } = signingFixture();
  configureApprovalEnv(publicKeyHex);
  rememberRoundTableDiscordPacket(packet);

  const result = verifyAndWriteDiscordApproval(signBody(interactionBody()));

  assert.equal(result.status, 'verified');
  if (result.status !== 'verified') return;
  assert.equal(result.verifiedApprovalRecord.packetId, packet.packetId);
  assert.equal(result.verifiedApprovalRecord.actionScope, 'project.rename:Autobott->AutoBott');
  assert.equal(result.roundTableEvidencePacket.noExecutionPerformed, true);
  assert.equal(getRoundTableDiscordVerifiedApprovals(packet.packetId).length, 1);
});

test('Discord approval rejects non-allowlisted user and does not write record', () => {
  const { publicKeyHex, signBody } = signingFixture();
  configureApprovalEnv(publicKeyHex);
  process.env.ROUNDTABLE_DISCORD_APPROVER_USER_IDS = 'other-user';
  rememberRoundTableDiscordPacket(packet);

  const result = verifyAndWriteDiscordApproval(signBody(interactionBody()));

  assert.equal(result.status, 'rejected');
  if (result.status !== 'rejected') return;
  assert.equal(result.failureReason, 'discord_user_not_allowlisted');
  assert.equal(getRoundTableDiscordVerifiedApprovals(packet.packetId).length, 0);
});

test('Discord approval rejects approved action scope mismatch and does not write record', () => {
  const { publicKeyHex, signBody } = signingFixture();
  configureApprovalEnv(publicKeyHex);
  rememberRoundTableDiscordPacket(packet);
  const body = interactionBody({
    data: { custom_id: 'roundtable.approve:rt-discord-autoBott-correction-001:repo.deploy%3Aproduction' }
  });

  const result = verifyAndWriteDiscordApproval(signBody(body));

  assert.equal(result.status, 'rejected');
  if (result.status !== 'rejected') return;
  assert.equal(result.failureReason, 'approved_action_scope_mismatch');
  assert.equal(getRoundTableDiscordVerifiedApprovals(packet.packetId).length, 0);
});
