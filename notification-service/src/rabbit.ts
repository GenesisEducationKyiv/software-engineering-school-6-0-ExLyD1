import { connect } from 'amqplib';
import { EMAIL_QUEUE } from './contract.ts';

export type RabbitConnection = Awaited<ReturnType<typeof connect>>;
export type RabbitChannel = Awaited<ReturnType<RabbitConnection['createChannel']>>;

export const connectRabbit = async (
    url: string,
): Promise<{ connection: RabbitConnection; channel: RabbitChannel }> => {
    const connection = await connect(url);
    const channel = await connection.createChannel();
    await channel.assertQueue(EMAIL_QUEUE, { durable: true });
    // Take one unacked message at a time so work is fairly spread if we scale
    // out to several consumer instances.
    await channel.prefetch(1);
    return { connection, channel };
};
