import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

process.env.MERLIN_RUNTIME = 'test';
process.env.MEALSCOUT_AFFILIATE_TRACKING_LEDGER_PATH = join(tmpdir(), 'merlin-profile-seeding-ledger-test.csv');

const { createMerlinServer } = await import('../src/server.ts');
const { listMealScoutTrucks } = await import('../src/mealscoutProfileImport.ts');
const { readAffiliateTrackingLedgerRows } = await import('../src/mealscoutAffiliateTrackingLedger.ts');
const { setProductVerificationEmailSenderForTest } = await import('../src/productVerificationEmail.ts');

let server: Server;
let baseUrl = '';

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
    ...init
  });
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : {}) as T };
}

before(async () => {
  server = createMerlinServer();
  await new Promise<void>((resolveStart, reject) => {
    server.listen(0, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Server did not bind to numeric port'));
        return;
      }
      baseUrl = `http://127.0.0.1:${(address as AddressInfo).port}`;
      resolveStart();
    });
  });
});

after(async () => {
  await new Promise<void>((resolveStop) => server.close(() => resolveStop()));
});

beforeEach(async () => {
  await requestJson('/api/demo/reset', { method: 'POST' });
  setProductVerificationEmailSenderForTest((request) => ({
    status: 'sent',
    providerMessageId: `test-verification-${request.brand.toLowerCase()}-${request.profileId}`
  }));
});

function folderAttribution(email: string, folderName: string) {
  return {
    attributionSource: 'folder_context',
    attributionStatus: 'matched_affiliate_folder',
    sourceChannel: 'admin_import',
    affiliate_attribution_email: email,
    affiliate_attribution_source: 'folder_email_token',
    affiliate_attribution_folder: folderName,
    affiliate_attribution_folder_path: `Merlin/${folderName}`,
    capturedAt: '2026-06-02T00:00:00.000Z'
  };
}

