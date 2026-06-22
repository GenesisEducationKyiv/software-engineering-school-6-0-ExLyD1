import fastifyPlugin from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { createNotificationClient, type NotificationQueryClient } from './notification.client.ts';
import type { AppConfig } from '../config/config.ts';

declare module 'fastify' {
    interface FastifyInstance {
        notificationQuery: NotificationQueryClient;
    }
}

const notificationGrpcConnector = async (fastify: FastifyInstance, config: AppConfig) => {
    const client = createNotificationClient(config.notificationGrpcAddr);
    fastify.decorate('notificationQuery', client);
    fastify.addHook('onClose', async () => client.close());
};

export default fastifyPlugin(notificationGrpcConnector);
