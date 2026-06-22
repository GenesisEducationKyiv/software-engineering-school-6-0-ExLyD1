import type { Db } from './db.ts';
import { findBySaga } from './notifications.repository.ts';

export type NotificationStatusValue = 'pending' | 'sent' | 'failed';

export type NotificationStatusResult = {
    status: NotificationStatusValue;
    recipient: string;
};

// Domain-level errors — transport-agnostic. Each transport (gRPC / REST) maps
// these onto its own status codes, but the business logic stays identical so the
// REST vs gRPC benchmark compares transports, not different implementations.
export class InvalidSagaIdError extends Error {}
export class NotificationNotFoundError extends Error {}

export const getNotificationStatus = async (
    db: Db,
    sagaId: string,
): Promise<NotificationStatusResult> => {
    if (!sagaId || sagaId.trim() === '') {
        throw new InvalidSagaIdError('saga_id is required');
    }

    const row = await findBySaga(db, sagaId);
    if (!row) {
        throw new NotificationNotFoundError(`no notification for saga ${sagaId}`);
    }

    return { status: row.status as NotificationStatusValue, recipient: row.recipient };
};
