import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { QueryRunner } from '../../shared/db/db.types.ts';
import { getWatchedRepos, updateLastSeenTag } from '../scanner.repository.ts';

function makeDb(rows: unknown[] = [], rowCount: number | null = 1): QueryRunner {
    return { query: vi.fn().mockResolvedValue({ rows, rowCount }) };
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('getWatchedRepos', () => {
    it('returns rows from query', async () => {
        const rows = [{ id: 1, owner_repo: 'org/repo', last_seen_tag: 'v1.0.0' }];
        const db = makeDb(rows);
        const result = await getWatchedRepos(db);
        expect(result).toEqual(rows);
    });

    it('SQL contains confirmed = true filter', async () => {
        const db = makeDb([]);
        await getWatchedRepos(db);
        const sql = vi.mocked(db.query).mock.calls[0][0] as string;
        expect(sql).toContain('confirmed = true');
    });

    it('returns empty array when no repos', async () => {
        const db = makeDb([]);
        const result = await getWatchedRepos(db);
        expect(result).toEqual([]);
    });
});

describe('updateLastSeenTag', () => {
    it('calls query with tag as $1 and repoId as $2', async () => {
        const db = makeDb();
        await updateLastSeenTag(db, 3, 'v2.0.0');
        expect(vi.mocked(db.query).mock.calls[0][1]).toEqual(['v2.0.0', 3]);
    });

    it('returns void', async () => {
        const db = makeDb();
        const result = await updateLastSeenTag(db, 1, 'v1.0.0');
        expect(result).toBeUndefined();
    });
});
