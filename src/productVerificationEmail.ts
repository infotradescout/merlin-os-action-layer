export type ProductVerificationBrand = 'MEALSCOUT' | 'TRADESCOUT';

export type ProductVerificationEmailRequest = {
  brand: ProductVerificationBrand;
  profileId: string;
  profileType: 'food_truck' | 'contractor_business';
  profileName?: string;
  recipientEmail: string;
  sourceFileId: string;
  source: 'screenshot_profile_seed';
};

export type ProductVerificationEmailSendResult =
  | {
      status: 'sent';
      providerMessageId?: string;
      detail?: string;
    }
  | {
      status: 'failed';
      failureReason: string;
      detail?: string;
    };

export type ProductVerificationEmailSender = (
  request: ProductVerificationEmailRequest
) => ProductVerificationEmailSendResult | Promise<ProductVerificationEmailSendResult>;

let verificationEmailSender: ProductVerificationEmailSender | undefined;

export function setProductVerificationEmailSenderForTest(sender: ProductVerificationEmailSender | undefined): void {
  if (process.env.MERLIN_RUNTIME !== 'test') return;
  verificationEmailSender = sender;
}

function configuredWebhookUrl(): string {
  return (process.env.MERLIN_PRODUCT_VERIFICATION_EMAIL_WEBHOOK_URL || '').trim();
}

function configuredWebhookToken(): string {
  return (process.env.MERLIN_PRODUCT_VERIFICATION_EMAIL_WEBHOOK_TOKEN || '').trim();
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

async function sendViaConfiguredWebhook(
  request: ProductVerificationEmailRequest
): Promise<ProductVerificationEmailSendResult> {
  const url = configuredWebhookUrl();
  if (!url) {
    return {
      status: 'failed',
      failureReason: 'verification_email_sender_not_configured',
      detail:
        'No product verification email sender is configured. Merlin did not simulate or mark external delivery as sent.'
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
    body: JSON.stringify({
      ...request,
      emailVerified: false,
      insuranceVerified: false,
      claimStatus: 'unclaimed',
      messageKind: 'product_verification_email',
      marketingEmail: false
    })
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
      failureReason: `verification_email_sender_http_${response.status}`,
      detail: typeof body.error === 'string' ? body.error : text || response.statusText
    };
  }

  return {
    status: 'sent',
    providerMessageId:
      typeof body.providerMessageId === 'string'
        ? body.providerMessageId
        : typeof body.messageId === 'string'
          ? body.messageId
          : undefined,
    detail: typeof body.detail === 'string' ? body.detail : undefined
  };
}

export async function sendProductVerificationEmail(
  request: ProductVerificationEmailRequest
): Promise<ProductVerificationEmailSendResult> {
  try {
    if (verificationEmailSender) return await verificationEmailSender(request);
    return await sendViaConfiguredWebhook(request);
  } catch (error) {
    return {
      status: 'failed',
      failureReason: error instanceof Error ? error.message : 'verification_email_sender_failed'
    };
  }
}
