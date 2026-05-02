// ESM
import Fastify, { type FastifyRequest, type FastifyError } from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyRateLimit from '@fastify/rate-limit';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import subscriptionRoutes from './api/subscription.ts';
import dbConnector from './plugins/db.ts';
import mailerConnector from './plugins/mailer.ts';
import dotenv from 'dotenv';
import { runMigrations } from './database/migrate.ts';
import { startScanner } from './services/index.ts';

dotenv.config();

const REQUIRED_ENV_VARS = [
    'DATABASE_URL',
    'GITHUB_BASE_URL',
    'RESEND_API_KEY',
    'SMTP_FROM',
    'BASE_URL',
    'API_KEY',
] as const;

for (const key of REQUIRED_ENV_VARS) {
    if (!process.env[key]) {
        // eslint-disable-next-line no-console
        console.error(`Missing required env var: ${key}`);
        process.exit(1);
    }
}

const publicPaths = new Set([
    '/api/subscriptions',
    '/api/confirm',
    '/api/unsubscribe',
    '/health',
    '/',
]);

const SCANNER_INTERVAL_MS = parseInt(process.env.SCANNER_INTERVAL_MS ?? '', 10);
if (isNaN(SCANNER_INTERVAL_MS)) {
    // eslint-disable-next-line no-console
    console.error(
        'Missing or invalid env var: SCANNER_INTERVAL_MS must be a valid integer (milliseconds)',
    );
    process.exit(1);
}

const PORT = process.env.PORT || 3000;
const __dirname = dirname(fileURLToPath(import.meta.url));

const fastify = Fastify({
    logger: true,
});

fastify.register(fastifyRateLimit, { global: false });

fastify.register(dbConnector);
fastify.register(mailerConnector);
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
    if (headersApiKey !== process.env.API_KEY) {
        request.log?.warn({ ip: request.ip, path }, 'Unauthorized request');
        return reply.status(401).send({ error: 'Unauthorized' });
    }
});

fastify.addHook('onReady', async () => {
    await runMigrations(fastify);
    startScanner(fastify, SCANNER_INTERVAL_MS);
});

// Run the server!
fastify.listen({ port: Number(PORT), host: '0.0.0.0' }, function (err) {
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
