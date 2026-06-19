import type { ConsumeMessage } from 'amqplib';
import type { Logger } from 'pino';
import type { Mailer } from './mailer.ts';
import { handleCommand } from './handler.ts';
import { parseEmailCommand } from './contract.ts';

export type ConsumerDeps = {
    channel: { ack: (msg: ConsumeMessage) => void; nack: (msg: ConsumeMessage, allUpTo: boolean, requeue: boolean) => void };
    mailer: Mailer;
    baseUrl: string;
    log: Logger;
};

/**
 * Processes a single queue message: validate → send → ack. Any failure (bad
 * JSON, contract violation, send error) is logged and the message is dropped
 * (nack, no requeue) so it can't block the queue forever.
 */
export const processMessage = async (deps: ConsumerDeps, msg: ConsumeMessage): Promise<void> => {
    const { channel, mailer, baseUrl, log } = deps;
    try {
        const command = parseEmailCommand(JSON.parse(msg.content.toString()));
        await handleCommand(mailer, baseUrl, command);
        channel.ack(msg);
        log.info({ emailType: command.type, recipient: command.email }, 'Email delivered');
    } catch (err) {
        log.error({ err }, 'Failed to process message');
        channel.nack(msg, false, false);
    }
};
