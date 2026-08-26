## Context

См. `proposal.md` — Why. Сейчас D1 хранит продуктовые сущности, но не execution state; экран вычисляет очередь из candidate status. Долгие FFmpeg/AssemblyAI операции уже вынесены в Node module, LLM tracing защищён R2-boundary, однако единого dispatcher, persistent queue и background consumer нет. Cloudflare Worker не подходит для удержания сквозного workflow в одном request lifecycle.

## Goals / Non-Goals

**Goals:**
- Сделать execution state источником истины, восстанавливаемым независимо от UI и process lifetime.
- Обеспечить at-least-once dispatch с идемпотентными observable outcomes.
- Отделить deterministic orchestration/policy от недетерминированных planner/evaluator calls.
- Дать каждому автономному действию доказуемую цель, grant, budget, gate и audit trail.
- Позволить постепенно подключать существующие и будущие pipeline stages как tools.

**Non-Goals:**
- Реализовать в этом change Drive scanner, OCR/assessment, PDF generator и Telegram connector.
- Разрешить LLM создавать произвольные tools, SQL, network destinations или кадровые правила.
- Гарантировать exactly-once delivery на транспортном уровне.
- Создавать общую semantic memory кандидатов или самообучение на production-данных.
- Заменять OpenSpec продуктовые requirements динамическим agent plan.

## Decisions

### 1. D1 — control-plane source of truth, Node — execution plane

Persistent control plane остаётся в D1 рядом с существующими product identities. Background Node worker взаимодействует с ним через authenticated internal runtime API: читает events, claims tasks, пишет heartbeat/checkpoints/outcomes. Cloudflare request handlers только публикуют triggers, выполняют короткие транзакции и отдают projections UI.

Альтернатива — сразу добавить отдельный Postgres/Temporal. Она даёт готовые primitives, но создаёт новую эксплуатационную систему до проверки продуктового runtime. D1-backed protocol оставляет возможность позже заменить scheduler/queue, поскольку task/lease/idempotency semantics определены контрактом, а не vendor API.

### 2. Append-only events плюс нормализованные projections

Основные таблицы:

- `agent_goals`, `agent_runs`, `agent_plan_versions`;
- `agent_tasks`, `agent_task_dependencies`, `agent_attempts`;
- `agent_events`, `agent_checkpoints`;
- `agent_memory_entries`, `agent_artifact_refs`;
- `agent_tool_grants`, `agent_budget_ledger`;
- `agent_eval_results`, `agent_escalations`;
- `agent_outbox`, `agent_compensations`.

Events являются audit/replay ledger, а нормализованные строки — query/claim projections. Каждая изменяемая projection имеет monotonic revision; команда проверяет expected revision и append event в одной транзакции. Полный event sourcing без projections отклонён из-за лишней сложности чтения и миграции текущего UI.

### 3. План строится из зарегистрированных templates

Первоначальный graph создаётся deterministic plan template для goal type и policy version. LLM planner может предложить только schema-valid modifications из allowlist registered task/recovery templates. Runtime валидирует DAG, scopes, budgets, grants и completion criteria до сохранения новой plan version.

Свободный ReAct-loop отклонён: он не гарантирует воспроизводимые зависимости, ограничение side effects и доказуемое завершение.

### 4. Scheduler использует transactional promotion и lease fencing

Task переходит в `RUNNABLE`, когда все required dependencies имеют допустимый outcome и preconditions актуальны. Claim атомарно записывает `leaseOwner`, `leaseToken`, `leaseExpiresAt`, attempt number и expected task revision. Heartbeat продлевает lease. Любой checkpoint/outcome требует текущий fencing token; late worker не может подтвердить старый attempt.

Delivery остаётся at-least-once. Exactly-once outcome достигается idempotency key, уникальными artifact identities и проверкой operation revision.

### 5. Checkpoint ставится на стороне подтверждённого знания

Checkpoint сохраняется после получения устойчивого факта, а не после завершения всего stage. Для provider job это remote job ID сразу после create response; для artifact — immutable content identity/checksum; для LLM — raw trace identity, schema version и normalized output identity. Unknown outcome сначала вызывает adapter-specific reconcile, затем решает, допустим ли новый side effect.

### 6. Tools регистрируются декларативно

Tool registry задаёт capability, input/output schema versions, timeout/retry class, idempotency strategy, side-effect class, required secrets, checkpoint contract, compensation capability и supported recovery actions. Task ссылается только на registry key/version. Grant хранится server-side и проверяется до secret resolution; модель получает capability description, но не secret и не возможность изменить registry.

Прямой вызов существующих modules из UI будет постепенно заменён dispatch через adapter, сохраняя их внутренние API до миграции.

### 7. Budget ledger использует reserve/commit/release

