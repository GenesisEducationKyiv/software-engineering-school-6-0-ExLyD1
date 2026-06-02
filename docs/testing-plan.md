# Testing Implementation Plan — GitHub Release Notifier

## Context

The project is a **GitHub Release Notifier** (Fastify 5 + TypeScript ESM + PostgreSQL + Resend).
Users subscribe to repos via a single HTML page; a background scanner checks for new GitHub releases
and emails confirmed subscribers. The homework requires: integration tests for all API endpoints,
unit tests for all complex business logic, E2E tests with Playwright, separate CI pipelines per test
type, and a `testing.md` guide. The machine constraint (only git, docker, Node.js available) means
integration tests must auto-start their DB from Docker.

---

## Project Audit Summary

| Area | Current State | Gap |
|---|---|---|
| Unit tests | 6 files, ~50 tests — clients, services, constants, 3 controller cases | Repositories untested, auth plugin untested, config validation untested, controller edge cases missing |
| Integration tests | None | All 5 API endpoints need coverage |
| E2E tests | None | Single HTML page needs Playwright coverage |
| CI | 1 pipeline: lint + `npm test` (unit only) | Need 3 separate pipelines |
| Docker | `docker-compose.yml` for prod (app + postgres) | Need `docker-compose.test.yml` for isolated test postgres |
| Coverage reporting | Vitest installed, no `@vitest/coverage-v8` | Need coverage provider |

---

## Architecture Decisions (Rationale Included)

### GitHub API mocking
**Decision:** Use `msw` v2 (`msw/node`) for integration tests — it intercepts `fetch` at the network
layer without changing `GITHUB_BASE_URL`. Unit tests continue using `vi.stubGlobal('fetch')` as they
already do.

**Why not a local Express mock server:** Adds operational complexity (port management, startup
ordering). MSW v2 is ESM-compatible, resets per-test, and zero infrastructure overhead.

### Mailer mocking
**Decision:** Always inject a `vi.fn()` mock mailer into the test app factory. Never instantiate a
real Resend SDK in any test.

**Why:** There is no URL override for Resend. MSW interception of `api.resend.com` is fragile.
The codebase already demonstrates this pattern in `src/controllers/_tests/subscription.test.ts`.

### Database strategy
**Decision:** Real PostgreSQL in Docker for integration/E2E tests. `TRUNCATE users, repositories,
subscriptions RESTART IDENTITY CASCADE` in `beforeEach` for integration tests.

**Why not transaction rollback:** `@fastify/postgres` uses a connection pool; queries may use
different connections, making rollback-based isolation unreliable.

### Rate limiting in tests
**Decision:** Do NOT register `@fastify/rate-limit` in the test app factory.

**Why:** The rate limit is a Fastify plugin registered globally. Omitting its registration means
route-level `config.rateLimit` properties are ignored harmlessly. No production code changes needed.

### Scanner not started in tests
**Decision:** The test app factory must NOT call `startScanner()`.

**Why:** The scanner runs as `setInterval` and would fire during tests causing unexpected DB writes
and flaky test failures.

---

## Packages to Install

```bash
npm install --save-dev @vitest/coverage-v8 msw @playwright/test wait-on
```

- `@vitest/coverage-v8` — V8 native coverage, zero config with Vitest 4
- `msw@^2` — ESM-compatible network interception for integration tests
- `@playwright/test@^1.49` — E2E browser testing
- `wait-on` — used in E2E CI pipeline to wait for app startup

---

## File Structure to Create

