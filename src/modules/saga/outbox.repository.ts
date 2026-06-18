import type { QueryRunner } from '../shared/db/db.types.ts';

export type OutboxRow = {
    id: number;
    queue: string;
    payload: unknown;
};

// Transactional outbox: written in the same local tx as the saga/subscription,
// so the command is never lost and never published without the DB commit.
export const enqueue = async (db: QueryRunner, queue: string, payload: unknown): Promise<void> => {
    await db.query(`INSERT INTO outbox (queue, payload) VALUES ($1, $2)`, [
        queue,
        JSON.stringify(payload),
    ]);
};

export const fetchUnpublished = async (db: QueryRunner, limit: number): Promise<OutboxRow[]> => {
    const { rows } = await db.query<OutboxRow>(
        `SELECT id, queue, payload FROM outbox WHERE published = false ORDER BY id LIMIT $1`,
        [limit],
    );
    return rows;
};

export const markPublished = async (db: QueryRunner, id: number): Promise<void> => {
    await db.query(`UPDATE outbox SET published = true WHERE id = $1`, [id]);
};
