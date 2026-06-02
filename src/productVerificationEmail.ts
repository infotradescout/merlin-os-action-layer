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
) => ProductVerificationEmailSendResult;

let verificationEmailSender: ProductVerificationEmailSender | undefined;

export function setProductVerificationEmailSenderForTest(sender: ProductVerificationEmailSender | undefined): void {
  if (process.env.MERLIN_RUNTIME !== 'test') return;
  verificationEmailSender = sender;
}

export function sendProductVerificationEmail(
  request: ProductVerificationEmailRequest
): ProductVerificationEmailSendResult {
  if (!verificationEmailSender) {
    return {
      status: 'failed',
      failureReason: 'verification_email_sender_not_configured',
      detail:
        'No product verification email sender is configured. Merlin did not simulate or mark external delivery as sent.'
    };
  }

  try {
    return verificationEmailSender(request);
  } catch (error) {
    return {
      status: 'failed',
      failureReason: error instanceof Error ? error.message : 'verification_email_sender_failed'
    };
  }
}
