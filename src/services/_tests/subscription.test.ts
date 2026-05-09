import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    subscribe,
    confirmSubscription,
    deleteSubscription,
    getSubscriptionsByEmail,
    AlreadySubscribedError,
} from '../subscription.ts';
import type { DbPool } from '../../types/index.ts';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function buildDb(queryMock: ReturnType<typeof vi.fn>): DbPool {
    const client = { query: queryMock, release: vi.fn() };
    return {
        connect: vi.fn().mockResolvedValue(client),
        query: queryMock,
    } as unknown as DbPool;
}

function subscribeQueryMock(overrideLastWith?: unknown): ReturnType<typeof vi.fn> {
    const mock = vi.fn();
    mock.mockResolvedValueOnce(null); // BEGIN
    mock.mockResolvedValueOnce(null); // INSERT users
    mock.mockResolvedValueOnce({ rows: [{ id: 1 }] }); // SELECT users
    mock.mockResolvedValueOnce(null); // INSERT repositories
    mock.mockResolvedValueOnce({ rows: [{ id: 2 }] }); // SELECT repositories
    if (overrideLastWith instanceof Error) {
        mock.mockRejectedValueOnce(overrideLastWith); // INSERT subscriptions (error)
        mock.mockResolvedValueOnce(null); // ROLLBACK
    } else {
        mock.mockResolvedValueOnce(null); // INSERT subscriptions (success)
        mock.mockResolvedValueOnce(null); // COMMIT
    }
    return mock;
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('subscribe', () => {
    const noop = vi.fn().mockResolvedValue(undefined);

    it('returns a v4 UUID confirm token', async () => {
        const db = buildDb(subscribeQueryMock());
        const token = await subscribe(db, 'user@example.com', 'org/repo', 'v1.0.0', noop);
        expect(token).toMatch(UUID_REGEX);
    });

    it('executes 7 DB queries: BEGIN, upsert user, select user, upsert repo, select repo, insert subscription, COMMIT', async () => {
        const mock = subscribeQueryMock();
        const db = buildDb(mock);
        await subscribe(db, 'user@example.com', 'org/repo', 'v1.0.0', noop);
        expect(mock).toHaveBeenCalledTimes(7);
    });

    it('throws AlreadySubscribedError when pg returns unique violation (code 23505)', async () => {
        const err = Object.assign(new Error('unique violation'), { code: '23505' });
        const db = buildDb(subscribeQueryMock(err));
        await expect(
            subscribe(db, 'user@example.com', 'org/repo', 'v1.0.0', noop),
        ).rejects.toThrow(AlreadySubscribedError);
    });

    it('AlreadySubscribedError message describes the conflict', async () => {
        const err = Object.assign(new Error('unique violation'), { code: '23505' });
        const db = buildDb(subscribeQueryMock(err));
        await expect(
            subscribe(db, 'user@example.com', 'org/repo', 'v1.0.0', noop),
        ).rejects.toThrow('Email already subscribed to this repository');
    });

    it('re-throws non-duplicate DB errors without wrapping', async () => {
        const err = Object.assign(new Error('connection refused'), { code: '08006' });
        const db = buildDb(subscribeQueryMock(err));
        await expect(
            subscribe(db, 'user@example.com', 'org/repo', 'v1.0.0', noop),
        ).rejects.toThrow('connection refused');
    });

    it('rolls back and throws when onBeforeCommit callback throws (e.g. email failure)', async () => {
        const emailError = new Error('SMTP failure');
        const failingCallback = vi.fn().mockRejectedValue(emailError);

        const m = vi.fn();
        m.mockResolvedValueOnce(null); // BEGIN
        m.mockResolvedValueOnce(null); // INSERT users
        m.mockResolvedValueOnce({ rows: [{ id: 1 }] }); // SELECT users
        m.mockResolvedValueOnce(null); // INSERT repositories
        m.mockResolvedValueOnce({ rows: [{ id: 2 }] }); // SELECT repositories
        m.mockResolvedValueOnce(null); // INSERT subscriptions
        m.mockResolvedValueOnce(null); // ROLLBACK
        const db = buildDb(m);

        await expect(
            subscribe(db, 'user@example.com', 'org/repo', 'v1.0.0', failingCallback),
        ).rejects.toThrow('SMTP failure');

        const calls = m.mock.calls.map((c) => c[0] as string);
        expect(calls).not.toContain('COMMIT');
        expect(calls[calls.length - 1]).toBe('ROLLBACK');
    });
});

describe('confirmSubscription', () => {
    it('returns true when rowCount is 1 (token matched and row was updated)', async () => {
        const mock = vi.fn().mockResolvedValueOnce({ rowCount: 1 });
        const db = buildDb(mock);
        const result = await confirmSubscription(db, 'some-token');
        expect(result).toBe(true);
    });

    it('returns false when rowCount is 0 (token not found)', async () => {
        const mock = vi.fn().mockResolvedValueOnce({ rowCount: 0 });
        const db = buildDb(mock);
        const result = await confirmSubscription(db, 'unknown-token');
        expect(result).toBe(false);
    });

    it('passes the token as a query parameter', async () => {
        const mock = vi.fn().mockResolvedValueOnce({ rowCount: 1 });
        const db = buildDb(mock);
        await confirmSubscription(db, 'abc-123');
        expect(mock).toHaveBeenCalledWith(expect.any(String), ['abc-123']);
    });
});

describe('deleteSubscription', () => {
    it('returns true when rowCount is 1 (token matched and row was deleted)', async () => {
        const mock = vi.fn().mockResolvedValueOnce({ rowCount: 1 });
        const db = buildDb(mock);
        const result = await deleteSubscription(db, 'unsub-token');
        expect(result).toBe(true);
    });

    it('returns false when rowCount is 0 (token not found)', async () => {
        const mock = vi.fn().mockResolvedValueOnce({ rowCount: 0 });
        const db = buildDb(mock);
        const result = await deleteSubscription(db, 'unknown-token');
        expect(result).toBe(false);
    });

    it('passes the token as a query parameter', async () => {
        const mock = vi.fn().mockResolvedValueOnce({ rowCount: 1 });
        const db = buildDb(mock);
        await deleteSubscription(db, 'tok-xyz');
        expect(mock).toHaveBeenCalledWith(expect.any(String), ['tok-xyz']);
    });
});

describe('getSubscriptionsByEmail', () => {
    it('returns the rows from the query result', async () => {
        const rows = [
            {
                email: 'user@example.com',
                repo: 'org/repo',
                confirmed: true,
                last_seen_tag: 'v1.0.0',
            },
        ];
        const mock = vi.fn().mockResolvedValueOnce({ rows });
        const db = buildDb(mock);

        const result = await getSubscriptionsByEmail(db, 'user@example.com');

        expect(result).toEqual(rows);
    });

    it('returns an empty array when user has no subscriptions', async () => {
        const mock = vi.fn().mockResolvedValueOnce({ rows: [] });
        const db = buildDb(mock);
        const result = await getSubscriptionsByEmail(db, 'nobody@example.com');
        expect(result).toEqual([]);
    });

    it('passes the email as a query parameter', async () => {
        const mock = vi.fn().mockResolvedValueOnce({ rows: [] });
        const db = buildDb(mock);
        await getSubscriptionsByEmail(db, 'user@example.com');
        expect(mock).toHaveBeenCalledWith(expect.any(String), ['user@example.com']);
    });
});
