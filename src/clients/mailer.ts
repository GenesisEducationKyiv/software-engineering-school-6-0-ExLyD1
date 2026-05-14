import type { Resend } from 'resend';
import type { ConfirmationMailer, NotificationMailer } from '../types/index.ts';

export const createMailer = (
    resend: Resend,
    baseUrl: string,
    from: string,
): ConfirmationMailer & NotificationMailer => {
    const sendConfirmationEmail = async (email: string, confirmToken: string): Promise<void> => {
        const { error } = await resend.emails.send({
            from,
            to: [email],
            subject: 'Confirm your email',
            text: `Please confirm your email by clicking the following link: ${baseUrl}/api/confirm/${confirmToken}`,
        });

        if (error) {
            throw new Error(`Failed to send confirmation email to ${email}: ${error.message}`);
        }
    };

    const sendReleaseNotification = async (
        email: string,
        repo: string,
        tagName: string,
        unsubscribeToken: string,
    ): Promise<void> => {
        const { error } = await resend.emails.send({
            from,
            to: [email],
            subject: `New release for ${repo}`,
            text: `A new release ${tagName} is available for ${repo}.\n\nUnsubscribe: ${baseUrl}/api/unsubscribe/${unsubscribeToken}`,
        });

        if (error) {
            throw new Error(
                `Failed to send release notification to ${email} (repo: ${repo}): ${error.message}`,
            );
        }
    };

    return { sendConfirmationEmail, sendReleaseNotification };
};
