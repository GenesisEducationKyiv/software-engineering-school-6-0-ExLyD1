import pg from 'pg';

// The notification-service owns its OWN database (database-per-service). It never
// touches the monolith's DB — that separation is what makes it a real saga
// participant rather than a distributed monolith.
export type Db = pg.Pool;

export const createDb = (connectionString: string): Db => new pg.Pool({ connectionString });

export const initDb = async (db: Db): Promise<void> => {
    await db.query(`
        CREATE TABLE IF NOT EXISTS notifications (
            id          SERIAL PRIMARY KEY,
            saga_id     TEXT UNIQUE,
            type        TEXT NOT NULL,
            recipient   TEXT NOT NULL,
            status      TEXT NOT NULL,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        );
    `);
};
