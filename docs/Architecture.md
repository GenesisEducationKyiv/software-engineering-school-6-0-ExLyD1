# Архітектура

Опис архітектури `github-release-notifier` за моделлю **C4** (Context → Container →
Component → Code/Runtime). Стиль застосунку — **шаруватий модульний моноліт** із
винесеним окремо `notification-service`. Правила залежностей і їх автоматична
перевірка описані в [ADR-005](./ADR-005-layered-architecture.md).

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
синхронного read-статусу `GetNotificationStatus` (gRPC, див. [ADR-004](./ADR-004-grpc.md)).

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
[ADR-005](./ADR-005-layered-architecture.md).

---

## Рівень 4 — Runtime (реєстрація підписки, Saga)

Динаміка головного сценарію — оркестрована сага з transactional outbox.
Повна послідовність і рішення — в [ADR-003](./ADR-003.md):

```mermaid
sequenceDiagram
    participant C as Controller
    participant O as Saga orchestrator
    participant DB as Monolith DB
    participant MQ as RabbitMQ
    participant N as notification-service

    C->>O: startRegisterSubscription(port createPending)
    O->>DB: BEGIN — subscription(pending) + saga + outbox — COMMIT
    Note over C: 202 Accepted
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
