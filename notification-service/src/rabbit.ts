import { connect } from 'amqplib';
import { EMAIL_QUEUE, EMAIL_DLX, EMAIL_DLQ } from './contract.ts';
import { logger } from './logger.ts';

export type RabbitConnection = Awaited<ReturnType<typeof connect>>;
export type RabbitChannel = Awaited<ReturnType<RabbitConnection['createChannel']>>;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Connects with retry/backoff so the consumer tolerates the broker still
 * starting up or restarting, instead of crashing on the first refused connection.
 */
export const connectRabbit = async (
    url: string,
    { retries = 15, delayMs = 2000 }: { retries?: number; delayMs?: number } = {},
): Promise<{ connection: RabbitConnection; channel: RabbitChannel }> => {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const connection = await connect(url);
            const channel = await connection.createChannel();
            // Dead-letter topology: a message the consumer rejects (nack) is parked
            // in the DLQ instead of being lost or requeued into an infinite loop.
            await channel.assertExchange(EMAIL_DLX, 'fanout', { durable: true });
            await channel.assertQueue(EMAIL_DLQ, { durable: true });
            await channel.bindQueue(EMAIL_DLQ, EMAIL_DLX, '');
            await channel.assertQueue(EMAIL_QUEUE, {
                durable: true,
                arguments: { 'x-dead-letter-exchange': EMAIL_DLX },
            });
            // Take one unacked message at a time so work is fairly spread if we
            // scale out to several consumer instances.
            await channel.prefetch(1);
            return { connection, channel };
        } catch (err) {
            if (attempt === retries) {
                throw err;
            }
            logger.warn(
                `RabbitMQ not ready (attempt ${attempt}/${retries}), retrying in ${delayMs}ms`,
            );
            await sleep(delayMs);
        }
    }
    throw new Error('RabbitMQ connection failed');
};
