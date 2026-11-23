export interface EmailSendResult {
  sent: boolean;
  reason?: string;
}

export function isEmailServiceConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim() && process.env.EMAIL_FROM?.trim());
}

export async function sendTransactionalEmail(params: {
  to: string;
  subject: string;
  text: string;
}): Promise<EmailSendResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();

  if (!apiKey || !from) {
    return {
      sent: false,
      reason: 'Email provider is not configured (set RESEND_API_KEY and EMAIL_FROM).'
    };
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from,
        to: [params.to],
        subject: params.subject,
        text: params.text
      })
    });

    if (!response.ok) {
      return {
        sent: false,
        reason: `Email provider returned status ${response.status}`
      };
    }

    return { sent: true };
  } catch {
    return {
      sent: false,
      reason: 'Failed to reach configured email provider.'
    };
  }
}
