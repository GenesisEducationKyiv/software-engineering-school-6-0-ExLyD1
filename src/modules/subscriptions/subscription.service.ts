import type { DbPool } from '../shared/db/db.types.ts';
import type { SubscriptionRow } from './subscription.types.ts';
import {
    upsertUser,
    upsertRepository,
    insertSubscription,
    confirmSubscription as repoConfirmSubscription,
    deleteSubscription as repoDeleteSubscription,
    getSubscriptionsByEmail as repoGetByEmail,
} from './subscription.repository.ts';

export const subscribe = async (
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

        await client.query('COMMIT');
        return confirmToken;
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
};

export const confirmSubscription = async (db: DbPool, token: string): Promise<boolean> =>
    repoConfirmSubscription(db, token);

export const deleteSubscription = async (db: DbPool, token: string): Promise<boolean> =>
    repoDeleteSubscription(db, token);

export const getSubscriptionsByEmail = async (
    db: DbPool,
    email: string,
): Promise<SubscriptionRow[]> => repoGetByEmail(db, email);
