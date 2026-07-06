import type { DbPool, QueryRunner } from '../shared/db/db.types.ts';
import { createSaga, getSaga, setStatus, incrementAttempts } from './saga.repository.ts';
import { enqueue } from './outbox.repository.ts';
import {
    EMAIL_QUEUE,
    type ConfirmationEmailCommand,
    type SagaReply,
} from '../shared/messaging/email-commands.ts';

// Total confirmation attempts before the saga gives up and compensates.
const MAX_ATTEMPTS = 3;

// Ports injected by the caller (composition root / subscriptions controller), so
// the saga never imports the subscriptions module — the dependency graph stays
// acyclic: subscriptions -> saga, never back.
export type CreatePendingSubscriptionFn = (
    client: QueryRunner,
    email: string,
    repo: string,
    lastSeenTag: string,
) => Promise<string>; // returns the confirm token
export type CompensateFn = (client: QueryRunner, confirmToken: string) => Promise<unknown>;

/**
 * Saga step T1 + start. Creates the subscription (via the injected port), the
 * saga record, and the outgoing confirmation command in ONE local transaction
 * (transactional outbox) — so there is no dual-write: either all commit, or none.
 */
export const startRegisterSubscription = async (
    db: DbPool,
    email: string,
    repo: string,
    lastSeenTag: string,
    createPendingSubscription: CreatePendingSubscriptionFn,
): Promise<string> => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const confirmToken = await createPendingSubscription(client, email, repo, lastSeenTag);

        const sagaId = crypto.randomUUID();
        await createSaga(client, sagaId, email, confirmToken);

        const command: ConfirmationEmailCommand = {
            type: 'confirmation',
            sagaId,
            email,
            token: confirmToken,
        };
        await enqueue(client, EMAIL_QUEUE, command);

        await client.query('COMMIT');
        return sagaId;
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
};

/**
 * Reacts to the notification-service's reply.
 * - sent   → saga completed.
 * - failed → retry (re-enqueue the command) up to MAX_ATTEMPTS, then compensate
 *            by deleting the subscription (C1) and marking the saga failed.
 */
export const handleReply = async (
    db: DbPool,
    reply: SagaReply,
    compensate: CompensateFn,
): Promise<void> => {
    const saga = await getSaga(db, reply.sagaId);
    if (!saga || saga.status !== 'awaiting_confirmation') {
        return; // unknown saga or already in a terminal state — ignore (idempotent)
    }

    if (reply.status === 'sent') {
        await setStatus(db, reply.sagaId, 'completed');
        return;
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');
        await incrementAttempts(client, reply.sagaId);

        if (saga.attempts + 1 < MAX_ATTEMPTS) {
            const retry: ConfirmationEmailCommand = {
                type: 'confirmation',
                sagaId: saga.id,
                email: saga.email,
                token: saga.confirm_token,
            };
            await enqueue(client, EMAIL_QUEUE, retry);
        } else {
            await compensate(client, saga.confirm_token); // C1: compensate
            await setStatus(client, reply.sagaId, 'failed');
        }

        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
};
