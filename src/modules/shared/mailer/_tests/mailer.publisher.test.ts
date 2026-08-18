import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPublishingMailer } from '../mailer.publisher.ts';
import { EMAIL_QUEUE, type EmailCommand } from '../../messaging/email-commands.ts';
import type { RabbitChannel } from '../../messaging/rabbit.ts';

function buildChannel(): RabbitChannel {
    return { sendToQueue: vi.fn().mockReturnValue(true) } as unknown as RabbitChannel;
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('createPublishingMailer', () => {
    it('publishes a confirmation command to the email queue', async () => {
        const channel = buildChannel();
        const mailer = createPublishingMailer(channel);

        await mailer.sendConfirmationEmail('user@example.com', 'tok-123');

        expect(channel.sendToQueue).toHaveBeenCalledOnce();
        const [queue, content] = vi.mocked(channel.sendToQueue).mock.calls[0];
        expect(queue).toBe(EMAIL_QUEUE);
        const command = JSON.parse(content.toString()) as EmailCommand;
        expect(command).toEqual({
            type: 'confirmation',
            email: 'user@example.com',
            token: 'tok-123',
        });
    });

    it('publishes a release command to the email queue', async () => {
        const channel = buildChannel();
        const mailer = createPublishingMailer(channel);

        await mailer.sendReleaseNotification('user@example.com', 'org/repo', 'v2.0.0', 'unsub-1');

        const [queue, content] = vi.mocked(channel.sendToQueue).mock.calls[0];
        expect(queue).toBe(EMAIL_QUEUE);
        const command = JSON.parse(content.toString()) as EmailCommand;
        expect(command).toEqual({
            type: 'release',
            email: 'user@example.com',
            repo: 'org/repo',
            tag: 'v2.0.0',
            unsubscribeToken: 'unsub-1',
        });
    });

    it('marks messages as persistent so they survive a broker restart', async () => {
        const channel = buildChannel();
        const mailer = createPublishingMailer(channel);

        await mailer.sendConfirmationEmail('user@example.com', 'tok');

        const options = vi.mocked(channel.sendToQueue).mock.calls[0][2];
        expect(options).toMatchObject({ persistent: true });
    });
});