```
/
├── vitest.config.ts                               # existing — keep (unit tests)
├── vitest.config.integration.ts                   # NEW
├── vitest.config.coverage.ts                      # NEW
├── playwright.config.ts                           # NEW
├── docker-compose.test.yml                        # NEW
├── testing.md                                     # NEW
│
├── src/
│   ├── config.test.ts                             # NEW — config validation
│   ├── repositories/_tests/                       # NEW DIRECTORY
│   │   ├── subscription.repository.test.ts        # NEW
│   │   └── scanner.repository.test.ts             # NEW
│   ├── plugins/_tests/                            # NEW DIRECTORY
│   │   └── auth.test.ts                           # NEW
│   ├── controllers/_tests/
│   │   └── subscription.test.ts                   # EXPAND existing (add ~15 cases)
│   └── services/_tests/
│       └── scanner.chunking.test.ts               # NEW — chunk behavior
│
├── test/
│   ├── integration/
│   │   ├── helpers/
│   │   │   ├── app.factory.ts                     # NEW — keystone file
│   │   │   ├── db.helpers.ts                      # NEW — truncate + seed
│   │   │   ├── github.handlers.ts                 # NEW — msw request handlers
│   │   │   ├── global-setup.ts                    # NEW — msw server lifecycle
│   │   │   └── setup.ts                           # NEW — per-file msw reset
│   │   ├── health.test.ts                         # NEW
│   │   ├── subscribe.test.ts                      # NEW
│   │   ├── confirm.test.ts                        # NEW
│   │   ├── unsubscribe.test.ts                    # NEW
│   │   └── subscriptions.test.ts                  # NEW
│   │
│   └── e2e/
│       ├── fixtures/
│       │   └── app.fixture.ts                     # NEW — Playwright fixtures
│       ├── validation.spec.ts                     # NEW — client-side validation
│       ├── subscribe.spec.ts                      # NEW — subscribe flow
│       └── lookup.spec.ts                         # NEW — subscriptions lookup
│
└── .github/workflows/
    ├── ci.yml                                     # REPLACE — lint only
    ├── unit.yml                                   # NEW
    ├── integration.yml                            # NEW
    └── e2e.yml                                    # NEW
```

---

## Phase A — Foundation (do first, everything depends on this)

**Goal:** Get one integration test working end-to-end, validating the full infra stack.

### Steps

1. **Install packages:**
   ```bash
   npm install --save-dev @vitest/coverage-v8 msw @playwright/test wait-on
   npx playwright install chromium
   ```

2. **Create `docker-compose.test.yml`:**
   ```yaml
   services:
     postgres-test:
       image: postgres:16-alpine
       environment:
         POSTGRES_USER: test
         POSTGRES_PASSWORD: test
         POSTGRES_DB: github_notifier_test
       ports:
         - '5433:5432'
       healthcheck:
         test: ['CMD-SHELL', 'pg_isready -U test -d github_notifier_test']
         interval: 3s
         timeout: 3s
         retries: 10
         start_period: 5s
       tmpfs:
         - /var/lib/postgresql/data   # in-memory: fast, auto-cleaned
   ```
   Key: `tmpfs` so no volume cleanup is needed; port `5433` avoids conflict with dev DB.

3. **Create `test/integration/helpers/app.factory.ts`:**

   Builds a full Fastify instance with real DB plugin, injected mock mailer, real or mock GitHub
   client, auth plugin, subscription routes, health routes. Does NOT register:
   - `@fastify/rate-limit` (disables rate limiting)
   - `@fastify/static` (not needed in API tests)
   - `startScanner()` (no background timer)

   Wires `runMigrations` to `onReady` (migrations are idempotent — safe to run on each `beforeAll`).

   Signature:
   ```typescript
   export async function buildTestApp(options?: {
     mailerOverride?: { sendConfirmationEmail: vi.Mock; sendReleaseNotification: vi.Mock };
     githubOverride?: GitHubClient;
     apiKey?: string;
   }): Promise<FastifyInstance>
   ```

   Uses `TEST_DB_URL` env var for connection string.

4. **Create `test/integration/helpers/db.helpers.ts`:**
   ```typescript
   export async function truncateAllTables(db: PostgresDb): Promise<void>
   export async function seedSubscription(db, opts): Promise<{ confirmToken, unsubscribeToken }>
   export async function getSubscriptionRow(db, email, repo): Promise<SubscriptionRow | null>
   ```

5. **Create `test/integration/helpers/github.handlers.ts`:**
   ```typescript
   import { http, HttpResponse } from 'msw';
   // Default handler: returns { tag_name: 'v1.0.0', name: 'Release v1.0.0' }
   // Named exports for 404, 429, 500 handlers to be used with server.use(...)
   export const githubDefaultHandlers = [...]
   export const github404Handler = http.get(...)
   export const github429Handler = http.get(...)
   ```

