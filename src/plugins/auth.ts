import fastifyPlugin from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppConfig } from '../config.ts';

const PUBLIC_PATHS = new Set([
    '/api/subscriptions',
    '/api/confirm',
    '/api/unsubscribe',
    '/health',
    '/',
]);

const authPlugin = async (fastify: FastifyInstance, config: AppConfig) => {
    fastify.addHook('preHandler', async (request: FastifyRequest, reply) => {
        const path = request.raw.url ?? request.url;

        if (!path.startsWith('/api')) {
            return;
        }
        for (const p of PUBLIC_PATHS) {
            if (path.startsWith(p)) {
                return;
            }
        }

        const headersApiKey = String(request.headers['x-api-key'] ?? '');
        if (headersApiKey !== config.apiKey) {
            request.log?.warn({ ip: request.ip, path }, 'Unauthorized request');
            return reply.status(401).send({ error: 'Unauthorized' });
        }
    });
};

export default fastifyPlugin(authPlugin);
