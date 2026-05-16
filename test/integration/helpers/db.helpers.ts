import type { PostgresDb } from '@fastify/postgres';
import type { SubscriptionRow } from '../../../src/types/index.ts';

export async function truncateAllTables(db: PostgresDb): Promise<void> {
    await db.query(
        `TRUNCATE users, repositories, subscriptions RESTART IDENTITY CASCADE`,
    );
}

type SeedResult = {
    confirmToken: string;
    unsubscribeToken: string;
    userId: number;
    repoId: number;
};

export async function seedSubscription(
    db: PostgresDb,
    opts: {
        email: string;
        repo: string;
        confirmed?: boolean;
        lastSeenTag?: string;
    },
): Promise<SeedResult> {
    const { email, repo, confirmed = false, lastSeenTag = 'v1.0.0' } = opts;

    const userResult = await db.query<{ id: number }>(
        `INSERT INTO users (email) VALUES ($1) ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id`,
        [email],
    );
    const userId = userResult.rows[0].id;

    const repoResult = await db.query<{ id: number }>(
        `INSERT INTO repositories (owner_repo, last_seen_tag) VALUES ($1, $2) ON CONFLICT (owner_repo) DO UPDATE SET owner_repo = EXCLUDED.owner_repo RETURNING id`,
        [repo, lastSeenTag],
    );
    const repoId = repoResult.rows[0].id;

    const confirmToken = crypto.randomUUID();
    const unsubscribeToken = crypto.randomUUID();

    await db.query(
        `INSERT INTO subscriptions (user_id, repository_id, confirm_token, unsubscribe_token, confirmed)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, repoId, confirmToken, unsubscribeToken, confirmed],
    );

    return { confirmToken, unsubscribeToken, userId, repoId };
}

export async function getSubscriptionRow(
    db: PostgresDb,
    email: string,
    repo: string,
): Promise<SubscriptionRow | null> {
    const result = await db.query<SubscriptionRow>(
        `SELECT u.email, r.owner_repo AS repo, s.confirmed, r.last_seen_tag
         FROM subscriptions s
         JOIN users u ON u.id = s.user_id
         JOIN repositories r ON r.id = s.repository_id
         WHERE u.email = $1 AND r.owner_repo = $2`,
        [email, repo],
    );
    return result.rows[0] ?? null;
}
