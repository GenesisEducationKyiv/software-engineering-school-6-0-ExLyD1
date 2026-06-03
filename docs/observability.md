# Observability

## Structured Logging → Elasticsearch → Kibana

The application writes structured JSON logs to stdout. Docker's `gelf` log driver
ships each line to Logstash, which parses and normalizes the record and stores it
in Elasticsearch. Kibana is used for search, aggregation, and dashboards.

```
app (Fastify + pino, JSON → stdout)
  → Docker gelf log driver (udp 127.0.0.1:12201)
  → Logstash      (parse JSON, normalize fields, set @timestamp)
  → Elasticsearch (index github-release-notifier-logs-YYYY.MM.dd)
  → Kibana        (Discover + dashboards)
```

### Run

```bash
docker compose up -d --build
```

Services (use `127.0.0.1`, not `localhost` — see note):

- App: http://127.0.0.1:3000
- Elasticsearch: http://127.0.0.1:9200
- Kibana: http://127.0.0.1:5601
- Logstash GELF input: `udp://127.0.0.1:12201`

> **macOS note:** `localhost` resolves to IPv6 `::1`, but published Docker ports
> (and the gelf endpoint) are IPv4. Always use `127.0.0.1`. This is why
> `gelf-address` is `udp://127.0.0.1:12201` in `docker-compose.yml`.

> **gelf note:** with the gelf log driver, `docker compose logs app` is empty —
> the app's logs go only to Logstash. To debug the app locally, temporarily
> remove the `logging:` block from the `app` service.

### Log verbosity

`LOG_LEVEL` env var: `trace | debug | info | warn | error | fatal | silent`
(default `info`). Validated at startup.

### How logs are produced (the app)

- **pino** (built into Fastify), one JSON object per line to stdout.
- **Allowlist** request serializer: only `method`, `url`, `userAgent`,
  `remoteAddress` are logged. Request headers (`x-api-key`, `authorization`,
  `cookie`) never reach the logs.
- **requestId**: a UUID per request (`genReqId`) that correlates every line of
  one request.
- **service.name** = `github-release-notifier` (constant on every record).
- **component** = `api` (HTTP) or `scanner` (background) via a pino child logger,
  so logs can be filtered per component while keeping one shared `service.name`.

### How logs are shipped (the pipeline)

`config/logstash/logstash.conf`:

- **json** — parse the pino JSON. It is parsed into an isolated `app` namespace
  so its fields (e.g. pino's numeric `level`) do not clobber the GELF envelope's
  own fields.
- **date** — set `@timestamp` from the application's event time (pino `time`),
  not the ingest time.
- **translate** — map pino's numeric level (`30`) to an ECS keyword
  (`log.level: info`).
- **mutate rename** — promote fields to clean names (`responseTime` → `durationMs`,
  `req.url` → `path`, etc.).
- **mutate remove_field** — drop the `app` wrapper and GELF noise.

Output index: `github-release-notifier-logs-%{+YYYY.MM.dd}` (one index per day).

### Field reference

| Field           | Type    | Description                                         |
| --------------- | ------- | --------------------------------------------------- |
| `@timestamp`    | date    | Event time from the application                     |
| `log.level`     | keyword | `trace`…`fatal`                                     |
| `service.name`  | keyword | Always `github-release-notifier`                    |
| `component`     | keyword | `api` or `scanner`                                  |
| `message`       | text    | Human-readable message                              |
| `requestId`     | keyword | UUID correlating all lines of one HTTP request      |
| `method`        | keyword | HTTP method (on `incoming request` lines)           |
| `path`          | keyword | Request URL path (on `incoming request` lines)      |
| `statusCode`    | long    | HTTP status (on `request completed` lines)          |
| `durationMs`    | float   | Request duration (on `request completed` lines)     |
| `userAgent`     | keyword | `User-Agent` header                                 |
| `remoteAddress` | keyword | Client IP                                           |
| `repository`    | keyword | GitHub repo (scanner logs)                          |
| `releaseTag`    | keyword | Release tag (scanner logs)                          |
| `error.*`       | object  | `type` / `message` / `stack` on error logs          |

> Each request produces **two** correlated lines: `incoming request`
> (with `method`/`path`) and `request completed` (with `statusCode`/`durationMs`),
> linked by `requestId`.

### Kibana

A data view (`github-release-notifier-logs-*`, time field `@timestamp`) and a
dashboard are exported to `config/kibana/dashboard.ndjson`. Import them into a
fresh Kibana:

```bash
curl -X POST "127.0.0.1:5601/api/saved_objects/_import?overwrite=true" \
  -H "kbn-xsrf: true" --form file=@config/kibana/dashboard.ndjson
```

Useful KQL in **Discover**:

- `requestId: "..."` — every line of one request
- `component: scanner` — background scanner only
- `statusCode >= 400` — failed requests
- `log.level: error` — errors

The dashboard aggregates: log volume by `log.level`, `api` vs `scanner`, and
HTTP `statusCode` distribution.

## Metrics (RED) → Prometheus → Grafana

The app is instrumented with RED metrics (Rate, Errors, Duration) via `prom-client`
and exposes them at `/metrics`. Unlike logs (which are pushed), metrics are
**pulled**: the app only exposes `/metrics`, and Prometheus scrapes it on a
schedule. Grafana then queries Prometheus.

```
app (/metrics)  ◄── scrape (15s) ── Prometheus  ◄── query ── Grafana (dashboard)
```

### Run

`docker compose up -d` also starts:

- App metrics: http://127.0.0.1:3000/metrics
- Prometheus: http://127.0.0.1:9090 (targets at `/targets`)
- Grafana: http://127.0.0.1:3001 (admin / admin)

### Metrics

| Metric                          | Type      | Labels                                        | RED      |
| ------------------------------- | --------- | --------------------------------------------- | -------- |
| `http_requests_total`           | counter   | method, route, status_code, status_class      | Rate     |
| `http_request_errors_total`     | counter   | method, route, status_code                     | Errors   |
| `http_request_duration_seconds` | histogram | method, route, status_code                     | Duration |

Plus default Node.js process metrics via `collectDefaultMetrics()`.

> **Cardinality:** `route` is the **route template** (`/api/confirm/:token`), not
> the raw path, so unique tokens do not explode the number of series. Unmatched
> paths collapse to `route="unknown"`. The `/metrics` endpoint does not measure
> itself.

### Prometheus

`config/prometheus/prometheus.yml` scrapes `app:3000` every 15s (job
`github-release-notifier`). Check the target at http://127.0.0.1:9090/targets.

```promql
# Rate
sum(rate(http_requests_total[1m]))
# Error ratio
sum(rate(http_request_errors_total[1m])) / sum(rate(http_requests_total[1m]))
# p95 latency
histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket[1m])))
```

### Grafana

Grafana is provisioned automatically — no manual setup:

- Datasource: `config/grafana/provisioning/datasources/prometheus.yml`
- Dashboard provider: `config/grafana/provisioning/dashboards/dashboards.yml`
- Dashboard: `config/grafana/dashboards/red-metrics.json` —
  "GitHub Release Notifier — RED Metrics" (request rate, rate by route, error
  ratio, p50/p95/p99 latency, rate by status class)

Open http://127.0.0.1:3001 (admin / admin); the dashboard is already there.
