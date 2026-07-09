import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Db } from '../db.ts';
import { findBySaga, findSentBySaga, recordSent } from '../notifications.repository.ts';

function makeDb(rows: unknown[] = [], rowCount: number | null = rows.length): Db {
    return { query: vi.fn().mockResolvedValue({ rows, rowCount }) } as unknown as Db;
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('findBySaga', () => {
    it('returns the row when found and passes saga_id as param', async () => {
        const db = makeDb([{ status: 'sent', recipient: 'user@example.com' }], 1);
        const result = await findBySaga(db, 'saga-1');

        expect(result).toEqual({ status: 'sent', recipient: 'user@example.com' });
        const [sql, params] = vi.mocked(db.query).mock.calls[0];
        expect(sql).toContain('FROM notifications WHERE saga_id');
        expect(params).toEqual(['saga-1']);
    });

    it('returns null when not found', async () => {
        const db = makeDb([], 0);
        expect(await findBySaga(db, 'ghost')).toBeNull();
    });
});

describe('findSentBySaga', () => {
    it('true when a sent row exists, false otherwise', async () => {
        expect(await findSentBySaga(makeDb([], 1), 's')).toBe(true);
        expect(await findSentBySaga(makeDb([], 0), 's')).toBe(false);
        expect(await findSentBySaga(makeDb([], null), 's')).toBe(false);
    });
});

describe('recordSent', () => {
    it('inserts with ON CONFLICT DO NOTHING (idempotent)', async () => {
        const db = makeDb();
        await recordSent(db, 's1', 'confirmation', 'user@example.com');

        const [sql, params] = vi.mocked(db.query).mock.calls[0];
        expect(sql).toContain('INSERT INTO notifications');
        expect(sql).toContain('ON CONFLICT (saga_id) DO NOTHING');
        expect(params).toEqual(['s1', 'confirmation', 'user@example.com']);
    });
});
