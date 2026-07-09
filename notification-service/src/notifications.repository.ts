import type { Db } from './db.ts';

export const findSentBySaga = async (db: Db, sagaId: string): Promise<boolean> => {
    const { rowCount } = await db.query(
        `SELECT 1 FROM notifications WHERE saga_id = $1 AND status = 'sent'`,
        [sagaId],
    );
    return (rowCount ?? 0) > 0;
};

export type NotificationRow = {
    status: string;
    recipient: string;
};

export const findBySaga = async (db: Db, sagaId: string): Promise<NotificationRow | null> => {
    const { rows } = await db.query<NotificationRow>(
        `SELECT status, recipient FROM notifications WHERE saga_id = $1`,
        [sagaId],
    );
    return rows[0] ?? null;
};

export const recordSent = async (
    db: Db,
    sagaId: string,
    type: string,
    recipient: string,
): Promise<void> => {
    await db.query(
        `INSERT INTO notifications (saga_id, type, recipient, status)
         VALUES ($1, $2, $3, 'sent')
         ON CONFLICT (saga_id) DO NOTHING`,
        [sagaId, type, recipient],
    );
};
