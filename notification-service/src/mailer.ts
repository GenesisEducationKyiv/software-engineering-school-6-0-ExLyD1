import type { Resend } from 'resend';
import type { EmailContent } from './templates/email-content.ts';

export type Mailer = {
    send: (to: string, content: EmailContent) => Promise<void>;
};

export const createMailer = (resend: Resend, from: string): Mailer => ({
    send: async (to, content) => {
        const { error } = await resend.emails.send({
            from,
            to: [to],
            subject: content.subject,
            text: content.text,
        });

        if (error) {
            throw new Error(`Failed to send email to ${to}: ${error.message}`);
        }
    },
});
