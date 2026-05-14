import type { DbPool, SubscriptionRow } from '../types/index.ts';
import {
    upsertUser,
    upsertRepository,
    insertSubscription,
    confirmSubscription as repoConfirmSubscription,
    deleteSubscription as repoDeleteSubscription,
    getSubscriptionsByEmail as repoGetByEmail,
} from '../repositories/subscription.repository.ts';

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
        const { confirmToken } = await insertSubscription(client, userId, repoId);

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
