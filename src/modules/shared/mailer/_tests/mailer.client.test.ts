import { describe, it, expect, vi } from 'vitest';
import { createMailer } from '../mailer.client.ts';

const BASE_URL = 'https://notifier.example.com';
const FROM = 'notifier@example.com';

function buildResend(error: { message: string } | null = null) {
    return {
        emails: {
            send: vi.fn().mockResolvedValue({ data: { id: 'mock-id' }, error }),
        },
    };
}

describe('createMailer', () => {
    describe('sendConfirmationEmail', () => {
        it('calls sendMail with correct recipient, sender, and subject', async () => {
            const resend = buildResend();
            const mailer = createMailer(resend as never, BASE_URL, FROM);

            await mailer.sendConfirmationEmail('user@example.com', 'abc-token');

            expect(resend.emails.send).toHaveBeenCalledOnce();
            expect(resend.emails.send).toHaveBeenCalledWith(
                expect.objectContaining({
                    to: ['user@example.com'],
                    from: FROM,
                    subject: 'Confirm your email',
                }),
            );
        });

        it('email body contains the confirmation link with the token', async () => {
            const resend = buildResend();
            const mailer = createMailer(resend as never, BASE_URL, FROM);

            await mailer.sendConfirmationEmail('user@example.com', 'abc-token');

            const sentArgs = resend.emails.send.mock.calls[0][0] as { text: string };
            expect(sentArgs.text).toContain(`${BASE_URL}/api/confirm/abc-token`);
        });

        it('throws when the mail server rejects the recipient address', async () => {
            const resend = buildResend({ message: 'delivery failed' });
            const mailer = createMailer(resend as never, BASE_URL, FROM);

            await expect(
                mailer.sendConfirmationEmail('user@example.com', 'abc-token'),
            ).rejects.toThrow('Failed to send confirmation email to user@example.com');
        });
    });

    describe('sendReleaseNotification', () => {
        it('calls sendMail with correct recipient, sender, and subject', async () => {
            const repo = 'org/repo';
            const resend = buildResend();
            const mailer = createMailer(resend as never, BASE_URL, FROM);

            await mailer.sendReleaseNotification('user@example.com', repo, 'v2.0.0', 'unsub-token');

            expect(resend.emails.send).toHaveBeenCalledOnce();
            const sentArgs = resend.emails.send.mock.calls[0][0] as {
                to: string[];
                from: string;
                subject: string;
            };
            expect(sentArgs.to).toEqual(['user@example.com']);
            expect(sentArgs.from).toBe(FROM);
            expect(sentArgs.subject).toContain(repo);
        });

        it('email body contains the new tag name', async () => {
            const resend = buildResend();
            const mailer = createMailer(resend as never, BASE_URL, FROM);

            await mailer.sendReleaseNotification(
                'user@example.com',
                'org/repo',
                'v2.0.0',
                'unsub-token',
            );

            const sentArgs = resend.emails.send.mock.calls[0][0] as { text: string };
            expect(sentArgs.text).toContain('v2.0.0');
        });

        it('email body contains the unsubscribe link with the token', async () => {
            const resend = buildResend();
            const mailer = createMailer(resend as never, BASE_URL, FROM);

            await mailer.sendReleaseNotification(
                'user@example.com',
                'org/repo',
                'v2.0.0',
                'unsub-token',
            );

            const sentArgs = resend.emails.send.mock.calls[0][0] as { text: string };
            expect(sentArgs.text).toContain(`${BASE_URL}/api/unsubscribe/unsub-token`);
        });

        it('throws when the mail server returns an error', async () => {
            const resend = buildResend({ message: 'rate limit exceeded' });
            const mailer = createMailer(resend as never, BASE_URL, FROM);

            await expect(
                mailer.sendReleaseNotification('user@example.com', 'org/repo', 'v2.0.0', 'tok'),
            ).rejects.toThrow('Failed to send release notification');
        });
    });
});