6. **Create `test/integration/helpers/global-setup.ts`:**
   ```typescript
   // setupServer() from msw/node — starts once for entire integration run
   export async function setup() { server.listen({ onUnhandledRequest: 'error' }); }
   export async function teardown() { server.close(); }
   ```

7. **Create `vitest.config.integration.ts`:**
   ```typescript
   export default defineConfig({
     test: {
       globals: true,
       environment: 'node',
       include: ['test/integration/**/*.test.ts'],
       globalSetup: './test/integration/helpers/global-setup.ts',
       setupFiles: ['./test/integration/helpers/setup.ts'],
       pool: 'forks',
       poolOptions: { forks: { singleFork: true } },  // sequential, shared DB
       testTimeout: 30000,
       hookTimeout: 10000,
     },
   });
   ```

8. **Add npm scripts to `package.json`:**
   ```json
   {
     "test:unit": "vitest run",
     "test:unit:watch": "vitest",
     "test:integration": "docker compose -f docker-compose.test.yml up -d --wait && npm run test:integration:ci; docker compose -f docker-compose.test.yml down",
     "test:integration:ci": "vitest run --config vitest.config.integration.ts",
     "test:e2e": "playwright test",
     "test:coverage": "vitest run --coverage --config vitest.config.coverage.ts",
     "test:all": "npm run test:unit && npm run test:integration && npm run test:e2e"
   }
   ```

9. **Smoke test:** Write `test/integration/health.test.ts` with one test (`GET /health` → 200).
   Run `npm run test:integration` and verify it passes.

**Expected result:** One integration test passes against a real Dockerized PostgreSQL.

**Risk:** MSW + ESM compatibility — verify `import { http, HttpResponse } from 'msw'` and
`import { setupServer } from 'msw/node'` work with `"moduleResolution": "NodeNext"`.

---

## Phase B — Unit Test Gap-Filling (parallel with Phase A)

**Goal:** Cover all business logic not yet tested.

### B1 — `src/repositories/_tests/subscription.repository.test.ts`
Mock pattern: pure `vi.fn()` returning `{ rows, rowCount }`. No real DB.
Tests (20 total):
- `upsertUser`: executes two queries (INSERT + SELECT), returns id from rows
- `upsertRepository`: same pattern with `lastSeenTag` param
- `insertSubscription`: resolves on success; throws `AlreadySubscribedError` on PG code `'23505'`;
  re-throws unknown errors
- `confirmSubscription`: returns `true` when `rowCount === 1`, `false` otherwise
- `deleteSubscription`: same
- `getSubscriptionsByEmail`: returns `result.rows`, passes email as `$1`

### B2 — `src/repositories/_tests/scanner.repository.test.ts`
Tests (7 total):
- `getWatchedRepos`: returns rows; SQL contains `confirmed = true`
- `getConfirmedSubscribers`: returns rows; passes `repoId` as `$1`; returns empty on no rows
- `updateLastSeenTag`: calls query with tag as `$1`, repoId as `$2`; returns void

### B3 — `src/plugins/_tests/auth.test.ts`
Build minimal Fastify app with auth plugin + one protected route + public routes.
Tests (8 total):
- Returns 401 when `x-api-key` missing on `/api/protected`
- Returns 401 when wrong API key value
- Returns 200 when correct API key
- Allows `/api/subscriptions` without key
- Allows `/api/confirm/any-token` without key (prefix match)
- Allows `/api/unsubscribe/any-token` without key
- Allows `/health` without key
- Allows `/` without key

### B4 — `src/config.test.ts`
Use `vi.stubEnv` per test, `vi.unstubAllEnvs()` in `afterEach`.
Tests (10 total):
- Returns full `AppConfig` when all required vars present
- Throws mentioning variable name for each of: `DATABASE_URL`, `GITHUB_BASE_URL`,
  `RESEND_API_KEY`, `SMTP_FROM`, `BASE_URL`, `API_KEY`, `SCANNER_INTERVAL_MS`
