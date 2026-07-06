# Архітектура

Опис архітектури `github-release-notifier` за моделлю **C4** (Context → Container →
Component → Code/Runtime). Стиль застосунку — **шаруватий модульний моноліт** із
винесеним окремо `notification-service`. Правила залежностей і їх автоматична
перевірка описані в [ADR-005](./ADR/ADR-005-layered-architecture.md).

---

## High-level огляд

Ручна схема застосунку (container-рівень): моноліт як єдиний деплой (HTTP-шар +
модулі `Subscriptions`/`Scanner`/`Saga`), окремий `notification-service`, дві бази
(database-per-service) і дві черги RabbitMQ — `email_commands` (команди) і
`saga_replies` (відповіді саги).

![High-level architecture](./High-level-architecture.jpg)

**Легенда:**
- суцільна стрілка всередині `Monolith` — прямий виклик функції (той самий процес);
- підписана стрілка через `RabbitMQ` — асинхронне повідомлення (окрема черга);
- `gRPC` — єдиний синхронний виклик між сервісами (read-статус нотифікації, [ADR-004](./ADR/ADR-004-grpc.md));
- пунктирні блоки — зовнішні системи / інший деплой.

Деталізація нижче (Context → Container → Component → Runtime) — той самий застосунок
через призму C4, з акцентом на межі модулів і правила залежностей.

---

## Рівень 1 — Context

Хто користується системою і з чим вона говорить назовні.

```mermaid
flowchart TB
    user([Користувач])
    gh[(GitHub API<br/>зовнішній)]
    smtp[(SMTP / Mailhog)]

    subgraph sys[github-release-notifier]
        mono[Monolith<br/>API + scanner + saga]
        notif[notification-service]
    end

    user -->|"subscribe / confirm / unsubscribe (HTTP)"| mono
    mono -->|"опитує релізи (REST)"| gh
    mono -->|"команда SendConfirmation (RabbitMQ)"| notif
    notif -->|"reply sent/failed (RabbitMQ)"| mono
    notif -->|"лист"| smtp
    smtp -->|"email"| user
```

**Ключове:** уся міжсервісна комунікація — асинхронна через RabbitMQ, крім одного
синхронного read-статусу `GetNotificationStatus` (gRPC, див. [ADR-004](./ADR/ADR-004-grpc.md)).

---

## Рівень 2 — Container

Розгортувані одиниці та сховища стану.

```mermaid
flowchart TB
    subgraph mono[Monolith · Fastify · Node]
        api[HTTP API<br/>subscribe/confirm/unsubscribe]
        scan[Scanner<br/>поллер релізів]
        relay[Saga relay<br/>+ reply consumer]
    end

    subgraph notifsvc[notification-service]
        ngrpc[gRPC :50051 + REST :8080]
        nconsumer[email_commands consumer]
    end

    mdb[(Monolith DB<br/>Postgres)]
    ndb[(Notif DB<br/>Postgres)]
    mq{{RabbitMQ}}
    obs[[ELK + Prometheus/Grafana]]

    api --> mdb
    scan --> mdb
    relay --> mdb
    relay -->|publish email_commands| mq
    mq --> nconsumer
    nconsumer --> ndb
    nconsumer -->|publish saga_replies| mq
    mq -->|reply| relay
    api -.->|GetNotificationStatus gRPC| ngrpc
    ngrpc --> ndb

    mono -.logs/metrics.-> obs
    notifsvc -.logs/metrics.-> obs
```

Черги: `email_commands` (команди монолітом → notification), `saga_replies`
(відповіді назад). Кожен сервіс володіє **своєю** БД — спільної таблиці немає.

---

## Рівень 3 — Component (моноліт зсередини)

Це серце ДЗ: як усередині моноліту розкладені **модулі** й **шари**, і куди
дозволено вказувати залежностям.

```mermaid
flowchart TB
    root["app.ts — композиційний корінь<br/>(єдиний, хто знає всі модулі; тут DI)"]

    subgraph subs[modules/subscriptions]
        direction TB
        s_idx["index.ts (public API)"]
        s_ctl[controller] --> s_svc[service] --> s_repo[repository]
        s_note[notifications] --> s_repo
    end

    subgraph scan[modules/scanner]
        direction TB
        sc_idx["index.ts"]
        sc_svc[service] --> sc_repo[repository]
    end

    subgraph saga[modules/saga]
        direction TB
        sg_idx["index.ts"]
        sg_orch[orchestrator] --> sg_srepo[saga.repository]
        sg_orch --> sg_obox[outbox.repository]
        sg_relay[outbox.relay] --> sg_obox
        sg_replies[saga.replies] --> sg_orch
    end

    subgraph shared[modules/shared · інфраструктура]
        db[(db)]
        msg[messaging]
        ghc[github]
        mail[mailer]
        misc[config · auth · metrics · health · grpc]
    end

    root --> s_idx
    root --> sc_idx
    root --> sg_idx

    s_ctl -->|"startRegisterSubscription"| sg_idx
    s_repo --> db
    sc_repo --> db
    sg_srepo --> db
    sg_obox --> db
    sg_orch -.->|"port: CreatePendingSubscriptionFn (інжектиться)"| root
    sg_replies -.->|"port: CompensateFn (інжектиться)"| root

    subs --> shared
    scan --> shared
    saga --> shared
```

### Шари (згори вниз, залежності лише вниз)

