import Fastify, { type FastifyInstance } from 'fastify';
import { type Mock } from 'vitest';
import fastifyPostgres from '@fastify/postgres';
import authPlugin from '../../../src/plugins/auth.ts';
import subscriptionRoutes from '../../../src/controllers/subscription.ts';
import healthRoutes from '../../../src/controllers/health.ts';
import { runMigrations } from '../../../src/database/migrate.ts';
import { createGitHubClient } from '../../../src/clients/index.ts';
import type {
    ConfirmationMailer,
    GitHubClient,
    NotificationMailer,
} from '../../../src/types/index.ts';

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
        resendApiKey: 'test-key',
        smtpFrom: 'test@example.com',
        baseUrl: 'http://localhost:3000',
        scannerIntervalMs: 9_999_999,
        port: 3000,
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
