import fastifyPlugin from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { collectDefaultMetrics, Counter, Histogram, Registry } from 'prom-client';

const metricsPlugin = async (fastify: FastifyInstance) => {
    const registry = new Registry();
    collectDefaultMetrics({ register: registry });

    const requestsTotal = new Counter({
        name: 'http_requests_total',
        help: 'Total number of HTTP requests',
        labelNames: ['method', 'route', 'status_code', 'status_class'],
        registers: [registry],
    });

    const errorsTotal = new Counter({
        name: 'http_request_errors_total',
        help: 'Total number of HTTP requests that resulted in a 4xx or 5xx response',
        labelNames: ['method', 'route', 'status_code'],
        registers: [registry],
    });

    const durationSeconds = new Histogram({
        name: 'http_request_duration_seconds',
        help: 'HTTP request duration in seconds',
        labelNames: ['method', 'route', 'status_code'],
        registers: [registry],
    });

    fastify.addHook('onResponse', async (request, reply) => {
        const route = request.routeOptions?.url ?? 'unknown';
        if (route === '/metrics') {
            return;
        }

        const method = request.method;
        const statusCode = reply.statusCode;
        const statusClass = `${Math.floor(statusCode / 100)}xx`;

        requestsTotal.inc({ method, route, status_code: statusCode, status_class: statusClass });
        durationSeconds.observe(
            { method, route, status_code: statusCode },
            reply.elapsedTime / 1000,
        );

        if (statusCode >= 400) {
            errorsTotal.inc({ method, route, status_code: statusCode });
        }
    });

    fastify.get('/metrics', async (_request, reply) => {
        reply.header('Content-Type', registry.contentType);
        return registry.metrics();
    });
};

export default fastifyPlugin(metricsPlugin);
