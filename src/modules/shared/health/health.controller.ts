import type { FastifyInstance } from 'fastify';

async function healthRoutes(fastify: FastifyInstance) {
    fastify.get('/health', async (_request, reply) => {
        try {
            await fastify.pg.query('SELECT 1');
            return reply.status(200).send({ status: 'ok' });
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            return reply.status(503).send({ status: 'error', message });
        }
    });
}

export default healthRoutes;
