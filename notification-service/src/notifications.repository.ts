import type { Db } from './db.ts';

export const findSentBySaga = async (db: Db, sagaId: string): Promise<boolean> => {
    const { rowCount } = await db.query(
        `SELECT 1 FROM notifications WHERE saga_id = $1 AND status = 'sent'`,
        [sagaId],
    );
    return (rowCount ?? 0) > 0;
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
