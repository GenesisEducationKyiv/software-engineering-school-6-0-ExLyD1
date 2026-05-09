import type { QueryRunner } from '../types/index.ts';
import type { WatchedRepo, ScannerSubscriberRow } from '../types/index.ts';

export const getWatchedRepos = async (db: QueryRunner): Promise<WatchedRepo[]> => {
    const { rows } = await db.query<WatchedRepo>(`
        SELECT DISTINCT r.id, r.owner_repo, r.last_seen_tag
        FROM repositories r
        JOIN subscriptions s ON s.repository_id = r.id
        WHERE s.confirmed = true
    `);
    return rows;
};

export const getConfirmedSubscribers = async (
    db: QueryRunner,
    repoId: number,
): Promise<ScannerSubscriberRow[]> => {
    const { rows } = await db.query<ScannerSubscriberRow>(
        `
        SELECT u.email, s.unsubscribe_token
        FROM subscriptions s
        JOIN users u ON u.id = s.user_id
        WHERE s.repository_id = $1 AND s.confirmed = true
    `,
        [repoId],
    );
    return rows;
};

export const updateLastSeenTag = async (
    db: QueryRunner,
    repoId: number,
    tag: string,
): Promise<void> => {
    await db.query(`UPDATE repositories SET last_seen_tag = $1 WHERE id = $2`, [tag, repoId]);
};
