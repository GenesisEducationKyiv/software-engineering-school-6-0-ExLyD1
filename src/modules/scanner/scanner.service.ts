import type { DbPool } from '../shared/db/db.types.ts';
import type { GitHubClient } from '../shared/github/github.types.ts';
import type { WatchedRepo } from './scanner.types.ts';
import { GitHubApiError } from '../shared/github/github.errors.ts';
import { getWatchedRepos, updateLastSeenTag } from './scanner.repository.ts';
import type { FastifyBaseLogger } from 'fastify';
import { SCAN_CHUNK_SIZE } from './scanner.constants.ts';

type RepoUpdate = {
    repo: WatchedRepo;
    latestTag: string;
};

/**
 * Called when the scanner detects a new release. The scanner does not know — or
 * care — what happens next (notify subscribers, publish to a queue, …). The
 * handler is injected by the composition root (app.ts), keeping the scanner free
 * of any dependency on the subscriptions module or the mailer.
 */
export type ReleaseHandler = (
    repoId: number,
    ownerRepo: string,
    latestTag: string,
) => Promise<void>;

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

export const dispatchUpdates = async (
    updates: RepoUpdate[],
    db: DbPool,
    log: FastifyBaseLogger,
    onRelease: ReleaseHandler,
): Promise<void> => {
    for (const { repo, latestTag } of updates) {
        log.info({ repository: repo.owner_repo, tag: latestTag }, 'Scanner: new release detected');

        await updateLastSeenTag(db, repo.id, latestTag);
        await onRelease(repo.id, repo.owner_repo, latestTag);
    }
};

export const runScanCycle = async (
    db: DbPool,
    github: GitHubClient,
    log: FastifyBaseLogger,
    onRelease: ReleaseHandler,
): Promise<void> => {
    log.info('Scanner: starting scan cycle');

    const watchedRepos = await getWatchedRepos(db);
    const updates = await fetchRepoUpdates(watchedRepos, github, log);

    if (updates === 'rate_limited') {
        return;
    }

    await dispatchUpdates(updates, db, log, onRelease);

    log.info('Scanner: scan cycle complete');
};

export const startScanner = (
    db: DbPool,
    github: GitHubClient,
    log: FastifyBaseLogger,
    intervalMs: number,
    onRelease: ReleaseHandler,
): ReturnType<typeof setInterval> => {
    const run = async () => {
        try {
            await runScanCycle(db, github, log, onRelease);
        } catch (err) {
            log.error({ err }, 'Scanner: unhandled error in scan cycle');
        }
    };

    run();
    return setInterval(run, intervalMs);
};
