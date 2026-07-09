import Fastify, { type FastifyInstance } from 'fastify';
import { type Mock } from 'vitest';
import fastifyPostgres from '@fastify/postgres';
import authPlugin from '../../../src/modules/shared/auth/auth.plugin.ts';
import subscriptionRoutes from '../../../src/modules/subscriptions/subscription.controller.ts';
import healthRoutes from '../../../src/modules/shared/health/health.controller.ts';
import { runMigrations } from '../../../src/database/migrate.ts';
import { createGitHubClient } from '../../../src/modules/shared/github/github.client.ts';
import type {
    ConfirmationMailer,
    NotificationMailer,
} from '../../../src/modules/shared/mailer/mailer.types.ts';
import type { GitHubClient } from '../../../src/modules/shared/github/github.types.ts';

export type MockMailer = {
    sendConfirmationEmail: Mock;
    sendReleaseNotification: Mock;
};

export type BuildTestAppOptions = {
    mailerOverride?: MockMailer;
    githubOverride?: GitHubClient;
    apiKey?: string;
    dbUrl?: string;
};

export async function buildTestApp(options: BuildTestAppOptions = {}): Promise<FastifyInstance> {
    const {
        mailerOverride,
        githubOverride,
        apiKey = 'test-api-key',
        dbUrl = process.env.TEST_DB_URL ??
            'postgres://test:test@localhost:5433/github_notifier_test',
    } = options;

    const config = {
        apiKey,
        databaseUrl: dbUrl,
        githubBaseUrl: process.env.GITHUB_BASE_URL ?? 'https://api.github.com',
        githubToken: process.env.GITHUB_TOKEN,
        rabbitmqUrl: 'amqp://localhost:5672',
        scannerIntervalMs: 9_999_999,
        port: 3000,
        logLevel: 'silent' as const,
        notificationGrpcAddr: process.env.NOTIFICATION_GRPC_ADDR ?? '127.0.0.1:50051',
    };

    const fastify = Fastify({ logger: false });

    fastify.register(fastifyPostgres, { connectionString: config.databaseUrl });

    const mailer: ConfirmationMailer & NotificationMailer = mailerOverride ?? {
        sendConfirmationEmail: async () => {},
        sendReleaseNotification: async () => {},
    };
    fastify.decorate('mailer', mailer);

    const github: GitHubClient =
        githubOverride ?? createGitHubClient(config.githubBaseUrl, config.githubToken);
    fastify.decorate('github', github);

    fastify.register(authPlugin, config);
    fastify.register(subscriptionRoutes);
    fastify.register(healthRoutes);

    fastify.addHook('onReady', async () => {
        await runMigrations(fastify);
    });

    await fastify.ready();
    return fastify;
}
