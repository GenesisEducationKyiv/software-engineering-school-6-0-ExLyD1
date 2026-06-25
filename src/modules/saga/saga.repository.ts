import type { QueryRunner } from '../shared/db/db.types.ts';

export type SagaRow = {
    id: string;
    type: string;
    status: string;
    email: string;
    confirm_token: string;
    attempts: number;
};

export const createSaga = async (
    db: QueryRunner,
    id: string,
    email: string,
    confirmToken: string,
): Promise<void> => {
    await db.query(
        `INSERT INTO saga (id, type, status, email, confirm_token)
         VALUES ($1, 'register_subscription', 'awaiting_confirmation', $2, $3)`,
        [id, email, confirmToken],
    );
};

export const getSaga = async (db: QueryRunner, id: string): Promise<SagaRow | null> => {
    const { rows } = await db.query<SagaRow>(
        `SELECT id, type, status, email, confirm_token, attempts FROM saga WHERE id = $1`,
        [id],
    );
    return rows[0] ?? null;
};

export const setStatus = async (db: QueryRunner, id: string, status: string): Promise<void> => {
    await db.query(`UPDATE saga SET status = $1, updated_at = now() WHERE id = $2`, [status, id]);
};

export const incrementAttempts = async (db: QueryRunner, id: string): Promise<void> => {
    await db.query(`UPDATE saga SET attempts = attempts + 1, updated_at = now() WHERE id = $1`, [
        id,
    ]);
};
