import fastifyPlugin from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { createGitHubClient } from './github.client.ts';
import type { GitHubClient } from './github.types.ts';
import type { AppConfig } from '../config/config.ts';

declare module 'fastify' {
    interface FastifyInstance {
        github: GitHubClient;
    }
}

const startMockGitHubServer = async (baseUrl: string) => {
    const { setupServer } = await import('msw/node');
    const { http, HttpResponse } = await import('msw');
    const server = setupServer(
        http.get(`${baseUrl}/repos/vitest-dev/vitest/releases/latest`, () =>
            HttpResponse.json({ tag_name: 'v3.0.0', name: 'Release v3.0.0' }),
        ),
        http.get(
            `${baseUrl}/repos/:owner/:repo/releases/latest`,
            () => new HttpResponse(null, { status: 404 }),
        ),
    );
    server.listen({ onUnhandledRequest: 'bypass' });
};

const githubConnector = async (fastify: FastifyInstance, config: AppConfig) => {
    if (process.env.GITHUB_MODE === 'stub') {
        fastify.log.warn('GitHub running in STUB mode — requests intercepted by MSW');
        await startMockGitHubServer(config.githubBaseUrl);
    }
    fastify.decorate('github', createGitHubClient(config.githubBaseUrl, config.githubToken));
};

export default fastifyPlugin(githubConnector);
