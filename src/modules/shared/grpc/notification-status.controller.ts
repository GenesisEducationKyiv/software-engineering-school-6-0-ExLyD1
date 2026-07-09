import type { FastifyInstance } from 'fastify';
import * as grpc from '@grpc/grpc-js';
import { notificationStatusToJSON } from './generated/notification/v1/notification.ts';

// Edge route that calls the notification-service over gRPC and translates the
// gRPC status codes back into HTTP for browser clients.
async function routes(fastify: FastifyInstance) {
    fastify.get('/api/notifications/:sagaId', async (request, reply) => {
        const { sagaId } = request.params as { sagaId: string };
        try {
            const res = await fastify.notificationQuery.getNotificationStatus(sagaId);
            return reply.status(200).send({
                status: notificationStatusToJSON(res.status),
                recipient: res.recipient,
            });
        } catch (err) {
            const code = (err as { code?: number }).code;
            if (code === grpc.status.INVALID_ARGUMENT) {
                return reply.status(400).send({ error: 'Invalid saga id' });
            }
            if (code === grpc.status.NOT_FOUND) {
                return reply.status(404).send({ error: 'Notification not found' });
            }
            fastify.log.error({ err }, 'gRPC notification status failed');
            return reply.status(502).send({ error: 'Notification service unavailable' });
        }
    });
}

export default routes;
