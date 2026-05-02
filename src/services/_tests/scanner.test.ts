import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {} from '../../plugins/mailer.ts';
import type {} from '@fastify/postgres';

vi.mock('../github.ts', () => ({
    getLatestRelease: vi.fn(),
}));

import { getLatestRelease } from '../github.ts';
import { runScanCycle } from '../scanner.ts';
import type { FastifyInstance } from 'fastify';

const mockGetLatestRelease = vi.mocked(getLatestRelease);

function buildFastify(queryResponses: unknown[]): FastifyInstance {
    const queryMock = vi.fn();
    queryResponses.forEach((res) => queryMock.mockResolvedValueOnce(res));

    return {
        log: { info: vi.fn(), error: vi.fn() },
        pg: { query: queryMock },
        mailer: { sendReleaseNotification: vi.fn().mockResolvedValue(undefined) },
        addHook: vi.fn(),
    } as unknown as FastifyInstance;
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('runScanCycle', () => {
    it('skips repos with no confirmed subscribers (empty watchedRepos)', async () => {
        const fastify = buildFastify([{ rows: [] }]);

        await runScanCycle(fastify);

        expect(mockGetLatestRelease).not.toHaveBeenCalled();
        expect(fastify.mailer.sendReleaseNotification).not.toHaveBeenCalled();
    });

    it('does NOT notify when tag is unchanged', async () => {
        mockGetLatestRelease.mockResolvedValue({ tag_name: 'v1.0.0' } as any);

        const fastify = buildFastify([
            { rows: [{ id: 1, owner_repo: 'org/repo', last_seen_tag: 'v1.0.0' }] },
        ]);

        await runScanCycle(fastify);

        expect(mockGetLatestRelease).toHaveBeenCalledWith('org/repo');
        expect(fastify.mailer.sendReleaseNotification).not.toHaveBeenCalled();
        const pgQuery = fastify.pg.query as ReturnType<typeof vi.fn>;
        expect(pgQuery).not.toHaveBeenCalledWith(
            expect.stringContaining('UPDATE'),
            expect.anything(),
        );
    });

    it('notifies all confirmed subscribers when new release detected', async () => {
        mockGetLatestRelease.mockResolvedValue({ tag_name: 'v2.0.0' } as any);

        const fastify = buildFastify([
            { rows: [{ id: 1, owner_repo: 'org/repo', last_seen_tag: 'v1.0.0' }] },
            { rows: [{ email: 'user@example.com', unsubscribe_token: 'tok-abc' }] },
            { rows: [] },
        ]);

        await runScanCycle(fastify);

        expect(fastify.mailer.sendReleaseNotification).toHaveBeenCalledOnce();
        expect(fastify.mailer.sendReleaseNotification).toHaveBeenCalledWith(
            'user@example.com',
            'org/repo',
            'v2.0.0',
            'tok-abc',
            fastify.log,
        );
    });

    it('updates last_seen_tag in repositories after notifying', async () => {
        mockGetLatestRelease.mockResolvedValue({ tag_name: 'v2.0.0' } as any);

        const fastify = buildFastify([
            { rows: [{ id: 7, owner_repo: 'org/repo', last_seen_tag: 'v1.0.0' }] },
            { rows: [{ email: 'user@example.com', unsubscribe_token: 'tok-abc' }] },
            { rows: [] },
        ]);

        await runScanCycle(fastify);

        const pgQuery = fastify.pg.query as ReturnType<typeof vi.fn>;
        const updateCall = pgQuery.mock.calls.find(
            (call: unknown[]) =>
                typeof call[0] === 'string' && call[0].includes('UPDATE repositories'),
        );
        expect(updateCall).toBeDefined();
        expect(updateCall![1]).toEqual(['v2.0.0', 7]);
    });

    it('UPDATE happens before emails, not after', async () => {
        mockGetLatestRelease.mockResolvedValue({ tag_name: 'v2.0.0' } as any);

        const callOrder: string[] = [];
        const queryResponses: unknown[] = [
            { rows: [{ id: 1, owner_repo: 'org/repo', last_seen_tag: 'v1.0.0' }] },
            { rows: [{ email: 'user@example.com', unsubscribe_token: 'tok' }] },
            { rows: [] },
        ];
        let callCount = 0;
        const pgQuery = vi.fn(async (...args: unknown[]) => {
            if (typeof args[0] === 'string' && (args[0] as string).includes('UPDATE')) {
                callOrder.push('update');
            }
            return queryResponses[callCount++];
        });

        const fastify = {
            log: { info: vi.fn(), error: vi.fn() },
            pg: { query: pgQuery },
            mailer: {
                sendReleaseNotification: vi.fn(async () => {
                    callOrder.push('email');
                }),
            },
            addHook: vi.fn(),
        } as unknown as FastifyInstance;

        await runScanCycle(fastify);

        expect(callOrder).toEqual(['update', 'email']);
    });

    it('aborts scan cycle when any repo in a batch hits the rate limit', async () => {
        mockGetLatestRelease
            .mockRejectedValueOnce(new Error('GitHub API error: 429'))
            .mockResolvedValueOnce({ tag_name: 'v3.0.0' } as any);

        const fastify = buildFastify([
            {
                rows: [
                    { id: 1, owner_repo: 'rate-limited/repo', last_seen_tag: 'v1.0.0' },
                    { id: 2, owner_repo: 'org/other-repo', last_seen_tag: 'v2.0.0' },
                ],
            },
        ]);

        await runScanCycle(fastify);

        expect(mockGetLatestRelease).toHaveBeenCalledTimes(2);
        expect(fastify.mailer.sendReleaseNotification).not.toHaveBeenCalled();
        expect(fastify.log.error).toHaveBeenCalledWith(
            expect.stringContaining('aborting scan cycle'),
        );
    });
});