- Does NOT throw when `GITHUB_TOKEN` missing
- `githubToken` is `undefined` when `GITHUB_TOKEN` unset
- `port` defaults to 3000 when `PORT` unset
- Throws when `SCANNER_INTERVAL_MS` is `'abc'`

### B5 — Expand `src/controllers/_tests/subscription.test.ts`
Add (~15 new tests):
- **POST /api/subscribe:** 400 missing email; 400 invalid email; 400 missing repo;
  400 invalid repo; 200 success (subscribe resolves, mailer called); 429 GitHub rate limit;
  500 generic GitHub error
- **GET /api/confirm/:token:** 400 invalid UUID; 200 token found; 404 token not found; 500 throws
- **GET /api/unsubscribe/:token:** 400 invalid UUID; 200 token found; 404 not found; 500 throws
- **GET /api/subscriptions:** 400 missing email; 400 invalid email; 200 empty array; 200 with rows

### B6 — `src/services/_tests/scanner.chunking.test.ts`
Tests (4 total):
- 10 repos: all processed in one batch (Promise.all called once with 10)
- 11 repos: two batches (10 then 1)
- Rate limit in batch 2: first batch completes, second returns `'rate_limited'`
- Rate limit in batch 1: immediately returns `'rate_limited'`

**Expected result:** All unit test gaps filled. `npm run test:unit` green with high coverage.

---

## Phase C — Integration Tests

**Goal:** Test all 5 API endpoints with real DB, msw GitHub mock, injected mailer mock.

### Pattern for each test file:
```typescript
let app: FastifyInstance;
let mailer: { sendConfirmationEmail: vi.Mock; sendReleaseNotification: vi.Mock };

beforeAll(async () => {
  mailer = { sendConfirmationEmail: vi.fn(), sendReleaseNotification: vi.fn() };
  app = await buildTestApp({ mailerOverride: mailer });
});
afterAll(() => app.close());
beforeEach(async () => {
  await truncateAllTables(app.pg);
  mailer.sendConfirmationEmail.mockClear();
  vi.clearAllMocks();
});
```

### `test/integration/health.test.ts` (3 tests)
1. `GET /health` → 200 `{ status: 'ok' }` when DB connected
2. `GET /health` → 503 when DB unreachable (build app with bad DB URL)
3. Response has `Content-Type: application/json`

### `test/integration/subscribe.test.ts` (11 tests)
Setup: msw default handler returns `{ tag_name: 'v1.0.0' }`.
1. 200: valid email + repo → subscription row in DB + `sendConfirmationEmail` called once
2. 400: missing `email` field
3. 400: missing `repo` field
4. 400: invalid email format
5. 400: invalid repo format (`owner` part starts with `-`)
6. 401: no `x-api-key` header
7. 401: wrong `x-api-key` value
8. 404: GitHub returns 404 for repo (override msw handler per-test)
9. 409: subscribe same email + repo twice (second request returns 409)
10. 429: GitHub returns 429 (override msw handler per-test)
11. 500: DB failure during insert

### `test/integration/confirm.test.ts` (5 tests)
1. 400: token is not UUID format (`/api/confirm/not-a-uuid`)
2. 200: seeded subscription confirmed → row has `confirmed = true` in DB
3. 404: valid UUID not in DB
4. Idempotent: confirming same token twice → 200 both times
5. Response body contains `message` field

### `test/integration/unsubscribe.test.ts` (4 tests)
1. 400: token is not UUID format
2. 200: seeded subscription → row deleted from DB
3. 404: valid UUID not in DB
4. Response body contains `message` field

### `test/integration/subscriptions.test.ts` (6 tests)
1. 400: no `email` query param
2. 400: invalid email format in query param
3. 200: unknown email → `[]`
4. 200: seeded unconfirmed subscription → `confirmed: false`
5. 200: seeded + confirmed subscription → `confirmed: true`
6. Response shape: each item has `email`, `repo`, `confirmed`, `last_seen_tag` fields

**Expected result:** Full API coverage with real DB round-trips.

---

## Phase D — Playwright E2E Tests

**Goal:** Cover the single HTML page (`public/index.html`) user flows.

