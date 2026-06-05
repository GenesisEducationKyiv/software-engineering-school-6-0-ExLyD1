import { connect } from 'amqplib';
import { EMAIL_QUEUE } from './email-commands.ts';

// Derive the connection/channel types from the installed amqplib version so we
// stay robust across its type changes (Connection vs ChannelModel etc.).
export type RabbitConnection = Awaited<ReturnType<typeof connect>>;
export type RabbitChannel = Awaited<ReturnType<RabbitConnection['createChannel']>>;

export const connectRabbit = async (
    url: string,
): Promise<{ connection: RabbitConnection; channel: RabbitChannel }> => {
    const connection = await connect(url);
    const channel = await connection.createChannel();
    // Durable queue so messages survive a broker restart.
    await channel.assertQueue(EMAIL_QUEUE, { durable: true });
    return { connection, channel };
};
