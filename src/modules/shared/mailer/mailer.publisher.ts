import type { ConfirmationMailer, NotificationMailer } from './mailer.types.ts';
import type { RabbitChannel } from '../messaging/rabbit.ts';
import { EMAIL_QUEUE, type EmailCommand } from '../messaging/email-commands.ts';

const publish = (channel: RabbitChannel, command: EmailCommand): void => {
    // persistent + durable queue → the command is not lost if the broker or the
    // notification-service is momentarily down.
    channel.sendToQueue(EMAIL_QUEUE, Buffer.from(JSON.stringify(command)), { persistent: true });
};

/**
 * Implements the same mailer interface the rest of the monolith already depends
 * on — but instead of sending email it publishes a command to RabbitMQ. Callers
 * (controller, notifyRelease) are unchanged: that is the whole point of the
 * extraction (Dependency Inversion — swap the implementation behind the port).
 */
export const createPublishingMailer = (
    channel: RabbitChannel,
): ConfirmationMailer & NotificationMailer => ({
    sendConfirmationEmail: async (email, token) => {
        publish(channel, { type: 'confirmation', email, token });
    },
    sendReleaseNotification: async (email, repo, tag, unsubscribeToken) => {
        publish(channel, { type: 'release', email, repo, tag, unsubscribeToken });
    },
});
