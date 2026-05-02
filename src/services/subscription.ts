import type { FastifyInstance } from 'fastify';
import type { Repository, Subscription, SubscriptionRow, User } from '../types/index.ts';

export class AlreadySubscribedError extends Error {
    constructor() {
        super('Email already subscribed to this repository');
    }
}

export const subscribe = async (
    fastify: FastifyInstance,
    email: string,
    repo: string,
    lastSeenTag: string,
    onBeforeCommit: (confirmToken: string) => Promise<void>,
): Promise<string> => {
    const client = await fastify.pg.connect();
    try {
        await client.query('BEGIN');

        await client.query(`INSERT INTO users (email) VALUES ($1) ON CONFLICT (email) DO NOTHING`, [
            email,
        ]);

        const userResult = await client.query<Pick<User, 'id'>>(
            `SELECT id FROM users WHERE email = $1`,
            [email],
        );
        const userId = userResult.rows[0].id;

        await client.query(
            `INSERT INTO repositories (owner_repo, last_seen_tag) VALUES ($1, $2) ON CONFLICT (owner_repo) DO NOTHING`,
            [repo, lastSeenTag],
        );

        const repoResult = await client.query<Pick<Repository, 'id'>>(
            `SELECT id FROM repositories WHERE owner_repo = $1`,
            [repo],
        );
        const repoId = repoResult.rows[0].id;

        const confirmToken = crypto.randomUUID();
        const unsubscribeToken = crypto.randomUUID();

        try {
            await client.query(
                `INSERT INTO subscriptions (user_id, repository_id, confirm_token, unsubscribe_token)
                 VALUES ($1, $2, $3, $4)`,
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

        await onBeforeCommit(confirmToken);
        await client.query('COMMIT');
        return confirmToken;
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
};

export const confirmSubscription = async (
    fastify: FastifyInstance,
    token: string,
): Promise<boolean> => {
    const result = await fastify.pg.query<Subscription>(
        `UPDATE subscriptions SET confirmed = true WHERE confirm_token = $1 RETURNING *`,
        [token],
    );
    return (result.rowCount ?? 0) > 0;
};

export const deleteSubscription = async (
    fastify: FastifyInstance,
    token: string,
): Promise<boolean> => {
    const result = await fastify.pg.query<Subscription>(
        `DELETE FROM subscriptions WHERE unsubscribe_token = $1 RETURNING *`,
        [token],
    );
    return (result.rowCount ?? 0) > 0;
};

export const getSubscriptionsByEmail = async (
    fastify: FastifyInstance,
    email: string,
): Promise<SubscriptionRow[]> => {
    const result = await fastify.pg.query<SubscriptionRow>(
        `SELECT u.email, r.owner_repo AS repo, s.confirmed, r.last_seen_tag
         FROM subscriptions s
         JOIN users u ON u.id = s.user_id
         JOIN repositories r ON r.id = s.repository_id
         WHERE u.email = $1`,
        [email],
    );
    return result.rows;
};
