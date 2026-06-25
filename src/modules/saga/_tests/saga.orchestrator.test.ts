import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DbPool } from '../../shared/db/db.types.ts';
import { startRegisterSubscription, handleReply } from '../saga.orchestrator.ts';

vi.mock('../../subscriptions/subscription.repository.ts', () => ({
    upsertUser: vi.fn().mockResolvedValue(1),
    upsertRepository: vi.fn().mockResolvedValue(2),
    insertSubscription: vi.fn().mockResolvedValue(undefined),
    deleteByConfirmToken: vi.fn().mockResolvedValue(true),
}));
vi.mock('../saga.repository.ts', () => ({
    createSaga: vi.fn(),
    getSaga: vi.fn(),
    setStatus: vi.fn(),
    incrementAttempts: vi.fn(),
}));
vi.mock('../outbox.repository.ts', () => ({
    enqueue: vi.fn(),
}));

import {
    insertSubscription,
    deleteByConfirmToken,
} from '../../subscriptions/subscription.repository.ts';
import {
    type SagaRow,
    createSaga,
    getSaga,
    setStatus,
    incrementAttempts,
} from '../saga.repository.ts';
import { enqueue } from '../outbox.repository.ts';

function buildDb() {
    const client = { query: vi.fn().mockResolvedValue(undefined), release: vi.fn() };
    const db = { connect: vi.fn().mockResolvedValue(client) } as unknown as DbPool;
    return { db, client };
}

function makeSaga(overrides: Partial<SagaRow> = {}): SagaRow {
    return {
        id: 's1',
        type: 'register_subscription',
        status: 'awaiting_confirmation',
        email: 'user@example.com',
        confirm_token: 'tok-1',
        attempts: 0,
        ...overrides,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('startRegisterSubscription', () => {
    it('writes subscription + saga + outbox command in one transaction', async () => {
        const { db, client } = buildDb();

        const sagaId = await startRegisterSubscription(
            db,
            'user@example.com',
            'org/repo',
            'v1.0.0',
        );

        expect(typeof sagaId).toBe('string');
        expect(insertSubscription).toHaveBeenCalledOnce();
        expect(createSaga).toHaveBeenCalledOnce();
        expect(enqueue).toHaveBeenCalledOnce();
        expect(client.query).toHaveBeenCalledWith('BEGIN');
        expect(client.query).toHaveBeenCalledWith('COMMIT');
    });

    it('rolls back and rethrows when a step fails (no dual-write)', async () => {
        const { db, client } = buildDb();
        const boom = new Error('duplicate subscription');
        vi.mocked(insertSubscription).mockRejectedValueOnce(boom);

        await expect(
            startRegisterSubscription(db, 'user@example.com', 'org/repo', 'v1.0.0'),
        ).rejects.toBe(boom);

        expect(client.query).toHaveBeenCalledWith('BEGIN');
        expect(client.query).toHaveBeenCalledWith('ROLLBACK');
        expect(client.query).not.toHaveBeenCalledWith('COMMIT');
        expect(createSaga).not.toHaveBeenCalled();
        expect(enqueue).not.toHaveBeenCalled();
        expect(client.release).toHaveBeenCalledOnce();
    });
});

describe('handleReply', () => {
    it('marks the saga completed when notification reports sent', async () => {
        vi.mocked(getSaga).mockResolvedValue(makeSaga());
        const { db } = buildDb();

        await handleReply(db, { sagaId: 's1', status: 'sent' });

        expect(setStatus).toHaveBeenCalledWith(db, 's1', 'completed');
        expect(deleteByConfirmToken).not.toHaveBeenCalled();
    });

    it('ignores replies for unknown sagas (getSaga returns null)', async () => {
        vi.mocked(getSaga).mockResolvedValue(null);
        const { db } = buildDb();

        await handleReply(db, { sagaId: 'ghost', status: 'sent' });

        expect(setStatus).not.toHaveBeenCalled();
        expect(db.connect).not.toHaveBeenCalled();
    });

    it('ignores replies for sagas not awaiting confirmation (idempotent)', async () => {
        vi.mocked(getSaga).mockResolvedValue(makeSaga({ status: 'completed' }));
        const { db } = buildDb();

        await handleReply(db, { sagaId: 's1', status: 'sent' });

        expect(setStatus).not.toHaveBeenCalled();
    });

    it('retries (re-enqueues) on failure while under the attempt limit', async () => {
        vi.mocked(getSaga).mockResolvedValue(makeSaga({ attempts: 0 }));
        const { db } = buildDb();

        await handleReply(db, { sagaId: 's1', status: 'failed' });

        expect(incrementAttempts).toHaveBeenCalledOnce();
        expect(enqueue).toHaveBeenCalledOnce();
        expect(deleteByConfirmToken).not.toHaveBeenCalled();
    });

    it('compensates (deletes the subscription) when attempts are exhausted', async () => {
        vi.mocked(getSaga).mockResolvedValue(makeSaga({ attempts: 2 }));
        const { db } = buildDb();

        await handleReply(db, { sagaId: 's1', status: 'failed' });

        expect(deleteByConfirmToken).toHaveBeenCalledOnce();
        expect(setStatus).toHaveBeenCalledWith(expect.anything(), 's1', 'failed');
        expect(enqueue).not.toHaveBeenCalled();
    });
});
