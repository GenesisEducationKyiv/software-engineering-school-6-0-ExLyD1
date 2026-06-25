import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { QueryRunner } from '../../shared/db/db.types.ts';
import {
    createSaga,
    getSaga,
    setStatus,
    incrementAttempts,
    type SagaRow,
} from '../saga.repository.ts';

function makeDb(rows: unknown[] = [], rowCount: number | null = 1): QueryRunner {
    return { query: vi.fn().mockResolvedValue({ rows, rowCount }) };
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('createSaga', () => {
    it('inserts the saga in awaiting_confirmation state with the given params', async () => {
        const db = makeDb();
        await createSaga(db, 's1', 'user@example.com', 'tok-1');

        const [sql, params] = vi.mocked(db.query).mock.calls[0];
        expect(sql).toContain('INSERT INTO saga');
        expect(sql).toContain("'awaiting_confirmation'");
        expect(params).toEqual(['s1', 'user@example.com', 'tok-1']);
    });
});

describe('getSaga', () => {
    it('returns the row when found', async () => {
        const saga: SagaRow = {
            id: 's1',
            type: 'register_subscription',
            status: 'awaiting_confirmation',
            email: 'user@example.com',
            confirm_token: 'tok-1',
            attempts: 0,
        };
        const db = makeDb([saga], 1);
        const result = await getSaga(db, 's1');
        expect(result).toEqual(saga);
        expect(vi.mocked(db.query).mock.calls[0][1]).toEqual(['s1']);
    });

    it('returns null when not found', async () => {
        const db = makeDb([], 0);
        const result = await getSaga(db, 'missing');
        expect(result).toBeNull();
    });
});

describe('setStatus', () => {
    it('updates status for the given saga id', async () => {
        const db = makeDb();
        await setStatus(db, 's1', 'completed');

        const [sql, params] = vi.mocked(db.query).mock.calls[0];
        expect(sql).toContain('UPDATE saga SET status');
        expect(params).toEqual(['completed', 's1']);
    });
});

describe('incrementAttempts', () => {
    it('increments attempts for the given saga id', async () => {
        const db = makeDb();
        await incrementAttempts(db, 's1');

        const [sql, params] = vi.mocked(db.query).mock.calls[0];
        expect(sql).toContain('attempts = attempts + 1');
        expect(params).toEqual(['s1']);
    });
});
