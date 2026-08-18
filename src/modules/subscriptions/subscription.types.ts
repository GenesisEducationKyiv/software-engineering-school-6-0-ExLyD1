import type { User, Repository, Subscription } from '../shared/db/db.types.ts';

export type SubscriptionRow = Pick<User, 'email'> &
    Pick<Repository, 'last_seen_tag'> & {
        repo: string;
        confirmed: boolean;
    };

export type ConfirmedSubscriber = Pick<User, 'email'> & Pick<Subscription, 'unsubscribe_token'>;
