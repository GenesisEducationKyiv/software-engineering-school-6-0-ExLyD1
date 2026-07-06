import type { FastifyInstance } from 'fastify';
import { EMAIL_REGEX, UUID_REGEX } from '../shared/constants/regex.ts';
import {
    confirmSubscription,
    deleteSubscription,
    getSubscriptionsByEmail,
    createPendingSubscription,
} from './subscription.service.ts';
import { startRegisterSubscription } from '../saga/index.ts';
import { AlreadySubscribedError } from './subscription.errors.ts';
import { GitHubApiError, InvalidRepoFormatError } from '../shared/github/github.errors.ts';

async function routes(fastify: FastifyInstance) {
    fastify.post(
        '/api/subscribe',
        { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } },
        async (request, reply) => {
            const body = request.body;
            if (!body || typeof body !== 'object' || Array.isArray(body)) {
                return reply.status(400).send({ error: 'Request body must be a JSON object' });
            }

            const { email, repo } = body as { email: unknown; repo: unknown };

            if (typeof email !== 'string' || typeof repo !== 'string' || !EMAIL_REGEX.test(email)) {
                return reply.status(400).send({ error: 'Invalid input' });
            }

            let latestRelease;
            try {
                latestRelease = await fastify.github.getLatestRelease(repo);
            } catch (err) {
                if (err instanceof InvalidRepoFormatError) {
                    return reply.status(400).send({ error: 'Invalid repository format' });
                }
                if (err instanceof GitHubApiError && err.status === 429) {
                    return reply
                        .status(429)
                        .send({ error: 'GitHub API rate limit exceeded. Please try again later.' });
                }
                fastify.log.error({ err }, 'POST /api/subscribe: GitHub API error');
                return reply.status(500).send({ error: 'Failed to reach GitHub API' });
            }

            if (!latestRelease) {
                return reply.status(404).send({ error: 'Repository not found on GitHub' });
            }

            try {
                const sagaId = await startRegisterSubscription(
                    fastify.pg,
                    email,
                    repo,
                    latestRelease.tag_name,
                    createPendingSubscription,
                );
                // Saga runs asynchronously (confirmation email via the notification
                // service). We accept the request now; the result arrives by email.
                return reply.status(202).send({
                    message: 'Registration in progress. Check your email to confirm.',
                    sagaId,
                });
            } catch (err) {
                if (err instanceof AlreadySubscribedError) {
                    return reply
                        .status(409)
                        .send({ error: 'Email already subscribed to this repository' });
                }
                fastify.log.error({ err }, 'POST /api/subscribe: failed to start saga');
                return reply.status(500).send({ error: 'Internal server error' });
            }
        },
    );

    fastify.get('/api/confirm/:token', async (request, reply) => {
        const { token } = request.params as { token: string };

        if (!UUID_REGEX.test(token)) {
            return reply.status(400).send({ error: 'Invalid token' });
        }

        try {
            const found = await confirmSubscription(fastify.pg, token);
            if (!found) {
                return reply.status(404).send({ error: 'Token not found' });
            }
            return reply.status(200).send({ message: 'Subscription confirmed successfully' });
        } catch (err) {
            fastify.log.error({ err }, 'GET /api/confirm: database error');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });

    fastify.get('/api/unsubscribe/:token', async (request, reply) => {
        const { token } = request.params as { token: string };

        if (!UUID_REGEX.test(token)) {
            return reply.status(400).send({ error: 'Invalid token' });
        }

        try {
            const found = await deleteSubscription(fastify.pg, token);
            if (!found) {
                return reply.status(404).send({ error: 'Token not found' });
            }
            return reply.status(200).send({ message: 'Unsubscribed successfully' });
        } catch (err) {
            fastify.log.error({ err }, 'GET /api/unsubscribe: database error');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });

    fastify.get('/api/subscriptions', async (request, reply) => {
        const { email } = request.query as { email?: string };
        if (!email || !EMAIL_REGEX.test(email)) {
            return reply.status(400).send({ error: 'Invalid email' });
        }

        try {
            const items = await getSubscriptionsByEmail(fastify.pg, email);
            return reply.status(200).send(items);
        } catch (err) {
            fastify.log.error({ err }, 'GET /api/subscriptions: database error');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
}

export default routes;
