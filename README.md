# GitHub Release Notifier

Subscribe to GitHub repositories and receive an email whenever a new release is published.

## How It Works

1. A user submits their email and a GitHub repository (`owner/repo`) via the web UI or `POST /api/subscribe`
2. The app validates the repository against the GitHub API and stores the subscription
3. A confirmation email is sent — the subscription is only active after the user clicks the link
4. A background scanner polls GitHub on a configurable interval; when a new release tag is detected, all confirmed subscribers receive a notification email with an unsubscribe link

## Tech Stack

- **Runtime:** Node.js 22, TypeScript (ESM)
- **Framework:** Fastify 5
- **Database:** PostgreSQL (via `@fastify/postgres`)
- **Email:** Resend API
- **Rate limiting:** `@fastify/rate-limit` (5 requests per 15 minutes on `/api/subscribe`)
- **Tests:** Vitest
- **Containerisation:** Docker + Docker Compose

## Prerequisites

- Node.js 22 or higher
- Docker and Docker Compose v2 (for the Docker workflow)
- A [Resend](https://resend.com) account for email delivery

## Environment Setup

> **Note on credentials:** I am aware that real API keys are committed in `.env.example`. This was done intentionally for the Genesis evaluation so that reviewers can run the project without creating their own accounts. In a real project, `.env` would never be committed.

The `.env.example` file already contains working credentials — just copy it:

```bash
cp .env.example .env
```

| Variable              | Required    | Description                                                          |
| --------------------- | ----------- | -------------------------------------------------------------------- |
| `DATABASE_URL`        | Yes         | PostgreSQL connection string                                         |
| `POSTGRES_USER`       | Docker only | PostgreSQL username for the bundled container                        |
| `POSTGRES_PASSWORD`   | Docker only | PostgreSQL password for the bundled container                        |
| `POSTGRES_DB`         | Docker only | PostgreSQL database name for the bundled container                   |
| `GITHUB_TOKEN`        | No          | GitHub personal access token — raises rate limit from 60 to 5 000 req/h |
| `GITHUB_BASE_URL`     | Yes         | GitHub REST API base URL (`https://api.github.com`)                  |
| `RESEND_API_KEY`      | Yes         | Resend API key (starts with `re_…`)                                  |
| `SMTP_FROM`           | Yes         | From address shown in outgoing emails                                |
| `BASE_URL`            | Yes         | Public URL of the app used in email links (no trailing slash)        |
| `PORT`                | No          | HTTP port the server listens on (default: `3000`)                    |
| `SCANNER_INTERVAL_MS` | Yes         | Release scan interval in milliseconds (e.g. `300000` for 5 minutes)  |
| `API_KEY`             | Yes         | Secret key required in the `x-api-key` header for protected routes  |

> **Docker note:** When running with Docker Compose, `DATABASE_URL` is automatically overridden to point to the bundled PostgreSQL container.

## Running with Docker (recommended)

```bash
docker compose up --build
```

The app will be available at [http://localhost:3000](http://localhost:3000).

- Migrations run automatically on startup
- To stop: `docker compose down`
- To also wipe the database volume: `docker compose down -v`

## Running Locally (without Docker)

```bash
# 1. Install dependencies
npm install

# 2. Ensure a local PostgreSQL instance is running and DATABASE_URL in .env is correct

# 3. Start the dev server (ts-node + nodemon, auto-restarts on file changes)
npm run dev
```

To build and run the compiled output:

```bash
npm run build   # compiles TypeScript → dist/
npm start       # runs dist/app.js
```

## Observability

Structured JSON logs are shipped to Elasticsearch via the Docker `gelf` driver and
Logstash, and explored in Kibana. `docker compose up` also starts Elasticsearch
(`:9200`), Kibana (`:5601`), and Logstash (gelf `udp:12201`).

- Logs are written by pino, correlated per request via `requestId`, and tagged
  `component: api | scanner`. Verbosity is controlled by `LOG_LEVEL`.
- The Kibana data view and dashboard are reproducible from
  [`config/kibana/dashboard.ndjson`](config/kibana/dashboard.ndjson).
- RED metrics (`prom-client`) are exposed at `/metrics`, scraped by Prometheus
  (`:9090`), and visualized in an auto-provisioned Grafana dashboard
  (`:3001`, admin/admin).

See [`docs/observability.md`](docs/observability.md) for the full pipeline, field
reference, and the dashboard import command.

> On macOS, use `127.0.0.1` (not `localhost`) for Docker-published ports.

## Tests

```bash
npm test            # run once
npm run test:watch  # watch mode
```

## API

All protected routes require the `x-api-key` header matching the `API_KEY` env var.

| Method | Path                        | Auth | Description                                  |
| ------ | --------------------------- | ---- | -------------------------------------------- |
| POST   | `/api/subscribe`            | No   | Subscribe an email to a GitHub repo          |
| GET    | `/api/confirm/:token`       | No   | Confirm a subscription via emailed token     |
| GET    | `/api/unsubscribe/:token`   | No   | Unsubscribe via token from notification email |
| GET    | `/api/subscriptions?email=` | No   | List all subscriptions for an email          |
| GET    | `/health`                   | No   | Health check (queries the database)          |

See [`swagger.yaml`](swagger.yaml) for the full OpenAPI spec.

### Rate limiting

`POST /api/subscribe` is limited to **5 requests per 15 minutes** per IP. Exceeding this returns `429 Too Many Requests`.

## Project Structure

```
src/
  app.ts                          — entry point: plugin registration and startup
  clients/
    github.ts                     — GitHub REST API HTTP client
    mailer.ts                     — Resend email client
  controllers/
    subscription.ts               — route handlers (subscribe, confirm, unsubscribe, list)
    health.ts                     — GET /health route handler
  services/
    scanner.ts                    — background release scanner
    subscription.ts               — subscription business logic (transaction, callbacks)
  repositories/
    subscription.repository.ts    — subscription DB queries
    scanner.repository.ts         — scanner DB queries
  errors/
    github.ts                     — GitHubApiError, InvalidRepoFormatError
    subscription.ts               — AlreadySubscribedError
  plugins/
    auth.ts                       — API key auth middleware (preHandler hook)
    db.ts                         — @fastify/postgres registration
    github.ts                     — GitHub client plugin (fastify.github)
    mailer.ts                     — Resend mailer plugin (fastify.mailer)
  constants/
    regex.ts                      — shared validation regexes (email, repo, UUID)
  types/                          — shared TypeScript interfaces
  database/
    migrate.ts                    — migration runner (runs automatically on startup)
    migrations/                   — ordered SQL migration files
public/
  index.html                      — minimal web UI
swagger.yaml                      — OpenAPI spec
docker-compose.yml                — app + PostgreSQL container setup
```
