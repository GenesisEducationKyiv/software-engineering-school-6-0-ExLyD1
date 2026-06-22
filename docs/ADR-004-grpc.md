# ADR-004: gRPC для синхронного read між сервісами

---

## Статус

**Статус:** Accepted
**Дата:** 2026-06-22
**Автор:** Яхній Олександр

---

## Контекст

Уся міжсервісна комунікація в проєкті — **асинхронна** через RabbitMQ (команди `email_commands`, відповіді `saga_replies`). Внутрішнього синхронного REST-виклику між нашими сервісами не існувало (єдиний sync REST — це зовнішній виклик у GitHub).

Завдання: показати **gRPC** на реальному внутрішньому sync-виклику, описати контракт через `.proto` + `buf`, і лишити поряд REST-реалізацію для порівняння.

---

## Рішення

Додано **синхронний read** `GetNotificationStatus(saga_id)`, який моноліт робить у `notification-service` (той володіє таблицею `notifications`). Виклик виставлено **двома транспортами одночасно**:

- **gRPC** (`@grpc/grpc-js`) — порт `50051`, контракт `proto/notification/v1/notification.proto`;
- **REST** (Fastify) — `GET /notifications/:sagaId`, порт `8080`.

Обидва викликають **ту саму доменну функцію** `getNotificationStatus(db, sagaId)` — відрізняється лише транспорт і маппінг помилок. Це робить порівняння чесним (міряємо протокол, а не різну логіку). Асинхронну сагу на RabbitMQ **не чіпали**.

### Чому read, а не «надіслати лист»
Статус-чек синхронний за природою (питання→відповідь), без побічних ефектів — ідеальний для unary RPC і для бенчмарку. Надсилання листа лишилось async командою в сазі (там доречні буферизація + durability брокера).

### Маппінг помилок на gRPC status codes

| Ситуація | gRPC | REST |
| --- | --- | --- |
| знайдено | `OK` | 200 |
| `saga_id` порожній | `INVALID_ARGUMENT` | 400 |
| запису немає | `NOT_FOUND` | 404 |
| збій БД | `INTERNAL` | 500 |
| сервіс недоступний (на боці клієнта) | `UNAVAILABLE` | 502 |

---

## Тулінг

- `proto/notification/v1/notification.proto` — контракт (1 unary RPC, enum зі статусами, версія в пакеті `notification.v1`).
- `buf.yaml` — модуль + `STANDARD` lint + breaking-check.
- `buf.gen.yaml` — codegen через `ts-proto` (`outputServices=grpc-js`) у `src/generated` обох сервісів.
- Скрипти: `npm run proto:lint`, `npm run proto:gen`.

---

## Наслідки

### Позитивні
- Строгий контракт + codegen: клієнт і сервер типобезпечні, контракт — джерело правди.
- Бінарний protobuf поверх HTTP/2 — менший payload, вищий throughput за REST/JSON.
- Доменна логіка спільна для обох транспортів — нуль дублювання поведінки.

### Негативні / trade-offs
- **Sync ≠ async:** gRPC створює темпоральну звʼязність (notification має бути живий під час виклику), на відміну від брокера. Тому sync лишили тільки для read-статусу, а саму сагу — на черзі.
- gRPC не браузерний нативно (треба grpc-web/проксі) — тому на edge моноліт перекладає його назад у HTTP.
- Бінарний формат важче дебажити очима, ніж JSON.

---

## Бенчмарк (REST vs gRPC) — як відтворити

Ізолюємо транспорт: бʼємо по **одному відомому** `saga_id`, щоб БД віддавала з кешу/по індексу й була майже константною (інакше Postgres стане пляшковим горлом і сховає різницю протоколів).

1. Підняти стек: `docker compose up -d --build`
2. Засіяти один рядок у notification-db (один раз):
   ```sql
   INSERT INTO notifications (saga_id, type, recipient, status)
   VALUES ('bench-1', 'confirmation', 'bench@example.com', 'sent')
   ON CONFLICT (saga_id) DO NOTHING;
   ```
3. REST (`autocannon`, вже в devDeps):
   ```bash
   npx autocannon -c 50 -d 20 --warmup [ -c 5 -d 2 ] \
     http://127.0.0.1:8080/notifications/bench-1
   ```
4. gRPC (`ghz` — окремий бінар: `brew install ghz`):
   ```bash
   ghz --insecure --proto proto/notification/v1/notification.proto \
     --call notification.v1.NotificationQueryService.GetNotificationStatus \
     -d '{"sagaId":"bench-1"}' -c 50 -z 20s 127.0.0.1:50051
   ```

### Результати (заповнити після прогону)

| Метрика | REST/JSON | gRPC/protobuf |
| --- | --- | --- |
| Throughput (req/s) | … | … |
| Latency p50 / p95 / p99 (ms) | … | … |
| Payload (bytes) | … | … |

**Застереження для чесності:** `autocannon` = HTTP/1.1 з N зʼєднань; gRPC = HTTP/2 з мультиплексуванням — це частина суті протоколів, не баг тесту. Заміри на localhost, тож перевага gRPC по розміру payload на реальній мережі була б помітнішою (тут домінує CPU-серіалізація).
