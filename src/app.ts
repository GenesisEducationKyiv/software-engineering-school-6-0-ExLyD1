// ESM
import Fastify, { type FastifyRequest, type FastifyError } from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyRateLimit from '@fastify/rate-limit';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { loadConfig } from './config.ts';
import subscriptionRoutes from './controllers/subscription.ts';
import dbConnector from './plugins/db.ts';
import mailerConnector from './plugins/mailer.ts';
import githubConnector from './plugins/github.ts';
import { runMigrations } from './database/migrate.ts';
import { startScanner } from './services/scanner.ts';

dotenv.config();

let config;
try {
    config = loadConfig();
} catch (err) {
    // eslint-disable-next-line no-console
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
}

const publicPaths = new Set([
    '/api/subscriptions',
    '/api/confirm',
    '/api/unsubscribe',
    '/health',
    '/',
]);

const __dirname = dirname(fileURLToPath(import.meta.url));

const fastify = Fastify({ logger: true });

fastify.register(fastifyRateLimit, { global: false });

fastify.register(dbConnector, config);
fastify.register(mailerConnector, config);
fastify.register(githubConnector, config);
fastify.register(subscriptionRoutes);

fastify.register(fastifyStatic, {
    root: join(__dirname, '..', 'public'),
    prefix: '/',
    index: 'index.html',
    wildcard: false,
});

fastify.get('/health', async (_request, reply) => {
    try {
        await fastify.pg.query('SELECT 1');
        return reply.status(200).send({ status: 'ok' });
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return reply.status(503).send({ status: 'error', message });
    }
});

fastify.setErrorHandler((error: FastifyError, _request, reply) => {
    const statusCode = error.statusCode ?? 500;
    if (statusCode < 500) {
        return reply.status(statusCode).send({ error: error.message });
    }
    fastify.log.error({ err: error }, 'Unhandled route error');
    reply.status(500).send({ error: 'Internal server error' });
});

fastify.addHook('preHandler', async (request: FastifyRequest, reply) => {
    const path = request.raw.url ?? request.url;

    if (!path.startsWith('/api')) {
        return;
    }
    for (const p of publicPaths) {
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

fastify.addHook('onReady', async () => {
    await runMigrations(fastify);

    const timer = startScanner(
        fastify.pg,
        fastify.github,
        fastify.mailer,
        fastify.log,
        config.scannerIntervalMs,
    );

    fastify.addHook('onClose', async () => {
        clearInterval(timer);
        fastify.log.info('Scanner: stopped');
    });

    fastify.log.info(`Scanner: started, interval ${config.scannerIntervalMs / 1000}s`);
});

fastify.listen({ port: config.port, host: '0.0.0.0' }, function (err) {
    if (err) {
        fastify.log.error(err);
        process.exit(1);
    }
});

const shutdown = () => {
    fastify.close().catch((err) => {
        fastify.log.error(err, 'Error during shutdown');
        process.exit(1);
    });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
