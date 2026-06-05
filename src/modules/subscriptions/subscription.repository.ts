import type { QueryRunner, User, Repository, Subscription } from '../shared/db/db.types.ts';
import type { SubscriptionRow } from './subscription.types.ts';
import { AlreadySubscribedError } from './subscription.errors.ts';

export const upsertUser = async (db: QueryRunner, email: string): Promise<number> => {
    await db.query(`INSERT INTO users (email) VALUES ($1) ON CONFLICT (email) DO NOTHING`, [email]);
    const result = await db.query<Pick<User, 'id'>>(`SELECT id FROM users WHERE email = $1`, [
        email,
    ]);
    return result.rows[0].id;
};

export const upsertRepository = async (
    db: QueryRunner,
    ownerRepo: string,
    lastSeenTag: string,
): Promise<number> => {
    await db.query(
        `INSERT INTO repositories (owner_repo, last_seen_tag) VALUES ($1, $2) ON CONFLICT (owner_repo) DO NOTHING`,
        [ownerRepo, lastSeenTag],
    );
    const result = await db.query<Pick<Repository, 'id'>>(
        `SELECT id FROM repositories WHERE owner_repo = $1`,
        [ownerRepo],
    );
    return result.rows[0].id;
};

export const insertSubscription = async (
    db: QueryRunner,
    userId: number,
    repoId: number,
    confirmToken: string,
    unsubscribeToken: string,
): Promise<void> => {
    try {
        await db.query(
            `INSERT INTO subscriptions (user_id, repository_id, confirm_token, unsubscribe_token) VALUES ($1, $2, $3, $4)`,
            [userId, repoId, confirmToken, unsubscribeToken],
        );
    } catch (err: unknown) {
        if (
            err &&
            typeof err === 'object' &&
            'code' in err &&
            (err as { code: string }).code === '23505'
        ) {
            throw new AlreadySubscribedError();
        }
        throw err;
    }
};

export const confirmSubscription = async (db: QueryRunner, token: string): Promise<boolean> => {
    const result = await db.query<Subscription>(
        `UPDATE subscriptions SET confirmed = true WHERE confirm_token = $1 RETURNING *`,
        [token],
    );
    return (result.rowCount ?? 0) > 0;
};

export const deleteSubscription = async (db: QueryRunner, token: string): Promise<boolean> => {
    const result = await db.query<Subscription>(
        `DELETE FROM subscriptions WHERE unsubscribe_token = $1 RETURNING *`,
        [token],
    );
    return (result.rowCount ?? 0) > 0;
};

export const getSubscriptionsByEmail = async (
    db: QueryRunner,
    email: string,
): Promise<SubscriptionRow[]> => {
    const result = await db.query<SubscriptionRow>(
        `SELECT u.email, r.owner_repo AS repo, s.confirmed, r.last_seen_tag
         FROM subscriptions s
         JOIN users u ON u.id = s.user_id
         JOIN repositories r ON r.id = s.repository_id
         WHERE u.email = $1`,
        [email],
    );
    return result.rows;
};
