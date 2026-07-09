import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Db } from '../db.ts';
import {
    getNotificationStatus,
    InvalidSagaIdError,
    NotificationNotFoundError,
} from '../notification-query.ts';

function makeDb(rows: unknown[] = []): Db {
    return { query: vi.fn().mockResolvedValue({ rows, rowCount: rows.length }) } as unknown as Db;
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('getNotificationStatus', () => {
    it('returns status + recipient when a record exists', async () => {
        const db = makeDb([{ status: 'sent', recipient: 'user@example.com' }]);

        const result = await getNotificationStatus(db, 'saga-1');

        expect(result).toEqual({ status: 'sent', recipient: 'user@example.com' });
        expect(vi.mocked(db.query).mock.calls[0][1]).toEqual(['saga-1']);
    });

    it('throws NotificationNotFoundError when there is no record', async () => {
        const db = makeDb([]);
        await expect(getNotificationStatus(db, 'ghost')).rejects.toBeInstanceOf(
            NotificationNotFoundError,
        );
    });

    it('throws InvalidSagaIdError for an empty saga id (does not hit the DB)', async () => {
        const db = makeDb([]);
        await expect(getNotificationStatus(db, '  ')).rejects.toBeInstanceOf(InvalidSagaIdError);
        expect(db.query).not.toHaveBeenCalled();
    });
});
