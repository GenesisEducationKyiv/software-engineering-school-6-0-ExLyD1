// ESM
import Fastify, { type FastifyError } from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyRateLimit from '@fastify/rate-limit';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { loadConfig } from './config.ts';
import subscriptionRoutes from './controllers/subscription.ts';
import healthRoutes from './controllers/health.ts';
import dbConnector from './plugins/db.ts';
import mailerConnector from './plugins/mailer.ts';
import githubConnector from './plugins/github.ts';
import authPlugin from './plugins/auth.ts';
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

const __dirname = dirname(fileURLToPath(import.meta.url));

const fastify = Fastify({ logger: true });

fastify.register(fastifyRateLimit, { global: false });

fastify.register(dbConnector, config);
fastify.register(mailerConnector, config);
fastify.register(githubConnector, config);
fastify.register(authPlugin, config);
fastify.register(subscriptionRoutes);
fastify.register(healthRoutes);

fastify.register(fastifyStatic, {
    root: join(__dirname, '..', 'public'),
    prefix: '/',
    index: 'index.html',
    wildcard: false,
});

fastify.setErrorHandler((error: FastifyError, _request, reply) => {
    const statusCode = error.statusCode ?? 500;
    if (statusCode < 500) {
        return reply.status(statusCode).send({ error: error.message });
    }
    fastify.log.error({ err: error }, 'Unhandled route error');
    reply.status(500).send({ error: 'Internal server error' });
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
