import * as grpc from '@grpc/grpc-js';
import type { Logger } from 'pino';
import type { Db } from './db.ts';
import {
    NotificationQueryServiceService,
    type NotificationQueryServiceServer,
    NotificationStatus,
    type GetNotificationStatusResponse,
} from './generated/notification/v1/notification.ts';
import {
    getNotificationStatus,
    InvalidSagaIdError,
    NotificationNotFoundError,
    type NotificationStatusValue,
} from './notification-query.ts';

const toProtoStatus = (status: NotificationStatusValue): NotificationStatus => {
    switch (status) {
        case 'pending':
            return NotificationStatus.NOTIFICATION_STATUS_PENDING;
        case 'sent':
            return NotificationStatus.NOTIFICATION_STATUS_SENT;
        case 'failed':
            return NotificationStatus.NOTIFICATION_STATUS_FAILED;
        default:
            return NotificationStatus.NOTIFICATION_STATUS_UNSPECIFIED;
    }
};

const buildImpl = (db: Db, log: Logger): NotificationQueryServiceServer => ({
    getNotificationStatus: (call, callback) => {
        void (async () => {
            try {
                const result = await getNotificationStatus(db, call.request.sagaId);
                const response: GetNotificationStatusResponse = {
                    status: toProtoStatus(result.status),
                    recipient: result.recipient,
                };
                callback(null, response);
            } catch (err) {
                // Domain errors → proper gRPC status codes (not HTTP, not thrown).
                if (err instanceof InvalidSagaIdError) {
                    callback({ code: grpc.status.INVALID_ARGUMENT, message: err.message });
                    return;
                }
                if (err instanceof NotificationNotFoundError) {
                    callback({ code: grpc.status.NOT_FOUND, message: err.message });
                    return;
                }
                log.error({ err }, 'gRPC GetNotificationStatus failed');
                callback({ code: grpc.status.INTERNAL, message: 'internal error' });
            }
        })();
    },
});

export const buildGrpcServer = (db: Db, log: Logger): grpc.Server => {
    const server = new grpc.Server();
    server.addService(NotificationQueryServiceService, buildImpl(db, log));
    return server;
};

export const startGrpcServer = (server: grpc.Server, port: number, log: Logger): Promise<void> =>
    new Promise((resolve, reject) => {
        server.bindAsync(`0.0.0.0:${port}`, grpc.ServerCredentials.createInsecure(), (err) => {
            if (err) {
                reject(err);
                return;
            }
            log.info(`gRPC server listening on :${port}`);
            resolve();
        });
    });
