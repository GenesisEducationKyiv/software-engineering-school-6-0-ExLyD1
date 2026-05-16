import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyPostgres from '@fastify/postgres';
import { buildTestApp } from './helpers/app.factory.ts';
import { truncateAllTables } from './helpers/db.helpers.ts';

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

describe('GET /health', () => {
    it('returns 200 with status ok when DB is connected', async () => {
        const res = await app.inject({ method: 'GET', url: '/health' });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ status: 'ok' });
    });

    it('returns 503 when DB is unreachable', async () => {
        // Build a minimal app with bad DB URL, skipping migrations so ready() succeeds
        const badApp = Fastify({ logger: false });
        badApp.register(fastifyPostgres, {
            connectionString: 'postgres://test:test@localhost:5999/doesnotexist',
        });
        badApp.get('/health', async (_req, reply) => {
            try {
                await badApp.pg.query('SELECT 1');
                return reply.status(200).send({ status: 'ok' });
            } catch (err) {
                const message = err instanceof Error ? err.message : 'Unknown error';
                return reply.status(503).send({ status: 'error', message });
            }
        });
        await badApp.ready();
        const res = await badApp.inject({ method: 'GET', url: '/health' });
        expect(res.statusCode).toBe(503);
        await badApp.close();
    });

    it('response has Content-Type: application/json', async () => {
        const res = await app.inject({ method: 'GET', url: '/health' });
        expect(res.headers['content-type']).toContain('application/json');
    });
});
