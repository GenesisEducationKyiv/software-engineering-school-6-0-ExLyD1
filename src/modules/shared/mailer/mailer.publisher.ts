import type { NotificationMailer } from './mailer.types.ts';
import type { RabbitChannel } from '../messaging/rabbit.ts';
import { EMAIL_QUEUE, type EmailCommand } from '../messaging/email-commands.ts';

const publish = (channel: RabbitChannel, command: EmailCommand): void => {
    // persistent + durable queue → the command is not lost if the broker or the
    // notification-service is momentarily down.
    channel.sendToQueue(EMAIL_QUEUE, Buffer.from(JSON.stringify(command)), { persistent: true });
};

/**
 * Publishes release notifications as commands to RabbitMQ. (Confirmation emails
 * now go through the saga orchestrator + transactional outbox, not this path.)
 */
export const createPublishingMailer = (channel: RabbitChannel): NotificationMailer => ({
    sendReleaseNotification: async (email, repo, tag, unsubscribeToken) => {
        publish(channel, { type: 'release', email, repo, tag, unsubscribeToken });
    },
});
