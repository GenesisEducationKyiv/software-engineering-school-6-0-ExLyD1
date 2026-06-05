import type { User, Repository, Subscription } from '../shared/db/db.types.ts';

export type WatchedRepo = Pick<Repository, 'id' | 'owner_repo' | 'last_seen_tag'>;

export type ScannerSubscriberRow = Pick<User, 'email'> & Pick<Subscription, 'unsubscribe_token'>;
