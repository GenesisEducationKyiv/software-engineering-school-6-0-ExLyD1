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

describe('GET /api/confirm/:token', () => {
    it('400: token is not UUID format', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/confirm/not-a-uuid' });
        expect(res.statusCode).toBe(400);
    });

    it('200: seeded subscription is confirmed and row has confirmed=true', async () => {
        const { confirmToken } = await seedSubscription(app.pg, {
            email: 'user@example.com',
            repo: 'org/repo',
        });

        const res = await app.inject({ method: 'GET', url: `/api/confirm/${confirmToken}` });
        expect(res.statusCode).toBe(200);

        const dbCheck = await app.pg.query<{ confirmed: boolean }>(
            `SELECT s.confirmed FROM subscriptions s
             JOIN users u ON u.id = s.user_id
             JOIN repositories r ON r.id = s.repository_id
             WHERE u.email = $1 AND r.owner_repo = $2`,
            ['user@example.com', 'org/repo'],
        );
        expect(dbCheck.rows[0].confirmed).toBe(true);
    });

    it('404: valid UUID not in DB', async () => {
        const uuid = '550e8400-e29b-41d4-a716-446655440000';
        const res = await app.inject({ method: 'GET', url: `/api/confirm/${uuid}` });
        expect(res.statusCode).toBe(404);
    });

    it('idempotent: confirming same token twice returns 200 both times', async () => {
        const { confirmToken } = await seedSubscription(app.pg, {
            email: 'user@example.com',
            repo: 'org/repo',
        });

        const res1 = await app.inject({ method: 'GET', url: `/api/confirm/${confirmToken}` });
        const res2 = await app.inject({ method: 'GET', url: `/api/confirm/${confirmToken}` });

        // UPDATE SET confirmed=true matches the row even when already confirmed, so both succeed
        expect(res1.statusCode).toBe(200);
        expect(res2.statusCode).toBe(200);
    });

    it('response body contains message field', async () => {
        const { confirmToken } = await seedSubscription(app.pg, {
            email: 'user@example.com',
            repo: 'org/repo',
        });
        const res = await app.inject({ method: 'GET', url: `/api/confirm/${confirmToken}` });
        expect(res.json()).toHaveProperty('message');
    });
});
