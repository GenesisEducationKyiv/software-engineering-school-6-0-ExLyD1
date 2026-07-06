import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DbPool } from '../../shared/db/db.types.ts';
import { startRegisterSubscription, handleReply } from '../saga.orchestrator.ts';

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
    it('creates the pending subscription (port) + saga + outbox command in one transaction', async () => {
        const { db, client } = buildDb();
        const createPending = vi.fn().mockResolvedValue('tok-1');

        const sagaId = await startRegisterSubscription(
            db,
            'user@example.com',
            'org/repo',
            'v1.0.0',
            createPending,
        );

        expect(typeof sagaId).toBe('string');
        expect(createPending).toHaveBeenCalledWith(
            client,
            'user@example.com',
            'org/repo',
            'v1.0.0',
        );
        expect(createSaga).toHaveBeenCalledOnce();
        expect(enqueue).toHaveBeenCalledOnce();
        expect(client.query).toHaveBeenCalledWith('BEGIN');
        expect(client.query).toHaveBeenCalledWith('COMMIT');
    });

    it('rolls back and rethrows when a step fails (no dual-write)', async () => {
        const { db, client } = buildDb();
        const boom = new Error('duplicate subscription');
        const createPending = vi.fn().mockRejectedValue(boom);

        await expect(
            startRegisterSubscription(db, 'user@example.com', 'org/repo', 'v1.0.0', createPending),
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
    const compensate = vi.fn().mockResolvedValue(true);

    it('marks the saga completed when notification reports sent', async () => {
        vi.mocked(getSaga).mockResolvedValue(makeSaga());
        const { db } = buildDb();

        await handleReply(db, { sagaId: 's1', status: 'sent' }, compensate);

        expect(setStatus).toHaveBeenCalledWith(db, 's1', 'completed');
        expect(compensate).not.toHaveBeenCalled();
    });

    it('ignores replies for unknown sagas (getSaga returns null)', async () => {
        vi.mocked(getSaga).mockResolvedValue(null);
        const { db } = buildDb();

        await handleReply(db, { sagaId: 'ghost', status: 'sent' }, compensate);

        expect(setStatus).not.toHaveBeenCalled();
        expect(db.connect).not.toHaveBeenCalled();
    });

    it('ignores replies for sagas not awaiting confirmation (idempotent)', async () => {
        vi.mocked(getSaga).mockResolvedValue(makeSaga({ status: 'completed' }));
        const { db } = buildDb();

        await handleReply(db, { sagaId: 's1', status: 'sent' }, compensate);

        expect(setStatus).not.toHaveBeenCalled();
    });

    it('retries (re-enqueues) on failure while under the attempt limit', async () => {
        vi.mocked(getSaga).mockResolvedValue(makeSaga({ attempts: 0 }));
        const { db } = buildDb();

        await handleReply(db, { sagaId: 's1', status: 'failed' }, compensate);

        expect(incrementAttempts).toHaveBeenCalledOnce();
        expect(enqueue).toHaveBeenCalledOnce();
        expect(compensate).not.toHaveBeenCalled();
    });

    it('compensates (via the injected port) when attempts are exhausted', async () => {
        vi.mocked(getSaga).mockResolvedValue(makeSaga({ attempts: 2 }));
        const { db, client } = buildDb();

        await handleReply(db, { sagaId: 's1', status: 'failed' }, compensate);

        expect(compensate).toHaveBeenCalledWith(client, 'tok-1');
        expect(setStatus).toHaveBeenCalledWith(expect.anything(), 's1', 'failed');
        expect(enqueue).not.toHaveBeenCalled();
    });
});
