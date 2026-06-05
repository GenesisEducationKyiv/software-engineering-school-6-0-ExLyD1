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
