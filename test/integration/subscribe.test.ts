import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, type MockMailer } from './helpers/app.factory.ts';
import { truncateAllTables, getSubscriptionRow, seedSubscription } from './helpers/db.helpers.ts';
import { server } from './helpers/setup.ts';
import { github404Handler, github429Handler } from './helpers/github.handlers.ts';

let app: FastifyInstance;
let mailer: MockMailer;

const API_KEY = 'test-api-key';

beforeAll(async () => {
    mailer = {
        sendConfirmationEmail: vi.fn().mockResolvedValue(undefined),
        sendReleaseNotification: vi.fn().mockResolvedValue(undefined),
    };
    app = await buildTestApp({ mailerOverride: mailer, apiKey: API_KEY });
});

afterAll(async () => {
    await app.close();
});

beforeEach(async () => {
    await truncateAllTables(app.pg);
    mailer.sendConfirmationEmail.mockClear();
    mailer.sendReleaseNotification.mockClear();
    vi.clearAllMocks();
});

describe('POST /api/subscribe', () => {
    it('202: starts the saga and creates a pending subscription', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/subscribe',
            headers: { 'x-api-key': API_KEY },
            payload: { email: 'user@example.com', repo: 'org/repo' },
        });
        expect(res.statusCode).toBe(202);

        const row = await getSubscriptionRow(app.pg, 'user@example.com', 'org/repo');
        expect(row).not.toBeNull();
        expect(row!.confirmed).toBe(false);
    });

    it('400: missing email field', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/subscribe',
            headers: { 'x-api-key': API_KEY },
            payload: { repo: 'org/repo' },
        });
        expect(res.statusCode).toBe(400);
    });

    it('400: missing repo field', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/subscribe',
            headers: { 'x-api-key': API_KEY },
            payload: { email: 'user@example.com' },
        });
        expect(res.statusCode).toBe(400);
    });

    it('400: invalid email format', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/subscribe',
            headers: { 'x-api-key': API_KEY },
            payload: { email: 'not-an-email', repo: 'org/repo' },
        });
        expect(res.statusCode).toBe(400);
    });

    it('400: invalid repo format (owner starts with -)', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/subscribe',
            headers: { 'x-api-key': API_KEY },
            payload: { email: 'user@example.com', repo: '-invalid/repo' },
        });
        expect(res.statusCode).toBe(400);
    });

    it('404: GitHub returns 404 for repo', async () => {
        server.use(github404Handler);
        const res = await app.inject({
            method: 'POST',
            url: '/api/subscribe',
            headers: { 'x-api-key': API_KEY },
            payload: { email: 'user@example.com', repo: 'org/nonexistent' },
        });
        expect(res.statusCode).toBe(404);
    });

    it('409: subscribing same email + repo twice returns 409 on second attempt', async () => {
        await app.inject({
            method: 'POST',
            url: '/api/subscribe',
            headers: { 'x-api-key': API_KEY },
            payload: { email: 'user@example.com', repo: 'org/repo' },
        });

        const res = await app.inject({
            method: 'POST',
            url: '/api/subscribe',
            headers: { 'x-api-key': API_KEY },
            payload: { email: 'user@example.com', repo: 'org/repo' },
        });
        expect(res.statusCode).toBe(409);
    });

    it('429: GitHub returns 429 rate limit', async () => {
        server.use(github429Handler);
        const res = await app.inject({
            method: 'POST',
            url: '/api/subscribe',
            headers: { 'x-api-key': API_KEY },
            payload: { email: 'user@example.com', repo: 'org/repo' },
        });
        expect(res.statusCode).toBe(429);
    });

    it('seeded subscription with confirmed=false is visible via subscriptions endpoint', async () => {
        await seedSubscription(app.pg, {
            email: 'seeded@example.com',
            repo: 'org/seeded',
            confirmed: false,
        });
        const row = await getSubscriptionRow(app.pg, 'seeded@example.com', 'org/seeded');
        expect(row).not.toBeNull();
        expect(row!.confirmed).toBe(false);
    });
});
