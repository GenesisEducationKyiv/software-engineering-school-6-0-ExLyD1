import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import { notifyRelease } from '../subscription.notifications.ts';
import type { DbPool } from '../../shared/db/db.types.ts';
import type { NotificationMailer } from '../../shared/mailer/mailer.types.ts';

vi.mock('../subscription.repository.ts', () => ({
    getConfirmedSubscribers: vi.fn(),
}));

import { getConfirmedSubscribers } from '../subscription.repository.ts';

const mockGetConfirmedSubscribers = vi.mocked(getConfirmedSubscribers);

function buildDeps() {
    const mailer: NotificationMailer = {
        sendReleaseNotification: vi.fn().mockResolvedValue(undefined),
    };
    const log = { info: vi.fn(), error: vi.fn() } as unknown as FastifyBaseLogger;
    const db = {} as DbPool;
    return { mailer, log, db };
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('notifyRelease', () => {
    it('looks up confirmed subscribers by the given repo id', async () => {
        const { mailer, log, db } = buildDeps();
        mockGetConfirmedSubscribers.mockResolvedValue([]);

        await notifyRelease(db, mailer, log, 42, 'org/repo', 'v2.0.0');

        expect(mockGetConfirmedSubscribers).toHaveBeenCalledWith(db, 42);
    });

    it('sends a release notification to every confirmed subscriber', async () => {
        const { mailer, log, db } = buildDeps();
        mockGetConfirmedSubscribers.mockResolvedValue([
            { email: 'a@example.com', unsubscribe_token: 'tok-a' },
            { email: 'b@example.com', unsubscribe_token: 'tok-b' },
        ]);

        await notifyRelease(db, mailer, log, 7, 'org/repo', 'v2.0.0');

        expect(mailer.sendReleaseNotification).toHaveBeenCalledTimes(2);
        expect(mailer.sendReleaseNotification).toHaveBeenCalledWith(
            'a@example.com',
            'org/repo',
            'v2.0.0',
            'tok-a',
        );
        expect(mailer.sendReleaseNotification).toHaveBeenCalledWith(
            'b@example.com',
            'org/repo',
            'v2.0.0',
            'tok-b',
        );
    });

    it('does not call the mailer when there are no subscribers', async () => {
        const { mailer, log, db } = buildDeps();
        mockGetConfirmedSubscribers.mockResolvedValue([]);

        await notifyRelease(db, mailer, log, 1, 'org/repo', 'v2.0.0');

        expect(mailer.sendReleaseNotification).not.toHaveBeenCalled();
    });

    it('keeps notifying the remaining subscribers when one send fails', async () => {
        const { mailer, log, db } = buildDeps();
        mockGetConfirmedSubscribers.mockResolvedValue([
            { email: 'a@example.com', unsubscribe_token: 'tok-a' },
            { email: 'b@example.com', unsubscribe_token: 'tok-b' },
        ]);
        vi.mocked(mailer.sendReleaseNotification)
            .mockRejectedValueOnce(new Error('smtp down'))
            .mockResolvedValueOnce(undefined);

        await notifyRelease(db, mailer, log, 1, 'org/repo', 'v2.0.0');

        expect(mailer.sendReleaseNotification).toHaveBeenCalledTimes(2);
        expect(log.error).toHaveBeenCalled();
    });
});
