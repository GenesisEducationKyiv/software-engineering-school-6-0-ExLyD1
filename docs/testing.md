# Testing Guide — GitHub Release Notifier

## Quick start (all tests)

```bash
npm run test:all
```

This runs unit → integration → E2E in sequence.

---

## Test types

### Unit tests

Fast, no database, no network — pure logic.

```bash
npm run test:unit          # run once
npm run test:unit:watch    # watch mode
```

**Coverage:**
```bash
npm run test:coverage
```

---

### Integration tests

Real PostgreSQL in Docker, MSW intercepts GitHub API, mailer is injected as a mock.

**Prerequisite:** Docker must be running.

```bash
npm run test:integration   # starts DB, runs tests, stops DB
```

**CI-only (DB already running):**
```bash
TEST_DB_URL=postgres://test:test@localhost:5433/github_notifier_test \
GITHUB_BASE_URL=https://api.github.com \
API_KEY=test-api-key \
BASE_URL=http://localhost:3000 \
RESEND_API_KEY=test \
SMTP_FROM=test@example.com \
SCANNER_INTERVAL_MS=9999999 \
npm run test:integration:ci
```

**Test database:** `postgres://test:test@localhost:5433/github_notifier_test`  
Port 5433 avoids conflict with a dev DB on 5432.

---

### E2E tests (Playwright)

Full browser tests against a running app instance.

**Prerequisites:**
1. Build the app: `npm run build`
2. Start a real PostgreSQL and run migrations
3. Start the app: `node dist/app.js`
4. Chromium browser installed: `npx playwright install chromium`

**Run:**
```bash
npm run test:e2e
```

**Headed (watch browser):**
```bash
npx playwright test --headed
```

**Single spec:**
```bash
npx playwright test test/e2e/validation.spec.ts
```

---

## CI pipelines

| Pipeline | File | Trigger | What runs |
|---|---|---|---|
| Lint | `.github/workflows/ci.yml` | push/PR to main | `eslint src` |
| Unit | `.github/workflows/unit.yml` | push/PR to main | `vitest run` |
| Integration | `.github/workflows/integration.yml` | push/PR to main | Docker Postgres + integration tests |
| E2E | `.github/workflows/e2e.yml` | push/PR to main | Playwright against built app |

---

## Architecture decisions

### GitHub API mocking (integration)
Uses `msw` v2 (`msw/node`). Default handlers return `{ tag_name: 'v1.0.0' }`. Per-test overrides via `server.use(handler)` for 404/429 scenarios. MSW is started in `setupFiles` so the same server instance is shared with test files.

### Mailer mocking
A `vi.fn()` mailer is injected into the test Fastify instance via `buildTestApp({ mailerOverride })`. No real Resend/SMTP calls are made in any test.

### Database isolation (integration)
`TRUNCATE users, repositories, subscriptions RESTART IDENTITY CASCADE` in `beforeEach`. Migrations run once per `beforeAll` via `app.ready()` (they are idempotent).

### Sequential execution (integration)
`fileParallelism: false, maxWorkers: 1` in `vitest.config.integration.ts`. All test files share one DB, so concurrent truncations would deadlock.

### No rate limit plugin in tests
`@fastify/rate-limit` is not registered in `buildTestApp`. Route-level `config.rateLimit` options are ignored harmlessly by Fastify.

### No scanner in tests
`startScanner()` is not called in `buildTestApp`. The scanner's `setInterval` would fire during tests and cause unexpected DB writes.
