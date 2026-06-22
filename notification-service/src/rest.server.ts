import Fastify from 'fastify';
import type { Logger } from 'pino';
import type { Db } from './db.ts';
import {
    getNotificationStatus,
    InvalidSagaIdError,
    NotificationNotFoundError,
} from './notification-query.ts';

// REST twin of the gRPC GetNotificationStatus — same domain call, HTTP/JSON
// transport. Kept alongside gRPC so the two can be benchmarked head-to-head.
export const buildRestServer = (db: Db, log: Logger) => {
    const app = Fastify({ loggerInstance: log });

    app.get('/notifications/:sagaId', async (request, reply) => {
        const { sagaId } = request.params as { sagaId: string };
        try {
            const result = await getNotificationStatus(db, sagaId);
            return reply.status(200).send(result);
        } catch (err) {
            if (err instanceof InvalidSagaIdError) {
                return reply.status(400).send({ error: err.message });
            }
            if (err instanceof NotificationNotFoundError) {
                return reply.status(404).send({ error: err.message });
            }
            log.error({ err }, 'REST GetNotificationStatus failed');
            return reply.status(500).send({ error: 'internal error' });
        }
    });

    return app;
};