| Шар | Файли | Відповідальність | Кому дозволено кликати |
| --- | --- | --- | --- |
| **Controller** | `*.controller.ts` | HTTP: валідація, статус-коди, маппінг помилок | service, public API інших модулів |
| **Service** | `*.service.ts` | бізнес-логіка, оркестрація в межах модуля | repository |
| **Repository** | `*.repository.ts` | єдиний, хто пише SQL / тримає доступ до БД | shared/db |
| **Shared** | `modules/shared/**` | інфраструктура (БД, черга, github, mailer…) | нічого з домену |

**Композиційний корінь** `app.ts` живе поза `src/modules` і є єдиним місцем, де
збираються всі залежності (Dependency Injection). Тільки йому дозволено знати всі
модулі одночасно.

### Правило залежностей

1. Залежності вказують **в один бік**: controller → service → repository → shared.
2. `shared` (інфраструктура) **ніколи** не залежить від домену.
3. Модуль спілкується з іншим модулем **лише через його `index.ts`** (публічний API),
   ніколи не тягне внутрішні файли.
4. Циклів немає. Колишній цикл `subscriptions ↔ saga` розірвано **інверсією
   залежностей**: сага не імпортує `subscriptions`, а приймає дві функції-порти
   (`CreatePendingSubscriptionFn`, `CompensateFn`), які інжектить композиційний корінь.

Усе це — не домовленість на словах, а **fitness-функції**: `npm run arch`
(dependency-cruiser) валить збірку на порушенні. Деталі й межі інструмента — в
[ADR-005](./ADR/ADR-005-layered-architecture.md).

---

## Рівень 4 — Runtime (sequence diagrams)

Динаміка ключових сценаріїв. Кожна діаграма — окремий шлях крізь шари.

### 4.1 Реєстрація підписки (Saga + transactional outbox)

Головний сценарій — оркестрована сага. Повна послідовність і рішення — в
[ADR-003](./ADR/ADR-003.md).

```mermaid
sequenceDiagram
    actor U as Користувач
    participant C as Controller
    participant GH as GitHub API
    participant O as Saga orchestrator
    participant DB as Monolith DB
    participant MQ as RabbitMQ
    participant N as notification-service

    U->>C: POST /api/subscribe {email, repo}
    C->>GH: getLatestRelease(repo)
    GH-->>C: latest tag
    C->>O: startRegisterSubscription(port createPending)
    O->>DB: BEGIN — subscription(pending) + saga + outbox — COMMIT
    C-->>U: 202 Accepted (sagaId)
    O-->>MQ: relay публікує outbox → email_commands
    MQ->>N: SendConfirmation(sagaId)
    N-->>MQ: reply sent/failed → saga_replies
    MQ->>O: reply
    alt sent
        O->>DB: saga = completed
    else failed (<3)
        O->>DB: attempts++ + outbox(retry)
    else failed (=3)
        O->>DB: compensate (port) + saga = failed
    end
```

### 4.2 Підтвердження підписки

Синхронний шлях без саги — юзер клікає лист.

```mermaid
sequenceDiagram
    actor U as Користувач
    participant C as Controller
    participant S as Service
    participant R as Repository
    participant DB as Monolith DB

    U->>C: GET /api/confirm/:token
    C->>S: confirmSubscription(token)
    S->>R: mark confirmed by token
    R->>DB: UPDATE subscription SET confirmed=true
    DB-->>R: rowCount
    R-->>S: found?
    alt знайдено
        C-->>U: 200 Confirmed
    else токен невідомий
        C-->>U: 404 Not found
    end
```

### 4.3 Відписка

```mermaid
sequenceDiagram
    actor U as Користувач
    participant C as Controller
    participant S as Service
    participant R as Repository
    participant DB as Monolith DB

    U->>C: GET /api/unsubscribe/:token
    C->>S: deleteSubscription(token)
    S->>R: delete by unsubscribe_token
    R->>DB: DELETE subscription
    DB-->>R: rowCount
    alt видалено
        C-->>U: 200 Unsubscribed
    else токен невідомий
        C-->>U: 404 Not found
    end
```

### 4.4 Сповіщення про новий реліз (scanner → fan-out)

Фоновий поллер. Scanner не знає ні про підписників, ні про пошту — він лише
сигналить, а `subscriptions` вирішує кому і як (інверсія через callback `onRelease`).

```mermaid
sequenceDiagram
    participant SC as Scanner (поллер)
    participant GH as GitHub API
    participant NF as notifyRelease (subscriptions)
    participant DB as Monolith DB
    participant MQ as RabbitMQ
    participant N as notification-service

    loop кожні N секунд
        SC->>GH: getLatestRelease(repo)
        GH-->>SC: tag
        alt новий tag
            SC->>DB: оновити last_seen_tag
            SC->>NF: onRelease(repoId, repo, tag)
            NF->>DB: getConfirmedSubscribers(repoId)
            DB-->>NF: список підписників
            loop кожен підписник
                NF-->>MQ: publish release → email_commands
            end
            MQ->>N: SendRelease → лист
        end
    end
```

### 4.5 Синхронний статус нотифікації (gRPC edge)

Єдиний внутрішній sync-виклик — read-статус. Деталі й бенчмарк — в
[ADR-004](./ADR/ADR-004-grpc.md).

```mermaid
sequenceDiagram
    actor U as Клієнт
    participant C as Edge controller (monolith)
    participant GC as gRPC client
    participant N as notification-service :50051
    participant NDB as Notif DB

    U->>C: GET /api/notifications/:sagaId
    C->>GC: getNotificationStatus(sagaId)
    GC->>N: GetNotificationStatus (protobuf/HTTP2)
    N->>NDB: SELECT status by sagaId
    NDB-->>N: row
    N-->>GC: status
    GC-->>C: status
    C-->>U: 200 {status} / 404 / 502
```
