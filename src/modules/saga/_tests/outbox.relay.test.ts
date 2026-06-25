import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import type { DbPool } from '../../shared/db/db.types.ts';
import type { RabbitChannel } from '../../shared/messaging/rabbit.ts';
import { startRelay } from '../outbox.relay.ts';

vi.mock('../outbox.repository.ts', () => ({
    fetchUnpublished: vi.fn(),
    markPublished: vi.fn(),
}));

import { fetchUnpublished, markPublished } from '../outbox.repository.ts';

const mockFetch = vi.mocked(fetchUnpublished);
const mockMark = vi.mocked(markPublished);

function buildDeps() {
    const channel = { sendToQueue: vi.fn() } as unknown as RabbitChannel;
    const log = { error: vi.fn() } as unknown as FastifyBaseLogger;
    const db = {} as DbPool;
    return { db, channel, log };
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('startRelay', () => {
    it('publishes each unpublished row to its queue and marks it published', async () => {
        mockFetch.mockResolvedValueOnce([
            { id: 1, queue: 'email_commands', payload: { a: 1 } },
            { id: 2, queue: 'email_commands', payload: { a: 2 } },
        ]);
        mockMark.mockResolvedValue(undefined);
        const { db, channel, log } = buildDeps();

        const timer = startRelay(db, channel, log, 1000);
        await vi.advanceTimersByTimeAsync(1000);
        clearInterval(timer);

        expect(channel.sendToQueue).toHaveBeenCalledTimes(2);
        expect(channel.sendToQueue).toHaveBeenNthCalledWith(
            1,
            'email_commands',
            Buffer.from(JSON.stringify({ a: 1 })),
            { persistent: true },
        );
        expect(mockMark).toHaveBeenCalledWith(db, 1);
        expect(mockMark).toHaveBeenCalledWith(db, 2);
        expect(log.error).not.toHaveBeenCalled();
    });

    it('does nothing when the outbox is empty', async () => {
        mockFetch.mockResolvedValue([]);
        const { db, channel, log } = buildDeps();

        const timer = startRelay(db, channel, log, 1000);
        await vi.advanceTimersByTimeAsync(1000);
        clearInterval(timer);

        expect(channel.sendToQueue).not.toHaveBeenCalled();
        expect(mockMark).not.toHaveBeenCalled();
    });

    it('logs the error and keeps polling when a run fails', async () => {
        mockFetch
            .mockRejectedValueOnce(new Error('db down'))
            .mockResolvedValueOnce([{ id: 5, queue: 'q', payload: { ok: true } }]);
        mockMark.mockResolvedValue(undefined);
        const { db, channel, log } = buildDeps();

        const timer = startRelay(db, channel, log, 1000);

        // First tick fails — caught and logged, no crash.
        await vi.advanceTimersByTimeAsync(1000);
        expect(log.error).toHaveBeenCalledOnce();
        expect(channel.sendToQueue).not.toHaveBeenCalled();

        // Second tick still runs and publishes.
        await vi.advanceTimersByTimeAsync(1000);
        clearInterval(timer);
        expect(channel.sendToQueue).toHaveBeenCalledOnce();
        expect(mockMark).toHaveBeenCalledWith(db, 5);
    });
});
