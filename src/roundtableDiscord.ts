export type RoundTableDiscordAudience =
  | 'roundtable'
  | 'albion_ai_council'
  | 'merlin_ops'
  | 'human_knights';

export type RoundTableDiscordApprovalStatus =
  | 'draft'
  | 'needs_review'
  | 'approved'
  | 'blocked';

export type RoundTableDiscordAuthorityContext = {
  routedBy: 'RoundTable' | 'Merlin';
  governedBy: 'Albion/AI Council';
  approvalStatus: RoundTableDiscordApprovalStatus;
  requiresHumanReview: boolean;
  approvedBy?: string;
  escalationPath?: string[];
};

export type RoundTableDiscordMessageRequest = {
  audience: RoundTableDiscordAudience;
  title: string;
  body: string;
  source: 'merlin' | 'albion_ai_council' | 'roundtable' | 'system';
  sourceRefs?: string[];
  authority: RoundTableDiscordAuthorityContext;
  metadata?: Record<string, unknown>;
};

export type RoundTableDiscordDispatchResult =
  | {
      status: 'sent';
      providerMessageId?: string;
      detail?: string;
    }
  | {
      status: 'blocked';
      failureReason: string;
      detail?: string;
      payloadPreview: RoundTableDiscordWebhookPayload;
    }
  | {
      status: 'failed';
      failureReason: string;
      detail?: string;
      payloadPreview?: RoundTableDiscordWebhookPayload;
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
};

export type RoundTableDiscordSender = (
  request: RoundTableDiscordMessageRequest
) => RoundTableDiscordDispatchResult | Promise<RoundTableDiscordDispatchResult>;

let roundTableDiscordSender: RoundTableDiscordSender | undefined;

export function setRoundTableDiscordSenderForTest(sender: RoundTableDiscordSender | undefined): void {
  if (process.env.MERLIN_RUNTIME !== 'test') return;
  roundTableDiscordSender = sender;
}

function configuredWebhookUrl(): string {
  return (process.env.ROUNDTABLE_DISCORD_WEBHOOK_URL || '').trim();
}

function configuredWebhookToken(): string {
  return (process.env.ROUNDTABLE_DISCORD_WEBHOOK_TOKEN || '').trim();
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function audienceLabel(audience: RoundTableDiscordAudience): string {
  if (audience === 'albion_ai_council') return 'Albion/AI Council';
  if (audience === 'merlin_ops') return 'Merlin Ops';
  if (audience === 'human_knights') return 'Human Knights';
  return 'RoundTable';
}

function statusColor(status: RoundTableDiscordApprovalStatus): number {
  if (status === 'approved') return 0x2f855a;
  if (status === 'blocked') return 0xc53030;
  if (status === 'needs_review') return 0xd69e2e;
  return 0x4a5568;
}

function formatRefs(sourceRefs: string[] = []): string {
  return sourceRefs.length > 0 ? sourceRefs.join('\n') : 'none';
}

export function buildRoundTableDiscordPayload(request: RoundTableDiscordMessageRequest): RoundTableDiscordWebhookPayload {
  const authority = request.authority;
  const escalationPath = authority.escalationPath && authority.escalationPath.length > 0
    ? authority.escalationPath.join(' -> ')
    : 'not specified';

  return {
    username: 'Merlin x Albion',
    allowed_mentions: { parse: [] },
    content: `[${audienceLabel(request.audience)}] ${truncate(request.title, 120)}`,
    embeds: [
      {
        title: truncate(request.title, 256),
        description: truncate(request.body, 3900),
        color: statusColor(authority.approvalStatus),
        fields: [
          { name: 'Source', value: request.source, inline: true },
          { name: 'Routed by', value: authority.routedBy, inline: true },
          { name: 'Governed by', value: authority.governedBy, inline: true },
          { name: 'Approval status', value: authority.approvalStatus, inline: true },
          { name: 'Human review required', value: authority.requiresHumanReview ? 'yes' : 'no', inline: true },
          { name: 'Approved by', value: authority.approvedBy || 'none', inline: true },
          { name: 'Escalation path', value: truncate(escalationPath, 1024) },
          { name: 'Source refs', value: truncate(formatRefs(request.sourceRefs), 1024) }
        ],
        footer: {
          text: 'Discord is the live human layer. Merlin routes execution context; Albion/AI Council governs authority.'
        },
        timestamp: new Date().toISOString()
      }
    ]
  };
}

function hasDispatchApproval(request: RoundTableDiscordMessageRequest): boolean {
  return request.authority.approvalStatus === 'approved' && Boolean(request.authority.approvedBy?.trim());
}

async function sendViaConfiguredWebhook(
  request: RoundTableDiscordMessageRequest
): Promise<RoundTableDiscordDispatchResult> {
  const payload = buildRoundTableDiscordPayload(request);
  if (!hasDispatchApproval(request)) {
    return {
      status: 'blocked',
      failureReason: 'discord_dispatch_requires_approved_packet',
      detail: 'Discord dispatch requires approvalStatus=approved and approvedBy before Merlin posts to humans.',
      payloadPreview: payload
    };
  }

  const url = configuredWebhookUrl();
  if (!url) {
    return {
      status: 'failed',
      failureReason: 'roundtable_discord_webhook_not_configured',
      detail: 'No RoundTable Discord webhook is configured. Merlin did not simulate or mark Discord delivery as sent.',
      payloadPreview: payload
    };
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };
  const token = configuredWebhookToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });
  const text = await response.text();
  let body: Record<string, unknown> = {};
  if (text) {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (isObject(parsed)) body = parsed;
    } catch {
      body = { raw: text };
    }
  }

  if (!response.ok) {
    return {
      status: 'failed',
      failureReason: `roundtable_discord_webhook_http_${response.status}`,
      detail: typeof body.error === 'string' ? body.error : text || response.statusText,
      payloadPreview: payload
    };
  }

  return {
    status: 'sent',
    providerMessageId:
      typeof body.id === 'string'
        ? body.id
        : typeof body.messageId === 'string'
          ? body.messageId
          : undefined,
    detail: typeof body.detail === 'string' ? body.detail : undefined
  };
}

export async function dispatchRoundTableDiscordMessage(
  request: RoundTableDiscordMessageRequest
): Promise<RoundTableDiscordDispatchResult> {
  try {
    if (roundTableDiscordSender) return await roundTableDiscordSender(request);
    return await sendViaConfiguredWebhook(request);
  } catch (error) {
    return {
      status: 'failed',
      failureReason: error instanceof Error ? error.message : 'roundtable_discord_dispatch_failed',
      payloadPreview: buildRoundTableDiscordPayload(request)
    };
  }
}
