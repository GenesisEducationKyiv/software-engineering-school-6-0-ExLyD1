import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import * as grpc from '@grpc/grpc-js';
import type {} from '../notification.plugin.ts';
import type { NotificationQueryClient } from '../notification.client.ts';
import routes from '../notification-status.controller.ts';
import { NotificationStatus } from '../generated/notification/v1/notification.ts';

function buildApp(getNotificationStatus: ReturnType<typeof vi.fn>) {
    const app = Fastify({ logger: false });
    app.decorate('notificationQuery', {
        getNotificationStatus,
        close: vi.fn(),
    } as unknown as NotificationQueryClient);
    app.register(routes);
    return app;
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('GET /api/notifications/:sagaId', () => {
    it('200 and serializes the proto enum to its string name', async () => {
        const getStatus = vi.fn().mockResolvedValue({
            status: NotificationStatus.NOTIFICATION_STATUS_SENT,
            recipient: 'user@example.com',
        });
        const app = buildApp(getStatus);

        const res = await app.inject({ method: 'GET', url: '/api/notifications/saga-1' });

        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({
            status: 'NOTIFICATION_STATUS_SENT',
            recipient: 'user@example.com',
        });
        expect(getStatus).toHaveBeenCalledWith('saga-1');
    });

    it('maps gRPC NOT_FOUND → 404', async () => {
        const app = buildApp(vi.fn().mockRejectedValue({ code: grpc.status.NOT_FOUND }));
        const res = await app.inject({ method: 'GET', url: '/api/notifications/ghost' });
        expect(res.statusCode).toBe(404);
    });

    it('maps gRPC INVALID_ARGUMENT → 400', async () => {
        const app = buildApp(vi.fn().mockRejectedValue({ code: grpc.status.INVALID_ARGUMENT }));
        const res = await app.inject({ method: 'GET', url: '/api/notifications/%20' });
        expect(res.statusCode).toBe(400);
    });

    it('maps other gRPC errors (UNAVAILABLE) → 502', async () => {
        const app = buildApp(vi.fn().mockRejectedValue({ code: grpc.status.UNAVAILABLE }));
        const res = await app.inject({ method: 'GET', url: '/api/notifications/saga-1' });
        expect(res.statusCode).toBe(502);
    });
});
