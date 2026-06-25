CREATE TABLE saga (
    id            TEXT PRIMARY KEY,
    type          TEXT NOT NULL,
    status        TEXT NOT NULL,
    email         TEXT NOT NULL,
    confirm_token TEXT NOT NULL,
    attempts      INTEGER NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
