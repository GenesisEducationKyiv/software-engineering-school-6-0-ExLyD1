import type { FastifyBaseLogger } from 'fastify';
import type { DbPool } from '../shared/db/db.types.ts';
import type { RabbitChannel } from '../shared/messaging/rabbit.ts';
import { SAGA_REPLIES_QUEUE, type SagaReply } from '../shared/messaging/email-commands.ts';
import { handleReply } from './saga.orchestrator.ts';

export const startReplyConsumer = async (
    db: DbPool,
    channel: RabbitChannel,
    log: FastifyBaseLogger,
): Promise<void> => {
    await channel.assertQueue(SAGA_REPLIES_QUEUE, { durable: true });
    await channel.consume(SAGA_REPLIES_QUEUE, (msg) => {
        if (!msg) {
            return;
        }
        void (async () => {
            try {
                const reply = JSON.parse(msg.content.toString()) as SagaReply;
                await handleReply(db, reply);
                channel.ack(msg);
            } catch (err) {
                log.error({ err }, 'Saga reply processing failed');
                channel.nack(msg, false, false);
            }
        })();
    });
};
