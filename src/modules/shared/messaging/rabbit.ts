import { connect } from 'amqplib';
import { EMAIL_QUEUE } from './email-commands.ts';

// Derive the connection/channel types from the installed amqplib version so we
// stay robust across its type changes (Connection vs ChannelModel etc.).
export type RabbitConnection = Awaited<ReturnType<typeof connect>>;
export type RabbitChannel = Awaited<ReturnType<RabbitConnection['createChannel']>>;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Connects with retry/backoff: the broker may still be starting (its health
 * check can pass before the AMQP port accepts connections), and brokers restart
 * in normal operation — a service must tolerate that instead of crashing.
 */
export const connectRabbit = async (
    url: string,
    { retries = 15, delayMs = 2000 }: { retries?: number; delayMs?: number } = {},
): Promise<{ connection: RabbitConnection; channel: RabbitChannel }> => {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const connection = await connect(url);
            const channel = await connection.createChannel();
            // Durable queue so messages survive a broker restart.
            await channel.assertQueue(EMAIL_QUEUE, { durable: true });
            return { connection, channel };
        } catch (err) {
            if (attempt === retries) {
                throw err;
            }
            await sleep(delayMs);
        }
    }
    // Unreachable: the loop returns on success or throws on the final attempt.
    throw new Error('RabbitMQ connection failed');
};
