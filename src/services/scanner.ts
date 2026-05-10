import type { DbPool, GitHubClient, NotificationMailer, WatchedRepo } from '../types/index.ts';
import { GitHubApiError } from '../errors/index.ts';
import {
    getWatchedRepos,
    getConfirmedSubscribers,
    updateLastSeenTag,
} from '../repositories/scanner.repository.ts';
import { SCAN_CHUNK_SIZE } from '../constants/index.ts';

type Logger = {
    info: (msg: string) => void;
    error: (msg: string | object, ...args: unknown[]) => void;
};

type RepoUpdate = {
    repo: WatchedRepo;
    latestTag: string;
};

export const fetchRepoUpdates = async (
    repos: WatchedRepo[],
    github: GitHubClient,
    log: Logger,
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
                        log.info(`Scanner: no releases found for ${repo.owner_repo}, skipping`);
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
                        { err },
                        `Scanner: failed to fetch release for ${repo.owner_repo}, skipping`,
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
                `Scanner: rate limit hit for ${rateLimited.repo.owner_repo}, aborting scan cycle`,
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
    log: Logger,
): Promise<void> => {
    for (const { repo, latestTag } of updates) {
        log.info(`Scanner: new release ${latestTag} for ${repo.owner_repo}`);

        const subscribers = await getConfirmedSubscribers(db, repo.id);

        log.info(`Scanner: notifying ${subscribers.length} subscriber(s) for ${repo.owner_repo}`);

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
                log.error({ err }, `Scanner: failed to notify ${sub.email} for ${repo.owner_repo}`);
            }
        }
    }
};

export const runScanCycle = async (
    db: DbPool,
    github: GitHubClient,
    mailer: NotificationMailer,
    log: Logger,
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
    log: Logger,
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
