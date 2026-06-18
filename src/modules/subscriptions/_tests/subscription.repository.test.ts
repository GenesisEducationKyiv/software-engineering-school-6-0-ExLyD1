import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { QueryRunner } from '../../shared/db/db.types.ts';
import {
    upsertUser,
    upsertRepository,
    insertSubscription,
    confirmSubscription,
    deleteSubscription,
    deleteByConfirmToken,
    getSubscriptionsByEmail,
    getConfirmedSubscribers,
} from '../subscription.repository.ts';
import { AlreadySubscribedError } from '../subscription.errors.ts';

function makeDb(rows: unknown[] = [], rowCount: number | null = 1): QueryRunner {
    return { query: vi.fn().mockResolvedValue({ rows, rowCount }) };
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('upsertUser', () => {
    it('executes two queries and returns user id', async () => {
        const db: QueryRunner = {
            query: vi
                .fn()
                .mockResolvedValueOnce({ rows: [], rowCount: 0 })
                .mockResolvedValueOnce({ rows: [{ id: 42 }], rowCount: 1 }),
        };
        const id = await upsertUser(db, 'user@example.com');
        expect(id).toBe(42);
        expect(db.query).toHaveBeenCalledTimes(2);
        expect(vi.mocked(db.query).mock.calls[0][0]).toContain('INSERT INTO users');
        expect(vi.mocked(db.query).mock.calls[1][0]).toContain('SELECT id FROM users');
    });
});

describe('upsertRepository', () => {
    it('executes two queries and returns repository id', async () => {
        const db: QueryRunner = {
            query: vi
                .fn()
                .mockResolvedValueOnce({ rows: [], rowCount: 0 })
                .mockResolvedValueOnce({ rows: [{ id: 7 }], rowCount: 1 }),
        };
        const id = await upsertRepository(db, 'org/repo', 'v1.0.0');
        expect(id).toBe(7);
        expect(db.query).toHaveBeenCalledTimes(2);
        expect(vi.mocked(db.query).mock.calls[0][1]).toContain('v1.0.0');
    });
});

describe('insertSubscription', () => {
    it('resolves without error on success', async () => {
        const db = makeDb([], 1);
        await expect(insertSubscription(db, 1, 2, 'tok1', 'tok2')).resolves.toBeUndefined();
    });

    it('throws AlreadySubscribedError on unique constraint violation (PG code 23505)', async () => {
        const pgError = Object.assign(new Error('duplicate'), { code: '23505' });
        const db: QueryRunner = { query: vi.fn().mockRejectedValue(pgError) };
        await expect(insertSubscription(db, 1, 2, 'tok1', 'tok2')).rejects.toBeInstanceOf(
            AlreadySubscribedError,
        );
    });

    it('re-throws unknown errors as-is', async () => {
        const unknownError = new Error('connection lost');
        const db: QueryRunner = { query: vi.fn().mockRejectedValue(unknownError) };
        await expect(insertSubscription(db, 1, 2, 'tok1', 'tok2')).rejects.toBe(unknownError);
    });
});

describe('confirmSubscription', () => {
    it('returns true when rowCount is 1', async () => {
        const db = makeDb([{ id: 1 }], 1);
        const result = await confirmSubscription(db, 'some-token');
        expect(result).toBe(true);
    });

    it('returns false when rowCount is 0', async () => {
        const db = makeDb([], 0);
        const result = await confirmSubscription(db, 'missing-token');
        expect(result).toBe(false);
    });

    it('returns false when rowCount is null', async () => {
        const db = makeDb([], null);
        const result = await confirmSubscription(db, 'missing-token');
        expect(result).toBe(false);
    });
});

describe('deleteSubscription', () => {
    it('returns true when rowCount is 1', async () => {
        const db = makeDb([{ id: 1 }], 1);
        const result = await deleteSubscription(db, 'some-token');
        expect(result).toBe(true);
    });

    it('returns false when rowCount is 0', async () => {
        const db = makeDb([], 0);
        const result = await deleteSubscription(db, 'missing-token');
        expect(result).toBe(false);
    });
});

describe('deleteByConfirmToken', () => {
    it('deletes by confirm_token and returns true when a row was removed', async () => {
        const db = makeDb([], 1);
        const result = await deleteByConfirmToken(db, 'tok-1');

        expect(result).toBe(true);
        const [sql, params] = vi.mocked(db.query).mock.calls[0];
        expect(sql).toContain('DELETE FROM subscriptions WHERE confirm_token');
        expect(params).toEqual(['tok-1']);
    });

    it('returns false when no row matched', async () => {
        const db = makeDb([], 0);
        const result = await deleteByConfirmToken(db, 'missing');
        expect(result).toBe(false);
    });
});

describe('getSubscriptionsByEmail', () => {
    it('returns rows from query result', async () => {
        const rows = [
            { email: 'a@b.com', repo: 'org/repo', confirmed: true, last_seen_tag: 'v1.0.0' },
        ];
        const db = makeDb(rows, 1);
        const result = await getSubscriptionsByEmail(db, 'a@b.com');
        expect(result).toEqual(rows);
    });

    it('passes email as first query parameter', async () => {
        const db = makeDb([], 0);
        await getSubscriptionsByEmail(db, 'a@b.com');
        expect(vi.mocked(db.query).mock.calls[0][1]).toEqual(['a@b.com']);
    });

    it('returns empty array when no subscriptions', async () => {
        const db = makeDb([], 0);
        const result = await getSubscriptionsByEmail(db, 'nobody@example.com');
        expect(result).toEqual([]);
    });
});

describe('getConfirmedSubscribers', () => {
    it('returns rows for given repoId', async () => {
        const rows = [{ email: 'a@b.com', unsubscribe_token: 'tok' }];
        const db = makeDb(rows);
        const result = await getConfirmedSubscribers(db, 5);
        expect(result).toEqual(rows);
    });

    it('passes repoId as first parameter', async () => {
        const db = makeDb([]);
        await getConfirmedSubscribers(db, 99);
        expect(vi.mocked(db.query).mock.calls[0][1]).toEqual([99]);
    });

    it('returns empty array when no subscribers', async () => {
        const db = makeDb([]);
        const result = await getConfirmedSubscribers(db, 1);
        expect(result).toEqual([]);
    });
});
