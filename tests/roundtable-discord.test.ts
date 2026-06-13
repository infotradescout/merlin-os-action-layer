import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { afterEach, test } from 'node:test';
import type { AddressInfo } from 'node:net';

process.env.MERLIN_RUNTIME = 'test';

const {
  buildRoundTableDiscordPayload,
  dispatchRoundTableDiscordMessage,
  setRoundTableDiscordSenderForTest
} = await import('../src/roundtableDiscord.ts');

const originalUrl = process.env.ROUNDTABLE_DISCORD_WEBHOOK_URL;
const originalToken = process.env.ROUNDTABLE_DISCORD_WEBHOOK_TOKEN;

function resetEnv(): void {
  if (originalUrl === undefined) delete process.env.ROUNDTABLE_DISCORD_WEBHOOK_URL;
  else process.env.ROUNDTABLE_DISCORD_WEBHOOK_URL = originalUrl;
  if (originalToken === undefined) delete process.env.ROUNDTABLE_DISCORD_WEBHOOK_TOKEN;
  else process.env.ROUNDTABLE_DISCORD_WEBHOOK_TOKEN = originalToken;
  setRoundTableDiscordSenderForTest(undefined);
}

afterEach(() => {
  resetEnv();
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
  await new Promise<void>((resolve, reject) => {
    server.listen(0, () => resolve());
    server.on('error', reject);
  });
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}/discord`,
    received,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}

const approvedRequest = {
  audience: 'human_knights' as const,
  title: 'RoundTable alignment correction: AutoBott spelling',
  body: 'Rename the Lancelot Project from Autobott to AutoBott. Do not create a duplicate.',
  source: 'merlin' as const,
  sourceRefs: ['roundtable:knight-clean-slate-protocol', 'project:AutoBott'],
  authority: {
    routedBy: 'Merlin' as const,
    governedBy: 'Albion/AI Council' as const,
    approvalStatus: 'approved' as const,
    requiresHumanReview: false,
    approvedBy: 'Thomas/Gawain',
    escalationPath: ['Merlin', 'Albion/AI Council', 'Human Knights']
  }
};

test('Discord payload carries Merlin routing and Albion authority context', () => {
  const payload = buildRoundTableDiscordPayload(approvedRequest);

  assert.equal(payload.username, 'Merlin x Albion');
  assert.equal(payload.allowed_mentions.parse.length, 0);
  assert.equal(payload.content.includes('Human Knights'), true);
  const fields = payload.embeds[0].fields;
  assert.equal(fields.some((field) => field.name === 'Routed by' && field.value === 'Merlin'), true);
  assert.equal(fields.some((field) => field.name === 'Governed by' && field.value === 'Albion/AI Council'), true);
  assert.equal(payload.embeds[0].footer.text.includes('Discord is the live human layer'), true);
});

test('Discord dispatch blocks unapproved packets before webhook delivery', async () => {
  process.env.ROUNDTABLE_DISCORD_WEBHOOK_URL = 'http://127.0.0.1:1/should-not-send';
  const result = await dispatchRoundTableDiscordMessage({
    ...approvedRequest,
    authority: {
      ...approvedRequest.authority,
      approvalStatus: 'needs_review',
      approvedBy: undefined
    }
  });

  assert.equal(result.status, 'blocked');
  assert.equal(result.failureReason, 'discord_dispatch_requires_approved_packet');
  assert.equal(result.payloadPreview.embeds[0].fields.some((field) => field.value === 'needs_review'), true);
});

test('unconfigured Discord webhook fails safely without fake delivery', async () => {
  delete process.env.ROUNDTABLE_DISCORD_WEBHOOK_URL;
  const result = await dispatchRoundTableDiscordMessage(approvedRequest);

  assert.equal(result.status, 'failed');
  assert.equal(result.failureReason, 'roundtable_discord_webhook_not_configured');
  assert.ok(result.payloadPreview);
});

test('configured Discord webhook sends approved structured RoundTable message', async () => {
  const webhook = await withWebhookServer(() => ({ status: 200, body: { id: 'discord-message-1', detail: 'posted' } }));
  try {
    process.env.ROUNDTABLE_DISCORD_WEBHOOK_URL = webhook.url;
    process.env.ROUNDTABLE_DISCORD_WEBHOOK_TOKEN = 'discord-token';

    const result = await dispatchRoundTableDiscordMessage(approvedRequest);

    assert.equal(result.status, 'sent');
    assert.equal(result.providerMessageId, 'discord-message-1');
    assert.equal(webhook.received.length, 1);
    assert.equal(webhook.received[0].headers.authorization, 'Bearer discord-token');
    const body = webhook.received[0].body as Record<string, unknown>;
    assert.equal(body.username, 'Merlin x Albion');
    const embeds = body.embeds as Array<{ fields: Array<{ name: string; value: string }> }>;
    assert.equal(embeds[0].fields.some((field) => field.name === 'Approved by' && field.value === 'Thomas/Gawain'), true);
  } finally {
    await webhook.close();
  }
});
