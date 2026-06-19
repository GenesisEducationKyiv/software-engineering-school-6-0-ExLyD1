import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type {} from '../../shared/mailer/mailer.plugin.ts';
import type {} from '../../shared/github/github.plugin.ts';

vi.mock('../subscription.service.ts', () => ({
    subscribe: vi.fn(),
    confirmSubscription: vi.fn(),
    deleteSubscription: vi.fn(),
    getSubscriptionsByEmail: vi.fn(),
}));

import {
    subscribe,
    confirmSubscription,
    deleteSubscription,
    getSubscriptionsByEmail,
} from '../subscription.service.ts';
import { AlreadySubscribedError } from '../subscription.errors.ts';
import { GitHubApiError, InvalidRepoFormatError } from '../../shared/github/github.errors.ts';
import routes from '../subscription.controller.ts';
import type { GitHubRelease } from '../../shared/github/github.types.ts';

const mockSubscribe = vi.mocked(subscribe);
const mockConfirmSubscription = vi.mocked(confirmSubscription);
const mockDeleteSubscription = vi.mocked(deleteSubscription);
const mockGetSubscriptionsByEmail = vi.mocked(getSubscriptionsByEmail);

function buildApp(githubOverrides?: { getLatestRelease?: () => Promise<GitHubRelease | null> }) {
    const app = Fastify({ logger: false });

    app.decorate('github', {
        getLatestRelease: githubOverrides?.getLatestRelease ?? vi.fn().mockResolvedValue(null),
    });
    app.decorate('mailer', {
        sendConfirmationEmail: vi.fn().mockResolvedValue(undefined),
        sendReleaseNotification: vi.fn().mockResolvedValue(undefined),
    });

    app.register(routes);
    return app;
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('POST /api/subscribe', () => {
    it('responds 409 and does not send email when already subscribed', async () => {
        const mockGetLatestRelease = vi
            .fn()
            .mockResolvedValue({ tag_name: 'v1.0.0' } as GitHubRelease);
        mockSubscribe.mockRejectedValue(new AlreadySubscribedError());

        const mockSendConfirmationEmail = vi.fn().mockResolvedValue(undefined);
        const app = Fastify({ logger: false });
        app.decorate('github', { getLatestRelease: mockGetLatestRelease });
        app.decorate('mailer', {
            sendConfirmationEmail: mockSendConfirmationEmail,
            sendReleaseNotification: vi.fn().mockResolvedValue(undefined),
        });
        app.register(routes);

        const response = await app.inject({
            method: 'POST',
            url: '/api/subscribe',
            payload: { email: 'user@example.com', repo: 'org/repo' },
        });

        expect(response.statusCode).toBe(409);
        expect(response.json()).toMatchObject({ error: expect.stringContaining('already') });
        expect(mockSendConfirmationEmail).not.toHaveBeenCalled();
    });

    it('responds 404 and does not touch the database when GitHub returns no releases', async () => {
        const app = buildApp({ getLatestRelease: vi.fn().mockResolvedValue(null) });

        const response = await app.inject({
            method: 'POST',
            url: '/api/subscribe',
            payload: { email: 'user@example.com', repo: 'org/nonexistent' },
        });

        expect(response.statusCode).toBe(404);
        expect(response.json()).toMatchObject({ error: expect.stringContaining('not found') });
        expect(mockSubscribe).not.toHaveBeenCalled();
    });

    it('responds 500 when email sending fails (subscribe rolls back and throws)', async () => {
        const smtpError = new Error('SMTP connection refused');
        mockSubscribe.mockRejectedValue(smtpError);

        const app = Fastify({ logger: { level: 'silent' } });
        const logErrorSpy = vi.spyOn(app.log, 'error');

        app.decorate('github', {
            getLatestRelease: vi.fn().mockResolvedValue({ tag_name: 'v1.0.0' } as GitHubRelease),
        });
        app.decorate('mailer', {
            sendConfirmationEmail: vi.fn().mockResolvedValue(undefined),
            sendReleaseNotification: vi.fn().mockResolvedValue(undefined),
        });
        app.register(routes);

        const response = await app.inject({
            method: 'POST',
            url: '/api/subscribe',
            payload: { email: 'user@example.com', repo: 'org/repo' },
        });

        expect(response.statusCode).toBe(500);
        expect(response.json()).toMatchObject({ error: 'Internal server error' });
        expect(mockSubscribe).toHaveBeenCalledOnce();
        expect(logErrorSpy).toHaveBeenCalledWith(
            expect.objectContaining({ err: smtpError }),
            expect.stringContaining('email'),
        );
    });

    it('responds 400 when email is missing', async () => {
        const app = buildApp({ getLatestRelease: vi.fn().mockResolvedValue(null) });
        const response = await app.inject({
            method: 'POST',
            url: '/api/subscribe',
            payload: { repo: 'org/repo' },
        });
        expect(response.statusCode).toBe(400);
    });

    it('responds 400 when email is invalid', async () => {
        const app = buildApp();
        const response = await app.inject({
            method: 'POST',
            url: '/api/subscribe',
            payload: { email: 'not-an-email', repo: 'org/repo' },
        });
        expect(response.statusCode).toBe(400);
    });

    it('responds 400 when repo is missing', async () => {
        const app = buildApp();
        const response = await app.inject({
            method: 'POST',
            url: '/api/subscribe',
            payload: { email: 'user@example.com' },
        });
        expect(response.statusCode).toBe(400);
    });

    it('responds 400 when repo format is invalid (InvalidRepoFormatError from GitHub client)', async () => {
        const app = buildApp({
            getLatestRelease: vi.fn().mockRejectedValue(new InvalidRepoFormatError()),
        });
        const response = await app.inject({
            method: 'POST',
            url: '/api/subscribe',
            payload: { email: 'user@example.com', repo: '-invalid/repo' },
        });
        expect(response.statusCode).toBe(400);
        expect(response.json()).toMatchObject({
            error: expect.stringContaining('Invalid repository'),
        });
    });

    it('responds 202 on success and calls mailer', async () => {
        mockSubscribe.mockResolvedValue('confirm-token-123');
        const mockSendConfirmationEmail = vi.fn().mockResolvedValue(undefined);
        const app = Fastify({ logger: false });
        app.decorate('github', {
            getLatestRelease: vi.fn().mockResolvedValue({ tag_name: 'v1.0.0' } as GitHubRelease),
        });
        app.decorate('mailer', {
            sendConfirmationEmail: mockSendConfirmationEmail,
            sendReleaseNotification: vi.fn().mockResolvedValue(undefined),
        });
        app.register(routes);

        const response = await app.inject({
            method: 'POST',
            url: '/api/subscribe',
            payload: { email: 'user@example.com', repo: 'org/repo' },
        });

        expect(response.statusCode).toBe(202);
        expect(mockSendConfirmationEmail).toHaveBeenCalledOnce();
    });

    it('responds 429 when GitHub API returns rate limit error', async () => {
        const app = buildApp({
            getLatestRelease: vi.fn().mockRejectedValue(new GitHubApiError(429)),
        });
        const response = await app.inject({
            method: 'POST',
            url: '/api/subscribe',
            payload: { email: 'user@example.com', repo: 'org/repo' },
        });
        expect(response.statusCode).toBe(429);
    });

    it('responds 500 when GitHub API returns generic error', async () => {
        const app = Fastify({ logger: { level: 'silent' } });
        app.decorate('github', {
            getLatestRelease: vi.fn().mockRejectedValue(new GitHubApiError(500)),
        });
        app.decorate('mailer', {
            sendConfirmationEmail: vi.fn(),
            sendReleaseNotification: vi.fn(),
        });
        app.register(routes);
        const response = await app.inject({
            method: 'POST',
            url: '/api/subscribe',
            payload: { email: 'user@example.com', repo: 'org/repo' },
        });
        expect(response.statusCode).toBe(500);
    });
});

describe('GET /api/confirm/:token', () => {
    it('responds 400 when token is not a valid UUID', async () => {
        const app = buildApp();
        const response = await app.inject({
            method: 'GET',
            url: '/api/confirm/not-a-uuid',
        });
        expect(response.statusCode).toBe(400);
    });

    it('responds 200 when token is found', async () => {
        mockConfirmSubscription.mockResolvedValue(true);
        const app = buildApp();
        const uuid = '550e8400-e29b-41d4-a716-446655440000';
        const response = await app.inject({
            method: 'GET',
            url: `/api/confirm/${uuid}`,
        });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({ message: expect.any(String) });
    });

    it('responds 404 when token is not found', async () => {
        mockConfirmSubscription.mockResolvedValue(false);
        const app = buildApp();
        const uuid = '550e8400-e29b-41d4-a716-446655440000';
        const response = await app.inject({
            method: 'GET',
            url: `/api/confirm/${uuid}`,
        });
        expect(response.statusCode).toBe(404);
    });

    it('responds 500 when service throws', async () => {
        mockConfirmSubscription.mockRejectedValue(new Error('db error'));
        const app = Fastify({ logger: { level: 'silent' } });
        app.decorate('github', { getLatestRelease: vi.fn() });
        app.decorate('mailer', {
            sendConfirmationEmail: vi.fn(),
            sendReleaseNotification: vi.fn(),
        });
        app.register(routes);
        const uuid = '550e8400-e29b-41d4-a716-446655440000';
        const response = await app.inject({
            method: 'GET',
            url: `/api/confirm/${uuid}`,
        });
        expect(response.statusCode).toBe(500);
    });
});

describe('GET /api/unsubscribe/:token', () => {
    it('responds 400 when token is not a valid UUID', async () => {
        const app = buildApp();
        const response = await app.inject({
            method: 'GET',
            url: '/api/unsubscribe/not-a-uuid',
        });
        expect(response.statusCode).toBe(400);
    });

    it('responds 200 when token is found', async () => {
        mockDeleteSubscription.mockResolvedValue(true);
        const app = buildApp();
        const uuid = '550e8400-e29b-41d4-a716-446655440000';
        const response = await app.inject({
            method: 'GET',
            url: `/api/unsubscribe/${uuid}`,
        });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({ message: expect.any(String) });
    });

    it('responds 404 when token is not found', async () => {
        mockDeleteSubscription.mockResolvedValue(false);
        const app = buildApp();
        const uuid = '550e8400-e29b-41d4-a716-446655440000';
        const response = await app.inject({
            method: 'GET',
            url: `/api/unsubscribe/${uuid}`,
        });
        expect(response.statusCode).toBe(404);
    });

    it('responds 500 when service throws', async () => {
        mockDeleteSubscription.mockRejectedValue(new Error('db error'));
        const app = Fastify({ logger: { level: 'silent' } });
        app.decorate('github', { getLatestRelease: vi.fn() });
        app.decorate('mailer', {
            sendConfirmationEmail: vi.fn(),
            sendReleaseNotification: vi.fn(),
        });
        app.register(routes);
        const uuid = '550e8400-e29b-41d4-a716-446655440000';
        const response = await app.inject({
            method: 'GET',
            url: `/api/unsubscribe/${uuid}`,
        });
        expect(response.statusCode).toBe(500);
    });
});

describe('GET /api/subscriptions', () => {
    it('responds 400 when email query param is missing', async () => {
        const app = buildApp();
        const response = await app.inject({ method: 'GET', url: '/api/subscriptions' });
        expect(response.statusCode).toBe(400);
    });

    it('responds 400 when email format is invalid', async () => {
        const app = buildApp();
        const response = await app.inject({
            method: 'GET',
            url: '/api/subscriptions?email=not-an-email',
        });
        expect(response.statusCode).toBe(400);
    });

    it('responds 200 with empty array when no subscriptions', async () => {
        mockGetSubscriptionsByEmail.mockResolvedValue([]);
        const app = buildApp();
        const response = await app.inject({
            method: 'GET',
            url: '/api/subscriptions?email=user@example.com',
        });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual([]);
    });

    it('responds 200 with subscription rows', async () => {
        const rows = [
            {
                email: 'user@example.com',
                repo: 'org/repo',
                confirmed: true,
                last_seen_tag: 'v1.0.0',
            },
        ];
        mockGetSubscriptionsByEmail.mockResolvedValue(rows as never);
        const app = buildApp();
        const response = await app.inject({
            method: 'GET',
            url: '/api/subscriptions?email=user@example.com',
        });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual(rows);
    });
});
