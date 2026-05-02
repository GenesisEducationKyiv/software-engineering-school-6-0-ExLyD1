import type { FastifyInstance } from 'fastify';
import { getLatestRelease } from './github.ts';
import type { WatchedRepo, ScannerSubscriberRow } from '../types/index.ts';
import { SCAN_CHUNK_SIZE } from '../constants/index.ts';

export const runScanCycle = async (fastify: FastifyInstance): Promise<void> => {
    fastify.log.info('Scanner: starting scan cycle');

    const { rows: watchedRepos } = await fastify.pg.query<WatchedRepo>(`
        SELECT DISTINCT r.id, r.owner_repo, r.last_seen_tag
        FROM repositories r
        JOIN subscriptions s ON s.repository_id = r.id
        WHERE s.confirmed = true
    `);

    for (let i = 0; i < watchedRepos.length; i += SCAN_CHUNK_SIZE) {
        const chunk = watchedRepos.slice(i, i + SCAN_CHUNK_SIZE);

        type RepoResult =
            | { status: 'rate_limited'; repo: WatchedRepo }
            | { status: 'skipped' | 'unchanged' }
            | { status: 'ready'; repo: WatchedRepo; latestTag: string };

        const results = await Promise.all(
            chunk.map(async (repo: WatchedRepo): Promise<RepoResult> => {
                try {
                    const release = await getLatestRelease(repo.owner_repo);
                    if (!release) {
                        fastify.log.info(
                            `Scanner: no releases found for ${repo.owner_repo}, skipping`,
                        );
                        return { status: 'skipped' };
                    }
                    if (repo.last_seen_tag === release.tag_name) {
                        return { status: 'unchanged' };
                    }
                    return { status: 'ready', repo, latestTag: release.tag_name };
                } catch (err) {
                    // I know that in swagger it is not any 429 error, but it is just my own decision to add
                    if (err instanceof Error && err.message.includes('GitHub API error: 429')) {
                        return { status: 'rate_limited', repo };
                    }
                    fastify.log.error(
                        { err },
                        `Scanner: failed to fetch release for ${repo.owner_repo}, skipping`,
                    );
                    return { status: 'skipped' };
                }
            }),
        );

        const rateLimited = results.find((r: RepoResult) => r.status === 'rate_limited');
        if (rateLimited && rateLimited.status === 'rate_limited') {
            fastify.log.error(
                `Scanner: rate limit hit for ${rateLimited.repo.owner_repo}, aborting scan cycle`,
            );
            return;
        }

        for (const result of results) {
            if (result.status !== 'ready') {
                continue;
            }
            const { repo, latestTag } = result;

            fastify.log.info(`Scanner: new release ${latestTag} for ${repo.owner_repo}`);

            const { rows: subscribers } = await fastify.pg.query<ScannerSubscriberRow>(
                `
                SELECT u.email, s.unsubscribe_token
                FROM subscriptions s
                JOIN users u ON u.id = s.user_id
                WHERE s.repository_id = $1 AND s.confirmed = true
            `,
                [repo.id],
            );

            fastify.log.info(
                `Scanner: notifying ${subscribers.length} subscriber(s) for ${repo.owner_repo}`,
            );

            await fastify.pg.query(`UPDATE repositories SET last_seen_tag = $1 WHERE id = $2`, [
                latestTag,
                repo.id,
            ]);

            // <3 genesis love Future Perspective: ---> TODO: add email queue for high-volume scenarios
            for (const sub of subscribers) {
                try {
                    await fastify.mailer.sendReleaseNotification(
                        sub.email,
                        repo.owner_repo,
                        latestTag,
                        sub.unsubscribe_token,
                        fastify.log,
                    );
                } catch (err) {
                    fastify.log.error(
                        { err },
                        `Scanner: failed to notify ${sub.email} for ${repo.owner_repo}`,
                    );
                }
            }
        }
    }

    fastify.log.info('Scanner: scan cycle complete');
};

export const startScanner = (fastify: FastifyInstance, intervalMs: number): void => {
    const run = async () => {
        try {
            await runScanCycle(fastify);
        } catch (err) {
            fastify.log.error({ err }, 'Scanner: unhandled error in scan cycle');
        }
    };

    run();

    const timer = setInterval(run, intervalMs);

    fastify.addHook('onClose', async () => {
        clearInterval(timer);
        fastify.log.info('Scanner: stopped');
    });

    fastify.log.info(`Scanner: started, interval ${intervalMs / 1000}s`);
};
