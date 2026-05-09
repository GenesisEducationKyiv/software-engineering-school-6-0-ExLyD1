import fastifyPlugin from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { createGitHubClient } from '../services/github.ts';
import type { GitHubClient } from '../types/index.ts';
import type { AppConfig } from '../config.ts';

declare module 'fastify' {
    interface FastifyInstance {
        github: GitHubClient;
    }
}

const githubConnector = async (fastify: FastifyInstance, config: AppConfig) => {
    fastify.decorate('github', createGitHubClient(config.githubBaseUrl, config.githubToken));
};

export default fastifyPlugin(githubConnector);
