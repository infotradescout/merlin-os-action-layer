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
  verifiedApprovalRecordId?: string;
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

export type RoundTableDiscordDeliveryEligibility =
  | {
      eligible: true;
      payloadPreview: RoundTableDiscordWebhookPayload;
    }
  | {
      eligible: false;
      reason: string;
      detail: string;
      payloadPreview: RoundTableDiscordWebhookPayload;
    };

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
          { name: 'Delivery owner', value: 'Merlin', inline: true },
          { name: 'Governed by', value: authority.governedBy, inline: true },
          { name: 'Approval status', value: authority.approvalStatus, inline: true },
          { name: 'Human review required', value: authority.requiresHumanReview ? 'yes' : 'no', inline: true },
          { name: 'Approved by', value: authority.approvedBy || 'none', inline: true },
          { name: 'Verified approval record', value: authority.verifiedApprovalRecordId || 'none' },
          { name: 'Escalation path', value: truncate(escalationPath, 1024) },
          { name: 'Source refs', value: truncate(formatRefs(request.sourceRefs), 1024) }
        ],
        footer: {
          text: 'Discord is transport only. Merlin delivers approved packets; Albion/AI Council governs authority.'
        },
        timestamp: new Date().toISOString()
      }
    ]
  };
}

export function validateDiscordDeliveryEligibility(
  request: RoundTableDiscordMessageRequest
): RoundTableDiscordDeliveryEligibility {
  const payloadPreview = buildRoundTableDiscordPayload(request);

  if (request.authority.approvalStatus !== 'approved') {
    return {
      eligible: false,
      reason: 'discord_delivery_requires_approved_packet',
      detail: 'Discord delivery requires approvalStatus=approved before Merlin may deliver the packet.',
      payloadPreview
    };
  }

  if (!request.authority.verifiedApprovalRecordId?.trim()) {
    return {
      eligible: false,
      reason: 'discord_delivery_requires_verified_approval_record',
      detail:
        'approvalStatus and approvedBy are not sufficient because AI agents can forge those fields. Merlin must reference a verified approval record from a hardened non-LLM approval writer.',
      payloadPreview
    };
  }

  return {
    eligible: true,
    payloadPreview
  };
}