Перед внешним или LLM-вызовом worker транзакционно резервирует верхнюю оценку attempts/requests/tokens/cost/time allowance. После результата фактическое usage фиксируется, остаток освобождается. Неизвестный outcome держит reservation до reconcile либо policy timeout. Replan наследует ledger goal/run и не получает новый бюджет автоматически.

Numerical defaults остаются versioned runtime configuration: отсутствие обязательного hard limit делает configuration invalid и блокирует новый goal. Это позволяет корректировать числа по метрикам без изменения spec semantics.

### 8. Memory хранит ссылки и provenance, а не неограниченный prompt transcript

D1 хранит scoped metadata и небольшие normalized facts; крупные immutable artifacts остаются в разрешённом Drive/R2 storage и адресуются identity/checksum. Working entries имеют supersession state, evidence entries immutable, event/decision history append-only. Context builder формирует manifest по task purpose, grant и sensitivity, исключая cross-candidate payloads.

### 9. Eval gate — отдельный task с четырьмя решениями

Evaluator возвращает versioned structured result: `PASS`, `REPAIRABLE`, `REPLAN_REQUIRED`, `HUMAN_REQUIRED`, violations и referenced evidence. Deterministic schema/version/id/checksum checks выполняются до возможного LLM evaluator. Gate outcome не редактируется planner; он создаёт следующий event и recovery branch по policy.

### 10. Repair и replan не являются retry

Retry повторяет тот же tool contract только для transient class. Repair имеет новый bounded input/output contract и проверяет конкретное violation. Replan создаёт новую immutable graph version из зарегистрированной ветки. Obstacle fingerprint предотвращает повторение одного repair без изменения evidence; policy ограничивает repair/replan counts и escalation threshold.

### 11. Escalation — versioned interaction contract

Escalation record содержит safe summary, obstacle fingerprint, evidence refs, attempts, budgets, impact, reusable artifacts и allowlisted actions с expected input schema. UI command передаёт escalation ID/revision и action payload. Runtime перепроверяет actor, versions и preconditions; resolution event либо возобновляет текущий run, либо supersedes его и создаёт новый.

Строка `FAILED` без action contract остаётся только terminal projection.

### 12. Side effects проходят intent/outbox/confirmation

До effectful call создаётся durable intent с idempotency key. Read-only и idempotent writes могут выполняться worker напрямую через adapter; reversible writes дополнительно создают compensation intent; irreversible writes требуют финального gate и не используются для exploration/repair. Outbox отделяет готовность product result от Telegram delivery state.

Distributed transaction между D1 и внешними providers не предполагается. Пользовательская атомарность достигается visibility gates, stable identities, reconcile и compensation.

### 13. Наблюдаемость строится из event timeline

Operational projection показывает goal/run state, plan version, current tasks, leases, attempts, budget usage, gates, obstacle/escalation и last progress time. Metrics содержат queue wait, execution, provider wait, repair/replan overhead и human wait отдельно. Personal content остаётся только в authorized artifact view, не в metrics/logs.

## Risks / Trade-offs

- [D1 contention при частых heartbeat/events] → Батчить non-critical metrics, использовать короткие indexed claims и отдельную configurable heartbeat cadence.
- [Worker умер после внешнего effect до checkpoint] → Adapter reconcile по idempotency identity; при невозможности определить outcome — escalation/compensation, а не слепой повтор.
- [LLM предлагает циклический или чрезмерный plan] → Schema + DAG + policy validator до persistence, allowlisted templates и hard budgets.
- [Event ledger и projections расходятся] → Transactional append/update, invariant checks и rebuild/read-only reconciliation command.
- [Escalation перегружает HR техническими деталями] → Отдельные safe user summary и internal evidence; UI показывает concrete action первым.
- [Новый runtime усложняет существующий demo flow] → Feature flag, synthetic conformance goal и поэтапное подключение tools без переключения production pipeline до GREEN evidence.
- [Compensation невозможна для части внешних effects] → Явный `irreversible-write` class, последний execution phase и запрет использовать его в repair branches.

## Migration Plan

1. Добавить schema/migrations и invariant tests без изменения текущего candidate flow.
2. Реализовать internal runtime API, scheduler и synthetic conformance tools; получить RED/GREEN restart/concurrency acceptance.
3. Запустить shadow goals, которые строят plan и gates без production side effects, сравнивая expected timeline.
4. Подключить существующие transcription и protected LLM tracing modules через tool registry/adapters.
5. Переключать pipeline stages feature flags по одному после focused acceptance; старый path остаётся rollback boundary до полного переключения.
6. Включить `WAITING_FOR_HUMAN` projection и escalation UI только после готовности resume semantics.
7. Перед production release выполнить focused chaos suite и четыре обязательных E2E на одной сборке.

Rollback отключает создание новых agent goals и возвращает routing ещё не начатых candidates на прежний path. Уже созданные runs переводятся в controlled pause; event/checkpoint data не удаляются, effectful tasks не повторяются автоматически, а после возврата новой версии runtime продолжаются по сохранённым revisions.
