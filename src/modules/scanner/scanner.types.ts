import type { Repository } from '../shared/db/db.types.ts';

export type WatchedRepo = Pick<Repository, 'id' | 'owner_repo' | 'last_seen_tag'>;
