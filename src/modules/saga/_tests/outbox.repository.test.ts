import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { QueryRunner } from '../../shared/db/db.types.ts';
import { enqueue, fetchUnpublished, markPublished, type OutboxRow } from '../outbox.repository.ts';

function makeDb(rows: unknown[] = [], rowCount: number | null = 1): QueryRunner {
    return { query: vi.fn().mockResolvedValue({ rows, rowCount }) };
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('enqueue', () => {
    it('inserts the queue name and JSON-serialized payload', async () => {
        const db = makeDb();
        const payload = { type: 'confirmation', sagaId: 's1' };
        await enqueue(db, 'email_commands', payload);

        const [sql, params] = vi.mocked(db.query).mock.calls[0];
        expect(sql).toContain('INSERT INTO outbox');
        expect(params).toEqual(['email_commands', JSON.stringify(payload)]);
    });
});

describe('fetchUnpublished', () => {
    it('returns only unpublished rows ordered by id, limited', async () => {
        const rows: OutboxRow[] = [
            { id: 1, queue: 'email_commands', payload: { a: 1 } },
            { id: 2, queue: 'email_commands', payload: { a: 2 } },
        ];
        const db = makeDb(rows, 2);
        const result = await fetchUnpublished(db, 20);

        expect(result).toEqual(rows);
        const [sql, params] = vi.mocked(db.query).mock.calls[0];
        expect(sql).toContain('published = false');
        expect(sql).toContain('ORDER BY id');
        expect(params).toEqual([20]);
    });

    it('returns empty array when nothing is pending', async () => {
        const db = makeDb([], 0);
        const result = await fetchUnpublished(db, 20);
        expect(result).toEqual([]);
    });
});

describe('markPublished', () => {
    it('marks the given row published', async () => {
        const db = makeDb();
        await markPublished(db, 7);

        const [sql, params] = vi.mocked(db.query).mock.calls[0];
        expect(sql).toContain('UPDATE outbox SET published = true');
        expect(params).toEqual([7]);
    });
});
