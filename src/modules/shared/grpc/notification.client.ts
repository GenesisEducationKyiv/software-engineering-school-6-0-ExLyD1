import * as grpc from '@grpc/grpc-js';
import {
    NotificationQueryServiceClient,
    type GetNotificationStatusResponse,
} from './generated/notification/v1/notification.ts';

export type NotificationQueryClient = {
    getNotificationStatus: (sagaId: string) => Promise<GetNotificationStatusResponse>;
    close: () => void;
};

// Thin promise wrapper over the generated grpc-js client. The client is lazy —
// it does not open a connection until the first call — so creating it at startup
// is safe even if the notification-service is not up yet.
export const createNotificationClient = (address: string): NotificationQueryClient => {
    const client = new NotificationQueryServiceClient(address, grpc.credentials.createInsecure());

    return {
        getNotificationStatus: (sagaId) =>
            new Promise((resolve, reject) => {
                client.getNotificationStatus({ sagaId }, (err, response) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    resolve(response);
                });
            }),
        close: () => client.close(),
    };
};
