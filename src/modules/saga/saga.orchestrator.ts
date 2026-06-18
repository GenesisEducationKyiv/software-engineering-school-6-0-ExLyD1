import type { DbPool } from '../shared/db/db.types.ts';
import {
    upsertUser,
    upsertRepository,
    insertSubscription,
    deleteByConfirmToken,
} from '../subscriptions/subscription.repository.ts';
import { createSaga, getSaga, setStatus, incrementAttempts } from './saga.repository.ts';
import { enqueue } from './outbox.repository.ts';
import {
    EMAIL_QUEUE,
    type ConfirmationEmailCommand,
    type SagaReply,
} from '../shared/messaging/email-commands.ts';

// Total confirmation attempts before the saga gives up and compensates.
const MAX_ATTEMPTS = 3;

/**
 * Saga step T1 + start. Creates the subscription, the saga record, and the
 * outgoing confirmation command in ONE local transaction (transactional outbox)
 * — so there is no dual-write: either all three commit, or none.
 */
export const startRegisterSubscription = async (
    db: DbPool,
    email: string,
    repo: string,
    lastSeenTag: string,
): Promise<string> => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const userId = await upsertUser(client, email);
        const repoId = await upsertRepository(client, repo, lastSeenTag);
        const confirmToken = crypto.randomUUID();
        const unsubscribeToken = crypto.randomUUID();
        await insertSubscription(client, userId, repoId, confirmToken, unsubscribeToken);

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
export const handleReply = async (db: DbPool, reply: SagaReply): Promise<void> => {
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
            await deleteByConfirmToken(client, saga.confirm_token); // C1: compensate
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
