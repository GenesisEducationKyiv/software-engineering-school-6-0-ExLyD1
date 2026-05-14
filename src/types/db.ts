export interface User {
    id: number;
    email: string;
}

export interface Repository {
    id: number;
    owner_repo: string;
    last_seen_tag: string | null;
}

export interface Subscription {
    id: number;
    user_id: number;
    repository_id: number;
    confirmed: boolean;
    confirm_token: string;
    unsubscribe_token: string;
}

export type SubscriptionRow = Pick<User, 'email'> &
    Pick<Repository, 'last_seen_tag'> & {
        repo: string;
        confirmed: boolean;
    };

export type WatchedRepo = Pick<Repository, 'id' | 'owner_repo' | 'last_seen_tag'>;

export type ScannerSubscriberRow = Pick<User, 'email'> & Pick<Subscription, 'unsubscribe_token'>;

export type QueryRunner = {
    query: <T = unknown>(
        sql: string,
        params?: unknown[],
    ) => Promise<{ rows: T[]; rowCount: number | null }>;
};

export type PoolClient = QueryRunner & {
    release: () => void;
};

export type DbPool = QueryRunner & {
    connect: () => Promise<PoolClient>;
};
