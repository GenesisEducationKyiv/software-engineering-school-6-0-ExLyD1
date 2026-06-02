import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp } from './helpers/app.factory.ts';
import { truncateAllTables, seedSubscription } from './helpers/db.helpers.ts';

let app: FastifyInstance;

beforeAll(async () => {
    app = await buildTestApp();
});

afterAll(async () => {
    await app.close();
});

beforeEach(async () => {
    await truncateAllTables(app.pg);
    vi.clearAllMocks();
});

describe('GET /api/subscriptions', () => {
    it('400: no email query param', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/subscriptions' });
        expect(res.statusCode).toBe(400);
    });

    it('400: invalid email format in query param', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/subscriptions?email=not-an-email',
        });
        expect(res.statusCode).toBe(400);
    });

    it('200: unknown email returns empty array', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/subscriptions?email=unknown@example.com',
        });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual([]);
    });

    it('200: seeded unconfirmed subscription shows confirmed: false', async () => {
        await seedSubscription(app.pg, {
            email: 'user@example.com',
            repo: 'org/repo',
            confirmed: false,
        });

        const res = await app.inject({
            method: 'GET',
            url: '/api/subscriptions?email=user@example.com',
        });
        expect(res.statusCode).toBe(200);
        const rows = res.json() as Array<{ confirmed: boolean }>;
        expect(rows.length).toBe(1);
        expect(rows[0].confirmed).toBe(false);
    });

    it('200: seeded confirmed subscription shows confirmed: true', async () => {
        await seedSubscription(app.pg, {
            email: 'user@example.com',
            repo: 'org/repo',
            confirmed: true,
        });

        const res = await app.inject({
            method: 'GET',
            url: '/api/subscriptions?email=user@example.com',
        });
        expect(res.statusCode).toBe(200);
        const rows = res.json() as Array<{ confirmed: boolean }>;
        expect(rows.length).toBe(1);
        expect(rows[0].confirmed).toBe(true);
    });

    it('response shape has email, repo, confirmed, last_seen_tag fields', async () => {
        await seedSubscription(app.pg, {
            email: 'user@example.com',
            repo: 'org/repo',
            confirmed: true,
            lastSeenTag: 'v2.0.0',
        });

        const res = await app.inject({
            method: 'GET',
            url: '/api/subscriptions?email=user@example.com',
        });
        expect(res.statusCode).toBe(200);
        const [row] = res.json() as Array<Record<string, unknown>>;
        expect(row).toHaveProperty('email', 'user@example.com');
        expect(row).toHaveProperty('repo', 'org/repo');
        expect(row).toHaveProperty('confirmed', true);
        expect(row).toHaveProperty('last_seen_tag', 'v2.0.0');
    });
});