### `playwright.config.ts`
```typescript
export default defineConfig({
  testDir: './test/e2e',
  timeout: 30000,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['list'], ['html', { outputFolder: 'playwright-report' }]] : 'list',
  use: {
    baseURL: 'http://localhost:3000',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // For local dev, uncomment:
  // webServer: { command: 'node dist/app.js', url: 'http://localhost:3000', reuseExistingServer: true }
});
```

### `test/e2e/validation.spec.ts` — Client-side validation (no API calls needed)
These tests are fast and stable — purely client-side JS validation fires before any fetch.
1. Submit empty subscribe form → email and repo fields show error state
2. Submit with valid email + invalid repo → only repo field shows error
3. Submit with invalid email + valid repo → only email field shows error
4. Correct the email input → email error clears
5. Lookup form with invalid email → shows validation error
6. `GET /` returns 200 and the page renders (smoke test)

### `test/e2e/subscribe.spec.ts` — Subscribe form with real GitHub API
Use `vitest-dev/vitest` as the test repo (guaranteed to have releases).
1. Fill form with valid email + `vitest-dev/vitest` → submit → success message visible
2. Submit same email + repo twice → "already subscribed" message visible
3. Submit with non-existent repo → "not found" or "no releases" message visible
4. Network error scenario → error message visible

**Anti-flake:** Always `waitForSelector`; never `page.waitForTimeout()`. CI `retries: 2`.

### `test/e2e/lookup.spec.ts` — Subscriptions lookup
Seed data via direct API call using `API_KEY` in test setup.
1. Lookup unknown email → "No subscriptions found" text visible
2. Lookup email with seeded pending subscription → "Pending confirmation" badge visible
3. Lookup email with seeded confirmed subscription → "Confirmed" badge visible

---

## Phase E — CI Pipelines

### `.github/workflows/ci.yml` (replace existing — lint only)
```yaml
name: Lint
on:
  push: { branches: [main] }
  pull_request: { branches: [main] }
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: 'npm' }
      - run: npm ci
      - run: npm run lint
```
Estimated runtime: ~60s.

### `.github/workflows/unit.yml`
```yaml
name: Unit Tests
on:
  push: { branches: [main] }
  pull_request: { branches: [main] }
jobs:
  unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: 'npm' }
      - run: npm ci
      - run: npm run test:unit
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: coverage-unit
          path: coverage/
```
No Docker, no DB, no secrets. Estimated runtime: ~90s.

### `.github/workflows/integration.yml`
```yaml
name: Integration Tests
on:
  push: { branches: [main] }
  pull_request: { branches: [main] }
jobs:
  integration:
    runs-on: ubuntu-latest
    env:
      TEST_DB_URL: postgres://test:test@localhost:5433/github_notifier_test
      API_KEY: test-api-key
      BASE_URL: http://localhost:3000
      GITHUB_BASE_URL: https://api.github.com
      RESEND_API_KEY: test-resend-key
      SMTP_FROM: test@example.com
      SCANNER_INTERVAL_MS: '9999999'
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: 'npm' }
      - run: npm ci
      - name: Start test Postgres
        run: docker compose -f docker-compose.test.yml up -d --wait
      - name: Run integration tests
        run: npm run test:integration:ci
      - name: Stop test Postgres
        if: always()
        run: docker compose -f docker-compose.test.yml down
```
No secrets needed (mailer mocked, GitHub mocked via msw). Estimated runtime: ~2min.

### `.github/workflows/e2e.yml`
```yaml
name: E2E Tests
on:
  push: { branches: [main] }
  pull_request: { branches: [main] }
jobs:
  e2e:
    runs-on: ubuntu-latest
    env:
      DATABASE_URL: postgres://test:test@localhost:5432/github_notifier_test
      API_KEY: test-api-key
      BASE_URL: http://localhost:3000
      GITHUB_BASE_URL: https://api.github.com
      GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      RESEND_API_KEY: test-resend-key
      SMTP_FROM: test@example.com
      SCANNER_INTERVAL_MS: '9999999'
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
          POSTGRES_DB: github_notifier_test
        options: >-
          --health-cmd "pg_isready -U test"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 5432:5432
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: 'npm' }
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm run build
      - name: Start app
        run: node dist/app.js &
      - name: Wait for app ready
        run: npx wait-on http://localhost:3000/health --timeout 30000
      - run: npm run test:e2e
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: playwright-report/
```
Estimated runtime: ~4min.

