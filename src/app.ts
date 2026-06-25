// ESM
import Fastify, { type FastifyError, type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyRateLimit from '@fastify/rate-limit';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';
import { loadConfig } from './modules/shared/config/config.ts';
import subscriptionRoutes from './modules/subscriptions/subscription.controller.ts';
import healthRoutes from './modules/shared/health/health.controller.ts';
import dbConnector from './modules/shared/db/db.plugin.ts';
import mailerConnector from './modules/shared/mailer/mailer.plugin.ts';
import githubConnector from './modules/shared/github/github.plugin.ts';
import authPlugin from './modules/shared/auth/auth.plugin.ts';
import metricsPlugin from './modules/shared/metrics/metrics.plugin.ts';
import { runMigrations } from './database/migrate.ts';
import { startScanner } from './modules/scanner/scanner.service.ts';
import { notifyRelease } from './modules/subscriptions/subscription.notifications.ts';
import { startRelay } from './modules/saga/outbox.relay.ts';
import { startReplyConsumer } from './modules/saga/saga.replies.ts';

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

const fastify = Fastify({
    genReqId: () => randomUUID(),
    requestIdLogLabel: 'requestId',
    logger: {
        level: config.logLevel,
        base: { service: { name: 'github-release-notifier' }, component: 'api' },
        serializers: {
            req(request: FastifyRequest) {
                return {
                    method: request.method,
                    // route template, not the raw URL — avoids leaking emails and
                    // confirm/unsubscribe tokens into Elasticsearch.
                    url: request.routeOptions?.url ?? 'unknown',
                    userAgent: request.headers['user-agent'],
                    remoteAddress: request.ip,
                };
            },
        },
    },
});

fastify.register(metricsPlugin);

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

fastify.setErrorHandler((error: FastifyError, request, reply) => {
    const statusCode = error.statusCode ?? 500;
    if (statusCode < 500) {
        return reply.status(statusCode).send({ error: error.message });
    }
    // request.log carries the requestId, so the error is traceable to its request.
    request.log.error({ err: error }, 'Unhandled route error');
    reply.status(500).send({ error: 'Internal server error' });
});

fastify.addHook('onReady', async () => {
    await runMigrations(fastify);

    // Saga: outbox relay + reply consumer (skipped in stub mode — no broker).
    if (process.env.MAILER_MODE !== 'stub') {
        const sagaLog = fastify.log.child({ component: 'saga' });
        const relayTimer = startRelay(fastify.pg, fastify.rabbitChannel, sagaLog, 1000);
        await startReplyConsumer(fastify.pg, fastify.rabbitChannel, sagaLog);
        fastify.addHook('onClose', async () => {
            clearInterval(relayTimer);
        });
        sagaLog.info('Saga: outbox relay + reply consumer started');
    }

    const scannerLog = fastify.log.child({ component: 'scanner' });
    const onRelease = (repoId: number, ownerRepo: string, tag: string) =>
        notifyRelease(fastify.pg, fastify.mailer, scannerLog, repoId, ownerRepo, tag);
    const timer = startScanner(
        fastify.pg,
        fastify.github,
        scannerLog,
        config.scannerIntervalMs,
        onRelease,
    );

    fastify.addHook('onClose', async () => {
        clearInterval(timer);
        scannerLog.info('Scanner: stopped');
    });

    scannerLog.info(`Scanner: started, interval ${config.scannerIntervalMs / 1000}s`);
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