test('Slice 13 seeds MealScout and TradeScout separately, records ledger rows, and blocks ambiguity', async () => {
  const response = await requestJson<{
    status: string;
    mutationAllowed: boolean;
    results: Array<{
      brand_lane?: string;
      seed_status: string;
      profile_action?: string;
      target_profile_id?: string;
      target_profile_type?: string;
      profile_email?: string;
      verification_email_status: string;
      blockedReason?: string;
    }>;
    verificationEmails: Array<{ brand_lane: string; recipient_email: string; status: string }>;
  }>('/api/merlin/profile-seeding/process-existing-screenshots', {
    method: 'POST',
    headers: { 'x-operator-role': 'admin' },
    body: JSON.stringify({
      inputs: [
        {
          fileId: 'seed-meal-1',
          fileName: 'meal-profile.png',
          drivePath: '/affiliates/affiliate@example.com Screenshots/meal-profile.png',
          sourceFolderId: 'folder-meal-aff',
          extractedText: 'Lucky Tacos Food Truck\nEmail: truck@example.com\nPhone: 850-255-8396\nCity: Metairie\nMenu: Taco $4',
          sourceFileAttribution: folderAttribution('affiliate@example.com', 'affiliate@example.com Screenshots')
        },
        {
          fileId: 'seed-trade-1',
          fileName: 'trade-profile.png',
          drivePath: '/affiliates/affiliate@example.com Screenshots/trade-profile.png',
          sourceFolderId: 'folder-trade-aff',
          extractedText: 'Contractor: Apex Roofing\nEmail: apex@example.com\nPhone: 985-222-3333\nLicense and insurance document',
          sourceFileAttribution: folderAttribution('affiliate@example.com', 'affiliate@example.com Screenshots')
        },
        {
          fileId: 'seed-ambiguous-1',
          fileName: 'unknown.png',
          drivePath: '/affiliates/affiliate@example.com Screenshots/unknown.png',
          sourceFolderId: 'folder-unknown-aff',
          extractedText: 'Random screenshot with no business identity',
          sourceFileAttribution: folderAttribution('affiliate@example.com', 'affiliate@example.com Screenshots')
        }
      ]
    })
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.mutationAllowed, true);

  const meal = response.body.results.find((row) => row.brand_lane === 'MEALSCOUT');
  const trade = response.body.results.find((row) => row.brand_lane === 'TRADESCOUT');
  const blocked = response.body.results.find((row) => row.blockedReason === 'ambiguous_or_unsupported_brand');
  assert.equal(meal?.seed_status, 'seeded');
  assert.equal(meal?.target_profile_type, 'food_truck');
  assert.equal(meal?.profile_email, 'truck@example.com');
  assert.equal(meal?.verification_email_status, 'sent');
  assert.equal(trade?.seed_status, 'seeded');
  assert.equal(trade?.target_profile_type, 'contractor_business');
  assert.equal(trade?.profile_email, 'apex@example.com');
  assert.equal(trade?.verification_email_status, 'sent');
  assert.equal(blocked?.seed_status, 'blocked');

  const mealProfiles = listMealScoutTrucks();
  const mealProfile = mealProfiles.find((profile) => profile.email === 'truck@example.com');
  assert.ok(mealProfile);
  assert.equal(mealProfile?.email_verified, false);
  assert.equal(mealProfile?.insurance_verified, false);
  assert.equal(mealProfile?.claim_status, 'unclaimed');

  const tradeProfiles = await requestJson<{
    profiles: Array<{ email?: string; email_verified: boolean; insurance_verified: boolean; claim_status: string }>;
  }>('/api/merlin/profile-seeding/tradescout-profiles');
  const tradeProfile = tradeProfiles.body.profiles.find((profile) => profile.email === 'apex@example.com');
  assert.ok(tradeProfile);
  assert.equal(tradeProfile?.email_verified, false);
  assert.equal(tradeProfile?.insurance_verified, false);
  assert.equal(tradeProfile?.claim_status, 'unclaimed');

  assert.equal(response.body.verificationEmails.some((email) => email.recipient_email === 'truck@example.com' && email.brand_lane === 'MEALSCOUT'), true);
  assert.equal(response.body.verificationEmails.some((email) => email.recipient_email === 'apex@example.com' && email.brand_lane === 'TRADESCOUT'), true);
  assert.equal(response.body.verificationEmails.some((email) => email.recipient_email === 'affiliate@example.com'), false);

  const ledger = readAffiliateTrackingLedgerRows();
  assert.equal(ledger.some((row) => row.brand_lane === 'MEALSCOUT' && row.profile_email === 'truck@example.com' && row.affiliate_attribution_email === 'affiliate@example.com'), true);
  assert.equal(ledger.some((row) => row.brand_lane === 'TRADESCOUT' && row.profile_email === 'apex@example.com' && row.affiliate_attribution_email === 'affiliate@example.com'), true);
  assert.equal(ledger.some((row) => row.source_file_id === 'seed-ambiguous-1' && row.seed_status === 'blocked'), true);
});

test('Slice 13 updates an existing MealScout seeded profile instead of duplicating it', async () => {
  const body = (phone: string) => JSON.stringify({
    inputs: [
      {
        fileId: `seed-meal-${phone}`,
        fileName: 'meal-profile.png',
        extractedText: `Lucky Tacos Food Truck\nEmail: truck@example.com\nPhone: ${phone}\nCity: Metairie\nMenu: Taco $4`,
        sourceFileAttribution: folderAttribution('affiliate@example.com', 'affiliate@example.com Screenshots')
      }
    ]
  });
  const first = await requestJson<{ results: Array<{ profile_action?: string; target_profile_id?: string }> }>(
    '/api/merlin/profile-seeding/process-existing-screenshots',
    { method: 'POST', body: body('504-111-2222') }
  );
  const second = await requestJson<{ results: Array<{ profile_action?: string; target_profile_id?: string }> }>(
    '/api/merlin/profile-seeding/process-existing-screenshots',
    { method: 'POST', body: body('504-999-0000') }
  );
  assert.equal(first.body.results[0].profile_action, 'create');
  assert.equal(second.body.results[0].profile_action, 'update');
  assert.equal(second.body.results[0].target_profile_id, first.body.results[0].target_profile_id);
  assert.equal(listMealScoutTrucks().filter((profile) => profile.email === 'truck@example.com').length, 1);
});

test('Slice 14 fails safely when no product verification sender is configured', async () => {
  setProductVerificationEmailSenderForTest(undefined);

  const response = await requestJson<{
    results: Array<{ verification_email_status: string; profile_email?: string }>;
    verificationEmails: Array<{ recipient_email: string; status: string; failure_reason?: string }>;
  }>('/api/merlin/profile-seeding/process-existing-screenshots', {
    method: 'POST',
    body: JSON.stringify({
      inputs: [
        {
          fileId: 'seed-no-sender-1',
          fileName: 'meal-profile.png',
          extractedText:
            'Lucky Tacos Food Truck\nEmail: truck@example.com\nPhone: 850-255-8396\nCity: Metairie\nMenu: Taco $4',
          sourceFileAttribution: folderAttribution('affiliate@example.com', 'affiliate@example.com Screenshots')
        }
      ]
    })
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.results[0].profile_email, 'truck@example.com');
  assert.equal(response.body.results[0].verification_email_status, 'failed');
  assert.equal(response.body.verificationEmails[0].recipient_email, 'truck@example.com');
  assert.equal(response.body.verificationEmails[0].status, 'failed');
  assert.equal(response.body.verificationEmails[0].failure_reason, 'verification_email_sender_not_configured');
});

test('Slice 14 keeps verification unavailable when screenshot evidence has no business email', async () => {
  const response = await requestJson<{
    results: Array<{ verification_email_status: string; profile_email?: string }>;
    verificationEmails: Array<{ recipient_email: string }>;
  }>('/api/merlin/profile-seeding/process-existing-screenshots', {
    method: 'POST',
    body: JSON.stringify({
      inputs: [
        {
          fileId: 'seed-phone-only-1',
          fileName: 'meal-phone-only.png',
          extractedText: 'Lucky Tacos Food Truck\nPhone: 850-255-8396\nCity: Metairie\nMenu: Taco $4',
          sourceFileAttribution: folderAttribution('affiliate@example.com', 'affiliate@example.com Screenshots')
        }
      ]
    })
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.results[0].verification_email_status, 'not_available');
  assert.equal(response.body.results[0].profile_email, undefined);
  assert.equal(response.body.verificationEmails.length, 0);
});

test('Slice 14 does not send verification to an existing profile email when the current screenshot lacks email evidence', async () => {
  const create = await requestJson<{ results: Array<{ target_profile_id?: string; verification_email_status: string }> }>(
    '/api/merlin/profile-seeding/process-existing-screenshots',
    {
      method: 'POST',
      body: JSON.stringify({
        inputs: [
          {
            fileId: 'seed-existing-email-1',
            fileName: 'meal-profile.png',
            extractedText:
              'Lucky Tacos Food Truck\nEmail: truck@example.com\nPhone: 850-255-8396\nCity: Metairie\nMenu: Taco $4',
            sourceFileAttribution: folderAttribution('affiliate@example.com', 'affiliate@example.com Screenshots')
          }
        ]
      })
    }
  );
  const update = await requestJson<{
    results: Array<{ target_profile_id?: string; verification_email_status: string; profile_email?: string }>;
    verificationEmails: Array<{ recipient_email: string; source_file_id: string }>;
  }>('/api/merlin/profile-seeding/process-existing-screenshots', {
    method: 'POST',
    body: JSON.stringify({
      inputs: [
        {
          fileId: 'seed-existing-phone-only-1',
          fileName: 'meal-phone-only.png',
          extractedText: 'Lucky Tacos Food Truck\nPhone: 850-255-8396\nCity: Metairie\nMenu: Taco $4',
          sourceFileAttribution: folderAttribution('affiliate@example.com', 'affiliate@example.com Screenshots')
        }
      ]
    })
  });

  assert.equal(create.body.results[0].verification_email_status, 'sent');
  assert.equal(update.body.results[0].target_profile_id, create.body.results[0].target_profile_id);
  assert.equal(update.body.results[0].profile_email, 'truck@example.com');
  assert.equal(update.body.results[0].verification_email_status, 'not_available');
  assert.equal(update.body.verificationEmails.some((email) => email.source_file_id === 'seed-existing-phone-only-1'), false);
});
