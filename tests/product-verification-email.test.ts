import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { afterEach, test } from 'node:test';
import type { AddressInfo } from 'node:net';

process.env.MERLIN_RUNTIME = 'test';

const { sendProductVerificationEmail, setProductVerificationEmailSenderForTest } = await import('../src/productVerificationEmail.ts');

const originalUrl = process.env.MERLIN_PRODUCT_VERIFICATION_EMAIL_WEBHOOK_URL;
const originalToken = process.env.MERLIN_PRODUCT_VERIFICATION_EMAIL_WEBHOOK_TOKEN;

function resetEnv(): void {
  if (originalUrl === undefined) delete process.env.MERLIN_PRODUCT_VERIFICATION_EMAIL_WEBHOOK_URL;
  else process.env.MERLIN_PRODUCT_VERIFICATION_EMAIL_WEBHOOK_URL = originalUrl;
  if (originalToken === undefined) delete process.env.MERLIN_PRODUCT_VERIFICATION_EMAIL_WEBHOOK_TOKEN;
  else process.env.MERLIN_PRODUCT_VERIFICATION_EMAIL_WEBHOOK_TOKEN = originalToken;
  setProductVerificationEmailSenderForTest(undefined);
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
    url: `http://127.0.0.1:${address.port}/verification-email`,
    received,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}

const request = {
  brand: 'MEALSCOUT' as const,
  profileId: 'profile-1',
  profileType: 'food_truck' as const,
  profileName: 'Lucky Tacos',
  recipientEmail: 'owner@example.com',
  sourceFileId: 'file-1',
  source: 'screenshot_profile_seed' as const
};

test('configured product verification webhook sends structured non-marketing request and captures provider id', async () => {
  const webhook = await withWebhookServer(() => ({ status: 200, body: { providerMessageId: 'provider-123', detail: 'queued' } }));
  try {
    process.env.MERLIN_PRODUCT_VERIFICATION_EMAIL_WEBHOOK_URL = webhook.url;
    process.env.MERLIN_PRODUCT_VERIFICATION_EMAIL_WEBHOOK_TOKEN = 'secret-token';

    const result = await sendProductVerificationEmail(request);

    assert.equal(result.status, 'sent');
    assert.equal(result.providerMessageId, 'provider-123');
    assert.equal(webhook.received.length, 1);
    assert.equal(webhook.received[0].headers.authorization, 'Bearer secret-token');
    const body = webhook.received[0].body as Record<string, unknown>;
    assert.equal(body.recipientEmail, 'owner@example.com');
    assert.equal(body.brand, 'MEALSCOUT');
    assert.equal(body.messageKind, 'product_verification_email');
    assert.equal(body.marketingEmail, false);
    assert.equal(body.emailVerified, false);
    assert.equal(body.insuranceVerified, false);
    assert.equal(body.claimStatus, 'unclaimed');
  } finally {
    await webhook.close();
  }
});

test('configured product verification webhook records failed transport response', async () => {
  const webhook = await withWebhookServer(() => ({ status: 503, body: { error: 'sender unavailable' } }));
  try {
    process.env.MERLIN_PRODUCT_VERIFICATION_EMAIL_WEBHOOK_URL = webhook.url;

    const result = await sendProductVerificationEmail(request);

    assert.equal(result.status, 'failed');
    assert.equal(result.failureReason, 'verification_email_sender_http_503');
    assert.equal(result.detail, 'sender unavailable');
  } finally {
    await webhook.close();
  }
});

test('unconfigured product verification sender fails safely', async () => {
  delete process.env.MERLIN_PRODUCT_VERIFICATION_EMAIL_WEBHOOK_URL;
  const result = await sendProductVerificationEmail(request);

  assert.equal(result.status, 'failed');
  assert.equal(result.failureReason, 'verification_email_sender_not_configured');
});
