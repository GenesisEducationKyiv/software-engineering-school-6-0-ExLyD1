import type { User, Repository } from '../shared/db/db.types.ts';

export type SubscriptionRow = Pick<User, 'email'> &
    Pick<Repository, 'last_seen_tag'> & {
        repo: string;
        confirmed: boolean;
    };
