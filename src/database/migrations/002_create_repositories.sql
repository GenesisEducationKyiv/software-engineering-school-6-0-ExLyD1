CREATE TABLE IF NOT EXISTS repositories (
    id SERIAL PRIMARY KEY,
    owner_repo TEXT NOT NULL UNIQUE,
    last_seen_tag TEXT NULL
)