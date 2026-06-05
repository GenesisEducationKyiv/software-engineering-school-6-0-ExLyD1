import type { DbPool } from '../shared/db/db.types.ts';
import type { GitHubClient } from '../shared/github/github.types.ts';
import type { NotificationMailer } from '../shared/mailer/mailer.types.ts';
import type { WatchedRepo } from './scanner.types.ts';
import { GitHubApiError } from '../shared/github/github.errors.ts';
import {
    getWatchedRepos,
    getConfirmedSubscribers,
    updateLastSeenTag,
} from './scanner.repository.ts';
import type { FastifyBaseLogger } from 'fastify';
import { SCAN_CHUNK_SIZE } from './scanner.constants.ts';

type RepoUpdate = {
    repo: WatchedRepo;
    latestTag: string;
};

export const fetchRepoUpdates = async (
    repos: WatchedRepo[],
    github: GitHubClient,
    log: FastifyBaseLogger,
): Promise<RepoUpdate[] | 'rate_limited'> => {
    type ChunkResult =
        | { status: 'rate_limited'; repo: WatchedRepo }
        | { status: 'skipped' | 'unchanged' }
        | { status: 'ready'; repo: WatchedRepo; latestTag: string };

    const updates: RepoUpdate[] = [];

    for (let i = 0; i < repos.length; i += SCAN_CHUNK_SIZE) {
        const chunk = repos.slice(i, i + SCAN_CHUNK_SIZE);

        const results = await Promise.all(
            chunk.map(async (repo): Promise<ChunkResult> => {
                try {
                    const release = await github.getLatestRelease(repo.owner_repo);
                    if (!release) {
                        log.info(
                            { repository: repo.owner_repo },
                            'Scanner: no releases found, skipping',
                        );
                        return { status: 'skipped' };
                    }
                    if (repo.last_seen_tag === release.tag_name) {
                        return { status: 'unchanged' };
                    }
                    return { status: 'ready', repo, latestTag: release.tag_name };
                } catch (err) {
                    if (err instanceof GitHubApiError && err.status === 429) {
                        return { status: 'rate_limited', repo };
                    }
                    log.error(
                        { err, repository: repo.owner_repo },
                        'Scanner: failed to fetch release, skipping',
                    );
                    return { status: 'skipped' };
                }
            }),
        );

        const rateLimited = results.find(
            (r): r is Extract<ChunkResult, { status: 'rate_limited' }> =>
                r.status === 'rate_limited',
        );
        if (rateLimited) {
            log.error(
                { repository: rateLimited.repo.owner_repo },
                'Scanner: rate limit hit, aborting scan cycle',
            );
            return 'rate_limited';
        }

        for (const result of results) {
            if (result.status === 'ready') {
                updates.push({ repo: result.repo, latestTag: result.latestTag });
            }
        }
    }

    return updates;
};

export const persistAndNotify = async (
    updates: RepoUpdate[],
    db: DbPool,
    mailer: NotificationMailer,
    log: FastifyBaseLogger,
): Promise<void> => {
    for (const { repo, latestTag } of updates) {
        log.info({ repository: repo.owner_repo, tag: latestTag }, 'Scanner: new release detected');

        const subscribers = await getConfirmedSubscribers(db, repo.id);

        log.info(
            { repository: repo.owner_repo, subscriberCount: subscribers.length },
            'Scanner: notifying subscribers',
        );

        await updateLastSeenTag(db, repo.id, latestTag);

        for (const sub of subscribers) {
            try {
                await mailer.sendReleaseNotification(
                    sub.email,
                    repo.owner_repo,
                    latestTag,
                    sub.unsubscribe_token,
                );
            } catch (err) {
                log.error(
                    { err, repository: repo.owner_repo },
                    'Scanner: failed to notify subscriber',
                );
            }
        }
    }
};

export const runScanCycle = async (
    db: DbPool,
    github: GitHubClient,
    mailer: NotificationMailer,
    log: FastifyBaseLogger,
): Promise<void> => {
    log.info('Scanner: starting scan cycle');

    const watchedRepos = await getWatchedRepos(db);
    const updates = await fetchRepoUpdates(watchedRepos, github, log);

    if (updates === 'rate_limited') {
        return;
    }

    await persistAndNotify(updates, db, mailer, log);

    log.info('Scanner: scan cycle complete');
};

export const startScanner = (
    db: DbPool,
    github: GitHubClient,
    mailer: NotificationMailer,
    log: FastifyBaseLogger,
    intervalMs: number,
): ReturnType<typeof setInterval> => {
    const run = async () => {
        try {
            await runScanCycle(db, github, mailer, log);
        } catch (err) {
            log.error({ err }, 'Scanner: unhandled error in scan cycle');
        }
    };

    run();
    return setInterval(run, intervalMs);
};
