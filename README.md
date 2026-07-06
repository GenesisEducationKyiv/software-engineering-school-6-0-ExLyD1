# GitHub Release Notifier

Subscribe to GitHub repositories and receive an email whenever a new release is published.

## How It Works

1. A user submits their email and a GitHub repository (`owner/repo`) via the web UI or `POST /api/subscribe`
2. The app validates the repository against the GitHub API and stores the subscription
3. The API publishes an email command to RabbitMQ; the standalone **notification-service** consumes it and sends a confirmation email — the subscription is only active after the user clicks the link
4. A background scanner polls GitHub on a configurable interval; when a new release tag is detected, the `subscriptions` module looks up confirmed subscribers and publishes one notification command per subscriber, which the notification-service delivers (with an unsubscribe link)

### Architecture

This is a **modular monolith** (domains: `subscriptions`, `scanner`, `shared`) plus one extracted **microservice** (`notification-service`). The monolith never sends email itself — it publishes `SendEmail` commands to **RabbitMQ**, and the notification-service consumes them and calls Resend. See [`docs/ADR/ADR-002.md`](docs/ADR/ADR-002.md) for the full rationale.

## Tech Stack

- **Runtime:** Node.js 22, TypeScript (ESM)
- **Framework:** Fastify 5
- **Database:** PostgreSQL (via `@fastify/postgres`)
- **Email:** Resend API (sent by the `notification-service`, not the monolith)
- **Message broker:** RabbitMQ (`amqplib`) — carries `SendEmail` commands from the API to the notification-service
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
| `RABBITMQ_URL`        | Yes         | RabbitMQ connection URL (e.g. `amqp://localhost:5672`). The API publishes commands here; the notification-service consumes them |
| `RESEND_API_KEY`      | Yes         | Resend API key (starts with `re_…`) — used by the **notification-service**          |
| `SMTP_FROM`           | Yes         | From address shown in outgoing emails — used by the **notification-service**        |
| `BASE_URL`            | Yes         | Public URL used in email links (no trailing slash) — used by the **notification-service** |
| `PORT`                | No          | HTTP port the server listens on (default: `3000`)                    |
| `SCANNER_INTERVAL_MS` | Yes         | Release scan interval in milliseconds (e.g. `300000` for 5 minutes)  |
| `API_KEY`             | Yes         | Secret key required in the `x-api-key` header for protected routes  |

> **Docker note:** When running with Docker Compose, `DATABASE_URL` is automatically overridden to point to the bundled PostgreSQL container.

## Running with Docker (recommended)

```bash
docker compose up --build
```

The app will be available at [http://localhost:3000](http://localhost:3000).

One command also starts **RabbitMQ** (management UI at [http://localhost:15672](http://localhost:15672)) and the **notification-service**.

- Migrations run automatically on startup
- To stop: `docker compose down`
- To also wipe the database/broker volumes: `docker compose down -v`

## Running Locally (without Docker)

```bash
# 1. Install dependencies
npm install

# 2. Ensure local PostgreSQL and RabbitMQ are running, and DATABASE_URL / RABBITMQ_URL in .env are correct
#    (or set MAILER_MODE=stub to run the API without RabbitMQ — no email commands are published)

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

- Logs are written by pino as structured JSON, correlated per request via `requestId`,
  and tagged `component: api | scanner | notification`. The notification-service ships
  the same structured logs to the same pipeline. Verbosity is controlled by `LOG_LEVEL`.
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
  app.ts                                — composition root: wires plugins, scanner, and the onRelease handler
  modules/
    subscriptions/                      — core domain (owns users/repositories/subscriptions)
      subscription.controller.ts        — routes: subscribe, confirm, unsubscribe, list
      subscription.service.ts           — subscription lifecycle (transaction)
      subscription.repository.ts        — subscription DB queries
      subscription.notifications.ts     — on a release: look up subscribers → publish email commands
      subscription.errors.ts            — AlreadySubscribedError
      subscription.types.ts
    scanner/                            — release-watching (detect new tags)
      scanner.service.ts                — scan cycle; emits releases via an injected handler
      scanner.repository.ts             — watched repos + last_seen_tag
      scanner.constants.ts · scanner.types.ts
    shared/                             — cross-cutting / infrastructure
      github/    — GitHub REST client (ACL), plugin, errors, types
      mailer/    — mailer interface + RabbitMQ publisher (fastify.mailer)
      messaging/ — RabbitMQ connection + email-command contract
      db/ · config/ · auth/ · metrics/ · health/ · constants/
  database/
    migrate.ts                          — migration runner (runs automatically on startup)
    migrations/                         — ordered SQL migration files

notification-service/                   — extracted microservice (separate deploy, no DB)
  src/
    index.ts                            — RabbitMQ consumer → render template → send via Resend
    handler.ts · mailer.ts · rabbit.ts · contract.ts · config.ts · logger.ts
    templates/                          — confirmation + release email templates
  Dockerfile · package.json

public/index.html                       — minimal web UI
swagger.yaml                            — OpenAPI spec
docs/ADR-002.md                         — architecture decision (modular monolith + microservice)
docker-compose.yml                      — app + notification + postgres + rabbitmq + ELK + Prometheus/Grafana
```
