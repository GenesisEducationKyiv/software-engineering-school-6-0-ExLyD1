import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp } from './helpers/app.factory.ts';
import { truncateAllTables, seedSubscription, getSubscriptionRow } from './helpers/db.helpers.ts';

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

describe('GET /api/unsubscribe/:token', () => {
    it('400: token is not UUID format', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/unsubscribe/not-a-uuid' });
        expect(res.statusCode).toBe(400);
    });

    it('200: seeded subscription is deleted from DB', async () => {
        const { unsubscribeToken } = await seedSubscription(app.pg, {
            email: 'user@example.com',
            repo: 'org/repo',
        });

        const res = await app.inject({
            method: 'GET',
            url: `/api/unsubscribe/${unsubscribeToken}`,
        });
        expect(res.statusCode).toBe(200);

        const row = await getSubscriptionRow(app.pg, 'user@example.com', 'org/repo');
        expect(row).toBeNull();
    });

    it('404: valid UUID not in DB', async () => {
        const uuid = '550e8400-e29b-41d4-a716-446655440000';
        const res = await app.inject({ method: 'GET', url: `/api/unsubscribe/${uuid}` });
        expect(res.statusCode).toBe(404);
    });

    it('response body contains message field', async () => {
        const { unsubscribeToken } = await seedSubscription(app.pg, {
            email: 'user@example.com',
            repo: 'org/repo',
        });
        const res = await app.inject({
            method: 'GET',
            url: `/api/unsubscribe/${unsubscribeToken}`,
        });
        expect(res.json()).toHaveProperty('message');
    });
});
