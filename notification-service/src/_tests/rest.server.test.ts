import { describe, it, expect, vi, beforeEach } from 'vitest';
import pino from 'pino';
import type { Db } from '../db.ts';

vi.mock('../notification-query.ts', async (importActual) => {
    const actual = await importActual<typeof import('../notification-query.ts')>();
    return { ...actual, getNotificationStatus: vi.fn() };
});

import {
    getNotificationStatus,
    InvalidSagaIdError,
    NotificationNotFoundError,
} from '../notification-query.ts';
import { buildRestServer } from '../rest.server.ts';

const mockGet = vi.mocked(getNotificationStatus);
const silentLog = pino({ level: 'silent' });

function buildApp() {
    return buildRestServer({} as Db, silentLog);
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('REST GET /notifications/:sagaId', () => {
    it('200 with the status payload', async () => {
        mockGet.mockResolvedValue({ status: 'sent', recipient: 'user@example.com' });
        const app = buildApp();

        const res = await app.inject({ method: 'GET', url: '/notifications/saga-1' });

        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ status: 'sent', recipient: 'user@example.com' });
        await app.close();
    });

    it('400 for an invalid saga id', async () => {
        mockGet.mockRejectedValue(new InvalidSagaIdError('saga_id is required'));
        const app = buildApp();
        const res = await app.inject({ method: 'GET', url: '/notifications/%20' });
        expect(res.statusCode).toBe(400);
        await app.close();
    });

    it('404 when there is no record', async () => {
        mockGet.mockRejectedValue(new NotificationNotFoundError('nope'));
        const app = buildApp();
        const res = await app.inject({ method: 'GET', url: '/notifications/ghost' });
        expect(res.statusCode).toBe(404);
        await app.close();
    });

    it('500 on unexpected errors', async () => {
        mockGet.mockRejectedValue(new Error('db down'));
        const app = buildApp();
        const res = await app.inject({ method: 'GET', url: '/notifications/saga-1' });
        expect(res.statusCode).toBe(500);
        await app.close();
    });
});
