import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import { runScanCycle } from '../scanner.service.ts';
import { GitHubApiError } from '../../shared/github/github.errors.ts';
import type { DbPool } from '../../shared/db/db.types.ts';
import type { GitHubClient, GitHubRelease } from '../../shared/github/github.types.ts';
import type { NotificationMailer, ConfirmationMailer } from '../../shared/mailer/mailer.types.ts';
import type { WatchedRepo } from '../scanner.types.ts';

vi.mock('../scanner.repository.ts', () => ({
    getWatchedRepos: vi.fn(),
    getConfirmedSubscribers: vi.fn(),
    updateLastSeenTag: vi.fn().mockResolvedValue(undefined),
}));

import {
    getWatchedRepos,
    getConfirmedSubscribers,
    updateLastSeenTag,
} from '../scanner.repository.ts';

const mockGetWatchedRepos = vi.mocked(getWatchedRepos);
const mockGetConfirmedSubscribers = vi.mocked(getConfirmedSubscribers);
const mockUpdateLastSeenTag = vi.mocked(updateLastSeenTag);

function buildDeps(watchedRepos: WatchedRepo[] = []) {
    mockGetWatchedRepos.mockResolvedValue(watchedRepos);

    const github: GitHubClient = { getLatestRelease: vi.fn() };
    const mailer: NotificationMailer & ConfirmationMailer = {
        sendConfirmationEmail: vi.fn(),
        sendReleaseNotification: vi.fn().mockResolvedValue(undefined),
    };
    const log = { info: vi.fn(), error: vi.fn() } as unknown as FastifyBaseLogger;
    const db = {} as DbPool;

    return { github, mailer, log, db };
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('runScanCycle', () => {
    it('skips repos with no confirmed subscribers (empty watchedRepos)', async () => {
        const { github, mailer, log, db } = buildDeps([]);

        await runScanCycle(db, github, mailer, log);

        expect(github.getLatestRelease).not.toHaveBeenCalled();
        expect(mailer.sendReleaseNotification).not.toHaveBeenCalled();
    });

    it('does NOT notify when tag is unchanged', async () => {
        const repo: WatchedRepo = { id: 1, owner_repo: 'org/repo', last_seen_tag: 'v1.0.0' };
        const { github, mailer, log, db } = buildDeps([repo]);

        vi.mocked(github.getLatestRelease).mockResolvedValue({
            tag_name: 'v1.0.0',
        } as GitHubRelease);

        await runScanCycle(db, github, mailer, log);

        expect(github.getLatestRelease).toHaveBeenCalledWith('org/repo');
        expect(mailer.sendReleaseNotification).not.toHaveBeenCalled();
        expect(mockUpdateLastSeenTag).not.toHaveBeenCalled();
    });

    it('notifies all confirmed subscribers when new release detected', async () => {
        const repo: WatchedRepo = { id: 1, owner_repo: 'org/repo', last_seen_tag: 'v1.0.0' };
        const { github, mailer, log, db } = buildDeps([repo]);

        vi.mocked(github.getLatestRelease).mockResolvedValue({
            tag_name: 'v2.0.0',
        } as GitHubRelease);
        mockGetConfirmedSubscribers.mockResolvedValue([
            { email: 'user@example.com', unsubscribe_token: 'tok-abc' },
        ]);

        await runScanCycle(db, github, mailer, log);

        expect(mailer.sendReleaseNotification).toHaveBeenCalledOnce();
        expect(mailer.sendReleaseNotification).toHaveBeenCalledWith(
            'user@example.com',
            'org/repo',
            'v2.0.0',
            'tok-abc',
        );
    });

    it('updates last_seen_tag in repositories after notifying', async () => {
        const repo: WatchedRepo = { id: 7, owner_repo: 'org/repo', last_seen_tag: 'v1.0.0' };
        const { github, mailer, log, db } = buildDeps([repo]);

        vi.mocked(github.getLatestRelease).mockResolvedValue({
            tag_name: 'v2.0.0',
        } as GitHubRelease);
        mockGetConfirmedSubscribers.mockResolvedValue([
            { email: 'user@example.com', unsubscribe_token: 'tok-abc' },
        ]);

        await runScanCycle(db, github, mailer, log);

        expect(mockUpdateLastSeenTag).toHaveBeenCalledWith(db, 7, 'v2.0.0');
    });

    it('UPDATE happens before emails, not after', async () => {
        const repo: WatchedRepo = { id: 1, owner_repo: 'org/repo', last_seen_tag: 'v1.0.0' };
        const { github, mailer, log, db } = buildDeps([repo]);

        vi.mocked(github.getLatestRelease).mockResolvedValue({
            tag_name: 'v2.0.0',
        } as GitHubRelease);
        mockGetConfirmedSubscribers.mockResolvedValue([
            { email: 'user@example.com', unsubscribe_token: 'tok' },
        ]);

        const callOrder: string[] = [];
        mockUpdateLastSeenTag.mockImplementation(async () => {
            callOrder.push('update');
        });
        vi.mocked(mailer.sendReleaseNotification).mockImplementation(async () => {
            callOrder.push('email');
        });

        await runScanCycle(db, github, mailer, log);

        expect(callOrder).toEqual(['update', 'email']);
    });

    it('aborts scan cycle when any repo in a batch hits the rate limit', async () => {
        const repos: WatchedRepo[] = [
            { id: 1, owner_repo: 'rate-limited/repo', last_seen_tag: 'v1.0.0' },
            { id: 2, owner_repo: 'org/other-repo', last_seen_tag: 'v2.0.0' },
        ];
        const { github, mailer, log, db } = buildDeps(repos);

        vi.mocked(github.getLatestRelease)
            .mockRejectedValueOnce(new GitHubApiError(429))
            .mockResolvedValueOnce({ tag_name: 'v3.0.0' } as GitHubRelease);

        await runScanCycle(db, github, mailer, log);

        expect(github.getLatestRelease).toHaveBeenCalledTimes(2);
        expect(mailer.sendReleaseNotification).not.toHaveBeenCalled();
        expect(log.error).toHaveBeenCalledWith(
            expect.objectContaining({ repository: 'rate-limited/repo' }),
            expect.stringContaining('aborting scan cycle'),
        );
    });
});
