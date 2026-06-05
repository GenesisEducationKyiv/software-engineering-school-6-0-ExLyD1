import type { EmailContent } from './email-content.ts';

export const confirmationEmail = (baseUrl: string, token: string): EmailContent => ({
    subject: 'Confirm your email',
    text: `Please confirm your email by clicking the following link: ${baseUrl}/api/confirm/${token}`,
});
