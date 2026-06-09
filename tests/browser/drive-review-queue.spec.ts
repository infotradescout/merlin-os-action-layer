import { expect, test } from '@playwright/test';

test('admin review queue runtime interaction remains read-only', async ({ page }) => {
  const baseDate = '2026-05-26T00:00:00.000Z';
  const itemId = 'queue-item-001';
  const decisions: Array<{ decision: string; note?: string; decided_by?: string }> = [];

  await page.route('**/api/drive/auth-health', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ready',
        auth: {
          ready: true,
          configured: true,
          reason: null,
          checkedAt: baseDate
        },
        managedFolders: {
          ready: true,
          missing: []
        }
      })
    });
  });

  await page.route('**/api/drive/review-queue', async (route) => {
    const latestDecision = decisions.at(-1);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ok',
        mode: 'read_only',
        mutationAllowed: false,
        checkedAt: baseDate,
        summary: {
          itemCount: 1,
          openCount: latestDecision ? 0 : 1,
          acknowledgedCount: latestDecision ? 1 : 0,
          deferredCount: 0,
          resolvedExternallyCount: 0,
          falsePositiveCount: 0
        },
        items: [
          {
            id: itemId,
            type: 'manifest_mismatch',
            severity: 'critical',
            status: latestDecision ? 'acknowledged' : 'open',
            title: latestDecision ? 'manifest mismatch · acknowledged' : 'manifest mismatch · open',
            summary: 'Manifest says processed but file observed in needs review',
            source: 'drive_reconciliation',
            observedAt: baseDate,
            readOnly: true,
            recommendedHumanAction: 'Review mapping and decide manually.',
            lastDecision: latestDecision
              ? {
                  decision: latestDecision.decision,
                  note: latestDecision.note,
                  decidedAt: baseDate,
                  decidedBy: latestDecision.decided_by
                }
              : undefined,
            decisionHistory: [
              {
                decision: 'needs_manual_review',
                note: 'Initial triage',
                decidedAt: '2026-05-25T00:00:00.000Z',
                decidedBy: 'operator-0'
              },
              ...(latestDecision
                ? [
                    {
                      decision: latestDecision.decision,
                      note: latestDecision.note,
                      decidedAt: baseDate,
                      decidedBy: latestDecision.decided_by
                    }
                  ]
                : [])
            ]
          }
        ]
      })
    });
  });

  await page.route('**/api/drive/review-queue/audit**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ok',
        mode: 'read_only',
        mutationAllowed: false,
        records: [
          {
            itemId,
            decision: 'needs_manual_review',
            note: 'Initial triage',
            decidedAt: '2026-05-25T00:00:00.000Z',
            decidedBy: 'operator-0',
            source: 'drive_review_queue',
            mutationAllowed: false
          }
        ]
      })
    });
  });

  await page.route(`**/api/drive/review-queue/${itemId}/history`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ok',
        mode: 'read_only',
        mutationAllowed: false,
        itemId,
        history: [
          {
            decision: 'needs_manual_review',
            note: 'Initial triage',
            decidedAt: '2026-05-25T00:00:00.000Z',
            decidedBy: 'operator-0',
            source: 'drive_review_queue',
            mutationAllowed: false
          },
          ...(decisions.at(-1)
            ? [
                {
                  decision: decisions.at(-1)?.decision,
                  note: decisions.at(-1)?.note,
                  decidedAt: baseDate,
                  decidedBy: decisions.at(-1)?.decided_by,
                  source: 'drive_review_queue',
                  mutationAllowed: false
                }
              ]
            : [])
        ]
      })
    });
  });

  await page.route(`**/api/drive/review-queue/${itemId}/decision`, async (route) => {
    const body = route.request().postDataJSON() as { decision: string; note?: string; decided_by?: string };
    decisions.push(body);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ok',
        mode: 'read_only',
        mutationAllowed: false,
        item: {
          id: itemId,
          type: 'manifest_mismatch',
          severity: 'critical',
          status: 'acknowledged',
          title: 'manifest mismatch · acknowledged',
          summary: 'Manifest says processed but file observed in needs review',
          source: 'drive_reconciliation',
          observedAt: baseDate,
          readOnly: true,
          recommendedHumanAction: 'Review mapping and decide manually.',
          lastDecision: {
            decision: 'acknowledged',
            note: body.note,
            decidedAt: baseDate,
            decidedBy: body.decided_by
          },
          decisionHistory: [
            {
              decision: 'needs_manual_review',
              note: 'Initial triage',
              decidedAt: '2026-05-25T00:00:00.000Z',
              decidedBy: 'operator-0'
            },
            {
              decision: 'acknowledged',
              note: body.note,
              decidedAt: baseDate,
              decidedBy: body.decided_by
            }
          ]
        }
      })
    });
  });

  await page.route(`**/api/drive/review-queue/${itemId}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ok',
        mode: 'read_only',
        mutationAllowed: false,
        item: {
          id: itemId,
          type: 'manifest_mismatch',
          severity: 'critical',
          status: 'open',
          title: 'manifest mismatch · open',
          summary: 'Manifest says processed but file observed in needs review',
          source: 'drive_reconciliation',
          observedAt: baseDate,
          readOnly: true,
          recommendedHumanAction: 'Review mapping and decide manually.',
          decisionHistory: [
            {
              decision: 'needs_manual_review',
              note: 'Initial triage',
              decidedAt: '2026-05-25T00:00:00.000Z',
              decidedBy: 'operator-0'
            }
          ]
        }
      })
    });
  });

  await page.goto('/admin/drive-review-queue');

  await expect(page.getByRole('heading', { name: 'Drive Review Queue' })).toBeVisible();
  await expect(page.getByText('Auth Health Strip')).toBeVisible();
  await expect(page.locator('#auth-strip')).toContainText('Auth health: ready');
  await expect(page.getByText('Reconciliation Summary')).toBeVisible();
  await expect(page.locator('#queue-list')).toContainText('manifest mismatch · open');

  await page.locator('#queue-list .item').first().click();
  await expect(page.locator('#detail-content')).toBeVisible();
  await expect(page.locator('#detail-recommended')).toContainText('Recommended human action');
  await expect(page.locator('#decision-history')).toContainText('needs_manual_review');

  await page.fill('#decision-note', 'Triaged and recorded');
  await page.getByRole('button', { name: 'Acknowledge' }).click();

  await expect.poll(() => decisions.length).toBe(1);
  expect(decisions[0].decision).toBe('acknowledged');
  expect(decisions[0].note).toBe('Triaged and recorded');
  expect(decisions[0].decided_by).toBe('operator');
  expect((decisions[0] as Record<string, unknown>).target).toBeUndefined();

  await expect(page.locator('#last-decision')).toContainText('acknowledged');
  await expect(page.locator('#decision-history')).toContainText('acknowledged');
  await expect(page.locator('#audit-list')).toContainText('mutationAllowed:false');

  const bodyText = (await page.locator('body').innerText()).toLowerCase();
  expect(bodyText).not.toMatch(/\bfix\b/);
  expect(bodyText).not.toMatch(/\brepair\b/);
  expect(bodyText).not.toMatch(/\bsync\b/);
  expect(bodyText).not.toMatch(/\bcreate\b/);
  expect(bodyText).not.toMatch(/\bdelete\b/);
  expect(bodyText).not.toMatch(/auto-resolve/);
});

test('queue inbox renders severity priority ordering critical warning info', async ({ page }) => {
  const baseDate = '2026-05-26T00:00:00.000Z';

  await page.route('**/api/drive/auth-health', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ready',
        auth: { ready: true, configured: true, reason: null, checkedAt: baseDate },
        managedFolders: { ready: true, missing: [] }
      })
    });
  });

  await page.route('**/api/drive/review-queue', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ok',
        mode: 'read_only',
        mutationAllowed: false,
        checkedAt: baseDate,
        summary: {
          itemCount: 3,
          openCount: 3,
          acknowledgedCount: 0,
          deferredCount: 0,
          resolvedExternallyCount: 0,
          falsePositiveCount: 0
        },
        items: [
          {
            id: 'info-item',
            type: 'unknown',
            severity: 'info',
            status: 'open',
            title: 'info item',
            summary: 'info summary',
            source: 'drive_reconciliation',
            observedAt: baseDate,
            readOnly: true,
            recommendedHumanAction: 'Review'
          },
          {
            id: 'critical-item',
            type: 'manifest_mismatch',
            severity: 'critical',
            status: 'open',
            title: 'critical item',
            summary: 'critical summary',
            source: 'drive_reconciliation',
            observedAt: baseDate,
            readOnly: true,
            recommendedHumanAction: 'Review'
          },
          {
            id: 'warning-item',
            type: 'unexpected_folder',
            severity: 'warning',
            status: 'open',
            title: 'warning item',
            summary: 'warning summary',
            source: 'drive_reconciliation',
            observedAt: baseDate,
            readOnly: true,
            recommendedHumanAction: 'Review'
          }
        ]
      })
    });
  });
  await page.route('**/api/drive/review-queue/audit**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ok',
        mode: 'read_only',
        mutationAllowed: false,
        records: []
      })
    });
  });

  await page.goto('/admin/drive-review-queue');
  const queueRows = page.locator('#queue-list .item');
  await expect(queueRows).toHaveCount(3);
  await expect(queueRows.nth(0)).toContainText('critical item');
  await expect(queueRows.nth(1)).toContainText('warning item');
  await expect(queueRows.nth(2)).toContainText('info item');
});

test('auth unhealthy state disables decisions and prevents decision post', async ({ page }) => {
  const baseDate = '2026-05-26T00:00:00.000Z';
  let decisionPosts = 0;
  const itemId = 'blocked-item';

  await page.route('**/api/drive/auth-health', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'disabled',
        auth: { ready: false, configured: false, reason: 'OAuth credentials are incomplete', checkedAt: baseDate },
        managedFolders: { ready: false, missing: ['processed'] }
      })
    });
  });

  await page.route('**/api/drive/review-queue', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ok',
        mode: 'read_only',
        mutationAllowed: false,
        checkedAt: baseDate,
        summary: {
          itemCount: 1,
          openCount: 1,
          acknowledgedCount: 0,
          deferredCount: 0,
          resolvedExternallyCount: 0,
          falsePositiveCount: 0
        },
        items: [
          {
            id: itemId,
            type: 'manifest_mismatch',
            severity: 'critical',
            status: 'open',
            title: 'blocked item',
            summary: 'blocked summary',
            source: 'drive_reconciliation',
            observedAt: baseDate,
            readOnly: true,
            recommendedHumanAction: 'Review'
          }
        ]
      })
    });
  });
  await page.route('**/api/drive/review-queue/audit**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ok',
        mode: 'read_only',
        mutationAllowed: false,
        records: []
      })
    });
  });
  await page.route(`**/api/drive/review-queue/${itemId}/history`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ok',
        mode: 'read_only',
        mutationAllowed: false,
        itemId,
        history: []
      })
    });
  });

  await page.route(`**/api/drive/review-queue/${itemId}/decision`, async (route) => {
    decisionPosts += 1;
    await route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({
        error: 'Drive auth unhealthy'
      })
    });
  });

  await page.goto('/admin/drive-review-queue');
  await page.locator('#queue-list .item').first().click();
  await expect(page.locator('#auth-warning')).toContainText('Decision actions are blocked because auth is unhealthy.');
  await expect(page.getByRole('button', { name: 'Acknowledge' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Needs manual review' })).toBeDisabled();
  await expect(page.getByText('Read-only mode · No Drive changes will be made')).toBeVisible();
  expect(decisionPosts).toBe(0);
});

test('merlin daily includes internal admin navigation link to drive review queue', async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    const respond = (body: unknown) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(body)
      });

    if (url.includes('/api/daily')) return respond({
      date: '2026-05-26',
      generated_at: '2026-05-26T00:00:00.000Z',
      sections: { changed: [], needs_attention: [], waiting: [], stale: [], suggested_next_steps: [] }
    });
    if (url.includes('/api/approvals')) return respond({ approvals: [] });
    if (url.includes('/api/changes/recent')) return respond({ changes: [] });
    if (url.includes('/api/replay/recent')) return respond({ replay_events: [] });
    if (url.includes('/api/lisa/search')) return respond({ results: [] });
    if (url.includes('/api/drive/needs-review')) return respond({ manifest_entries: [] });
    return respond({});
  });

  await page.goto('/');
  await expect(page.getByText("Current task: scan today's command center.")).toBeVisible();
  const link = page.getByRole('link', { name: 'Open Drive Review inbox' });
  await expect(link).toBeVisible();
});

test('audit export endpoint returns metadata-only records', async ({ page }) => {
  const baseDate = '2026-05-26T00:00:00.000Z';
  await page.route('**/api/drive/review-queue/audit/export.json**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ok',
        mode: 'read_only',
        mutationAllowed: false,
        exportedAt: baseDate,
        records: [
          {
            itemId: 'export-item-001',
            decision: 'acknowledged',
            note: 'Audit export test',
            decidedAt: baseDate,
            decidedBy: 'operator-x',
            source: 'drive_review_queue',
            mutationAllowed: false
          }
        ]
      })
    });
  });

  const response = await page.request.get('/api/drive/review-queue/audit/export.json?limit=10');
  expect(response.status()).toBe(200);
  const payload = (await response.json()) as {
    status: string;
    mode: string;
    mutationAllowed: boolean;
    records: Array<Record<string, unknown>>;
  };
  expect(payload.status).toBe('ok');
  expect(payload.mode).toBe('read_only');
  expect(payload.mutationAllowed).toBe(false);
  expect(Array.isArray(payload.records)).toBe(true);
  if (payload.records.length > 0) {
    expect(payload.records[0].source).toBe('drive_review_queue');
    expect(payload.records[0].mutationAllowed).toBe(false);
    expect(payload.records[0].target).toBeUndefined();
  }
  expect(JSON.stringify(payload).toLowerCase()).not.toMatch(/\bfix\b|\brepair\b|\bauto-resolve\b/);
});
