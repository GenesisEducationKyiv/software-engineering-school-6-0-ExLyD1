import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Db } from '../db.ts';
import { findSentBySaga, recordSent } from '../notifications.repository.ts';

function makeDb(rowCount: number | null = 1): Db {
    return { query: vi.fn().mockResolvedValue({ rows: [], rowCount }) } as unknown as Db;
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('findSentBySaga', () => {
    it('returns true when a sent row exists for the saga', async () => {
        const db = makeDb(1);
        const result = await findSentBySaga(db, 's1');

        expect(result).toBe(true);
        const [sql, params] = vi.mocked(db.query).mock.calls[0];
        expect(sql).toContain("status = 'sent'");
        expect(params).toEqual(['s1']);
    });

    it('returns false when no sent row exists', async () => {
        const db = makeDb(0);
        const result = await findSentBySaga(db, 's1');
        expect(result).toBe(false);
    });

    it('returns false when rowCount is null', async () => {
        const db = makeDb(null);
        const result = await findSentBySaga(db, 's1');
        expect(result).toBe(false);
    });
});

describe('recordSent', () => {
    it('inserts the notification with ON CONFLICT DO NOTHING (idempotent)', async () => {
        const db = makeDb();
        await recordSent(db, 's1', 'confirmation', 'user@example.com');

        const [sql, params] = vi.mocked(db.query).mock.calls[0];
        expect(sql).toContain('INSERT INTO notifications');
        expect(sql).toContain('ON CONFLICT (saga_id) DO NOTHING');
        expect(params).toEqual(['s1', 'confirmation', 'user@example.com']);
    });
});
