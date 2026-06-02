import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyPostgres from '@fastify/postgres';
import { buildTestApp } from './helpers/app.factory.ts';
import { truncateAllTables } from './helpers/db.helpers.ts';
import healthRoutes from '../../src/controllers/health.ts';

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
        const badApp = Fastify({ logger: false });
        badApp.register(fastifyPostgres, {
            connectionString: 'postgres://test:test@localhost:5999/doesnotexist',
        });
        badApp.register(healthRoutes);
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
