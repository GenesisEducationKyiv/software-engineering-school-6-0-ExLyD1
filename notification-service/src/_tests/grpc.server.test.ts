import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as grpc from '@grpc/grpc-js';
import type { ServerUnaryCall, sendUnaryData } from '@grpc/grpc-js';
import type { Logger } from 'pino';
import type { Db } from '../db.ts';
import {
    NotificationStatus,
    type GetNotificationStatusRequest,
    type GetNotificationStatusResponse,
} from '../generated/notification/v1/notification.ts';

vi.mock('../notification-query.ts', async (importActual) => {
    const actual = await importActual<typeof import('../notification-query.ts')>();
    return { ...actual, getNotificationStatus: vi.fn() };
});

import {
    getNotificationStatus,
    InvalidSagaIdError,
    NotificationNotFoundError,
} from '../notification-query.ts';
import { buildNotificationQueryImpl } from '../grpc.server.ts';

const mockGet = vi.mocked(getNotificationStatus);
const log = { error: vi.fn() } as unknown as Logger;

// Invokes the unary handler and resolves with whatever it passes to the callback.
function invoke(sagaId: string): Promise<{ err: grpc.ServerErrorResponse | null; res?: GetNotificationStatusResponse }> {
    const impl = buildNotificationQueryImpl({} as Db, log);
    const call = { request: { sagaId } } as ServerUnaryCall<
        GetNotificationStatusRequest,
        GetNotificationStatusResponse
    >;
    return new Promise((resolve) => {
        const callback: sendUnaryData<GetNotificationStatusResponse> = (err, res) =>
            resolve({ err: err as grpc.ServerErrorResponse | null, res: res ?? undefined });
        impl.getNotificationStatus(call, callback);
    });
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('gRPC GetNotificationStatus', () => {
    it('returns OK with the proto status enum and recipient', async () => {
        mockGet.mockResolvedValue({ status: 'sent', recipient: 'user@example.com' });

        const { err, res } = await invoke('saga-1');

        expect(err).toBeNull();
        expect(res).toEqual({
            status: NotificationStatus.NOTIFICATION_STATUS_SENT,
            recipient: 'user@example.com',
        });
    });

    it('maps domain statuses to the proto enum (pending/failed)', async () => {
        mockGet.mockResolvedValueOnce({ status: 'pending', recipient: 'a@b.com' });
        expect((await invoke('s')).res?.status).toBe(NotificationStatus.NOTIFICATION_STATUS_PENDING);

        mockGet.mockResolvedValueOnce({ status: 'failed', recipient: 'a@b.com' });
        expect((await invoke('s')).res?.status).toBe(NotificationStatus.NOTIFICATION_STATUS_FAILED);
    });

    it('returns INVALID_ARGUMENT for an invalid saga id', async () => {
        mockGet.mockRejectedValue(new InvalidSagaIdError('saga_id is required'));
        const { err } = await invoke('');
        expect(err?.code).toBe(grpc.status.INVALID_ARGUMENT);
    });

    it('returns NOT_FOUND when there is no record', async () => {
        mockGet.mockRejectedValue(new NotificationNotFoundError('nope'));
        const { err } = await invoke('ghost');
        expect(err?.code).toBe(grpc.status.NOT_FOUND);
    });

    it('returns INTERNAL on unexpected errors', async () => {
        mockGet.mockRejectedValue(new Error('db down'));
        const { err } = await invoke('saga-1');
        expect(err?.code).toBe(grpc.status.INTERNAL);
        expect(log.error).toHaveBeenCalledOnce();
    });
});
