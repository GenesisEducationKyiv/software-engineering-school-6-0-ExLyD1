CREATE TABLE outbox (
    id         SERIAL PRIMARY KEY,
    queue      TEXT NOT NULL,
    payload    JSONB NOT NULL,
    published  BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_outbox_unpublished ON outbox (id) WHERE published = false;
