import type { FastifyBaseLogger } from 'fastify';
import type { DbPool } from '../shared/db/db.types.ts';
import type { RabbitChannel } from '../shared/messaging/rabbit.ts';
import { fetchUnpublished, markPublished } from './outbox.repository.ts';

const BATCH_SIZE = 20;

/**
 * Polls the outbox and publishes unpublished rows to RabbitMQ, then marks them
 * published. At-least-once: if the publish succeeds but marking fails, the row is
 * re-published later — consumers must be idempotent.
 */
export const startRelay = (
    db: DbPool,
    channel: RabbitChannel,
    log: FastifyBaseLogger,
    intervalMs: number,
): ReturnType<typeof setInterval> => {
    const run = async () => {
        const rows = await fetchUnpublished(db, BATCH_SIZE);
        for (const row of rows) {
            channel.sendToQueue(row.queue, Buffer.from(JSON.stringify(row.payload)), {
                persistent: true,
            });
            await markPublished(db, row.id);
        }
    };

    return setInterval(() => {
        run().catch((err) => log.error({ err }, 'Outbox relay error'));
    }, intervalMs);
};
