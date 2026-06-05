import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import authPlugin from '../auth.plugin.ts';

const TEST_API_KEY = 'secret-key';

function buildApp() {
    const app = Fastify({ logger: false });
    app.register(authPlugin, {
        apiKey: TEST_API_KEY,
        databaseUrl: '',
        githubBaseUrl: '',
        rabbitmqUrl: '',
        scannerIntervalMs: 0,
        port: 3000,
        logLevel: 'info',
    });

    app.get('/api/protected', async (_req, reply) => reply.send({ ok: true }));
    app.post('/api/subscribe', async (_req, reply) => reply.send({ ok: true }));
    app.get('/api/subscriptions', async (_req, reply) => reply.send({ ok: true }));
    app.get('/api/confirm/:token', async (_req, reply) => reply.send({ ok: true }));
    app.get('/api/unsubscribe/:token', async (_req, reply) => reply.send({ ok: true }));
    app.get('/health', async (_req, reply) => reply.send({ ok: true }));
    app.get('/', async (_req, reply) => reply.send({ ok: true }));

    return app;
}

describe('auth plugin', () => {
    it('returns 401 when x-api-key header is missing on protected route', async () => {
        const app = buildApp();
        const res = await app.inject({ method: 'GET', url: '/api/protected' });
        expect(res.statusCode).toBe(401);
    });

    it('returns 401 when wrong x-api-key value is provided', async () => {
        const app = buildApp();
        const res = await app.inject({
            method: 'GET',
            url: '/api/protected',
            headers: { 'x-api-key': 'wrong-key' },
        });
        expect(res.statusCode).toBe(401);
    });

    it('returns 200 when correct x-api-key is provided', async () => {
        const app = buildApp();
        const res = await app.inject({
            method: 'GET',
            url: '/api/protected',
            headers: { 'x-api-key': TEST_API_KEY },
        });
        expect(res.statusCode).toBe(200);
    });

    it('allows /api/subscribe without api key', async () => {
        const app = buildApp();
        const res = await app.inject({ method: 'POST', url: '/api/subscribe' });
        expect(res.statusCode).toBe(200);
    });

    it('allows /api/subscriptions without api key', async () => {
        const app = buildApp();
        const res = await app.inject({ method: 'GET', url: '/api/subscriptions' });
        expect(res.statusCode).toBe(200);
    });

    it('allows /api/confirm/:token without api key', async () => {
        const app = buildApp();
        const res = await app.inject({ method: 'GET', url: '/api/confirm/any-token' });
        expect(res.statusCode).toBe(200);
    });

    it('allows /api/unsubscribe/:token without api key', async () => {
        const app = buildApp();
        const res = await app.inject({ method: 'GET', url: '/api/unsubscribe/any-token' });
        expect(res.statusCode).toBe(200);
    });

    it('allows /health without api key', async () => {
        const app = buildApp();
        const res = await app.inject({ method: 'GET', url: '/health' });
        expect(res.statusCode).toBe(200);
    });

    it('allows / without api key', async () => {
        const app = buildApp();
        const res = await app.inject({ method: 'GET', url: '/' });
        expect(res.statusCode).toBe(200);
    });
});
