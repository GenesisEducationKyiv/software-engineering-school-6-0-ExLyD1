import { describe, it, expect, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import metricsPlugin from '../metrics.plugin.ts';

let app: FastifyInstance;

afterEach(async () => {
    await app?.close();
});

async function buildApp() {
    app = Fastify({ logger: false });
    await app.register(metricsPlugin);
    app.get('/ping', async (_req, reply) => reply.send({ ok: true }));
    app.get('/things/:id', async (_req, reply) => reply.send({ ok: true }));
    app.get('/boom', async (_req, reply) => reply.status(500).send({ error: 'x' }));
    await app.ready();
    return app;
}

async function metricsBody(a: FastifyInstance) {
    const res = await a.inject({ method: 'GET', url: '/metrics' });
    return res.body;
}

describe('metrics plugin', () => {
    it('exposes /metrics in Prometheus text format', async () => {
        const a = await buildApp();
        const res = await a.inject({ method: 'GET', url: '/metrics' });

        expect(res.statusCode).toBe(200);
        expect(res.headers['content-type']).toContain('text/plain');
        expect(res.body).toContain('http_requests_total');
    });

    it('counts a successful request with method/route/status labels', async () => {
        const a = await buildApp();
        await a.inject({ method: 'GET', url: '/ping' });

        expect(await metricsBody(a)).toMatch(
            /http_requests_total\{[^}]*method="GET"[^}]*route="\/ping"[^}]*status_code="200"[^}]*status_class="2xx"[^}]*\} 1/,
        );
    });

    it('uses the route template, not the raw path, to bound cardinality', async () => {
        const a = await buildApp();
        await a.inject({ method: 'GET', url: '/things/aaa' });
        await a.inject({ method: 'GET', url: '/things/bbb' });

        const body = await metricsBody(a);
        expect(body).toMatch(/route="\/things\/:id"[^}]*\} 2/);
        expect(body).not.toContain('/things/aaa');
        expect(body).not.toContain('/things/bbb');
    });

    it('increments the error counter for >= 400 responses', async () => {
        const a = await buildApp();
        await a.inject({ method: 'GET', url: '/boom' });

        expect(await metricsBody(a)).toMatch(
            /http_request_errors_total\{[^}]*route="\/boom"[^}]*status_code="500"[^}]*\} 1/,
        );
    });

    it('does not measure the /metrics endpoint itself', async () => {
        const a = await buildApp();
        await a.inject({ method: 'GET', url: '/metrics' });
        await a.inject({ method: 'GET', url: '/metrics' });

        expect(await metricsBody(a)).not.toContain('route="/metrics"');
    });
});
