import type { QueryRunner } from '../shared/db/db.types.ts';
import type { WatchedRepo } from './scanner.types.ts';

export const getWatchedRepos = async (db: QueryRunner): Promise<WatchedRepo[]> => {
    const { rows } = await db.query<WatchedRepo>(`
        SELECT DISTINCT r.id, r.owner_repo, r.last_seen_tag
        FROM repositories r
        JOIN subscriptions s ON s.repository_id = r.id
        WHERE s.confirmed = true
    `);
    return rows;
};

export const updateLastSeenTag = async (
    db: QueryRunner,
    repoId: number,
    tag: string,
): Promise<void> => {
    await db.query(`UPDATE repositories SET last_seen_tag = $1 WHERE id = $2`, [tag, repoId]);
};