---

## Phase F — Coverage Config

### `vitest.config.coverage.ts`
```typescript
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/types/**', 'src/database/migrations/**'],
      thresholds: { lines: 80, functions: 80, branches: 75, statements: 80 },
    },
  },
});
```

---

## Risk Analysis

| Risk | Likelihood | Mitigation |
|---|---|---|
| MSW v2 + `NodeNext` module resolution incompatibility | Medium | Test early in Phase A; MSW v2 ships proper ESM exports |
| `app.ready()` + `onReady` migration hook runs on every `beforeAll` | Low | Migrations are idempotent; no side effect |
| `singleFork: true` means one integration file failure blocks the rest | Low | Each file has independent `app` instance; failures are isolated |
| E2E subscribe test hits real GitHub 60-req/hour limit | Medium | Use `GITHUB_TOKEN` in e2e.yml; limit to 2–3 GitHub calls per CI run |
| `docker compose up --wait` not on older Compose | Low | `ubuntu-latest` ships Compose V2; document minimum version |
| E2E Playwright flake from timing | Medium | Always `waitForSelector`, never `waitForTimeout`; `retries: 2` in CI |

---

## Implementation Order

| Priority | Phase | Dependency |
|---|---|---|
| 1 (blocker) | A — Foundation (factory, docker-compose.test.yml, msw, vitest integration config) | none |
| 2 (parallel) | B — Unit gap-filling (repositories, auth, config, controller expansion) | none |
| 3 | C — Integration tests (5 files) | Phase A complete |
| 4 | D — E2E tests (Playwright) | Phase A infra available |
| 5 | E — CI pipelines | Phases B+C working locally |
| 6 | F — Coverage config + testing.md | all above complete |

---

## Final Checklist

- [ ] `docker-compose.test.yml` created with tmpfs postgres on port 5433
- [ ] `test/integration/helpers/app.factory.ts` created (no rate limit, no scanner, injected mailer)
- [ ] `test/integration/helpers/db.helpers.ts` created (truncate + seed)
- [ ] `test/integration/helpers/github.handlers.ts` created (msw handlers)
- [ ] `vitest.config.integration.ts` created (singleFork, 30s timeout)
- [ ] `vitest.config.coverage.ts` created (v8 provider, 80% thresholds)
- [ ] Integration tests: health, subscribe, confirm, unsubscribe, subscriptions (5 files, ~30 tests)
- [ ] Unit gaps filled: repositories (2 files), auth plugin, config, controller edge cases, scanner chunking
- [ ] `playwright.config.ts` created (chromium only)
- [ ] E2E tests: validation, subscribe flow, lookup (3 files, ~15 tests)
- [ ] `ci.yml` replaced (lint only)
- [ ] `unit.yml` created
- [ ] `integration.yml` created
- [ ] `e2e.yml` created
- [ ] `package.json` scripts updated
- [ ] `testing.md` created with one-command execution + per-type commands
- [ ] All existing unit tests still pass after changes

---

## Critical Files to Reference During Implementation

- [src/app.ts](../src/app.ts) — blueprint for test factory (which plugins to include/exclude)
- [src/controllers/subscription.ts](../src/controllers/subscription.ts) — every branch needs an integration test
- [src/repositories/subscription.repository.ts](../src/repositories/subscription.repository.ts) — needs unit tests for all 6 functions
- [src/plugins/auth.ts](../src/plugins/auth.ts) — needs dedicated unit tests
- [src/config.ts](../src/config.ts) — needs validation tests
- [vitest.config.ts](../vitest.config.ts) — base config to mirror in integration config
- [docker-compose.yml](../docker-compose.yml) — template for `docker-compose.test.yml` postgres service
- [src/controllers/_tests/subscription.test.ts](../src/controllers/_tests/subscription.test.ts) — pattern to follow for `buildTestApp` factory usage