## Why

Текущий продукт описывает сквозную обработку кандидата, но не имеет исполняемого durable runtime: состояние вычисляется экраном, этапы не представлены устойчивыми задачами, а после исчерпания простых retry процесс заканчивается `FAILED`. Нужен ограниченный agentic harness, который превращает цель анализа в проверяемый план, продолжает работу после сбоев и перезапусков, выполняет безопасный repair/replan и эскалирует человеку конкретное препятствие с доказательствами.

## What Changes

- Добавить persistent goal graph с версионируемым планом, зависимостями, критериями завершения и привязкой к неизменяемым версиям входов и профиля вакансии.
- Добавить durable event/task/attempt/checkpoint runtime с очередью, lease/heartbeat, восстановлением stale tasks, идемпотентностью и продолжением после перезапуска процесса.
- Добавить event triggers для Drive discovery, готовности материалов, завершения внешней provider job, таймера, изменения конфигурации и решения человека.
- Добавить run-scoped memory: рабочие факты, неизменяемые артефакты/evidence и журнал решений без cross-candidate semantic memory по умолчанию.
- Добавить tool grants с областью candidate/run/input-version, TTL, классом side effect и явным запретом неразрешённых инструментов.
- Добавить бюджеты времени, попыток, repair/replan, LLM-вызовов, токенов/стоимости и внешних запросов; превышение бюджета не должно создавать бесконечный агентский цикл.
- Добавить eval gates между этапами: schema, evidence, consistency, publication и side-effect gates должны создавать машинное evidence решения.
- Добавить obstacle detection и ограниченный feedback loop `evaluate → repair → re-evaluate → replan`, переиспользующий успешные дорогие артефакты.
- Добавить staged external side effects, outbox/idempotency keys и compensation/rollback policy для операций, которые можно безопасно отменить.
- Заменить безусловный переход в `FAILED` после retry на содержательную эскалацию `WAITING_FOR_HUMAN`, когда конкретное действие HR или оператора может продолжить тот же run; `FAILED` оставить для действительно терминального исхода.
- Ограничить автономность целями candidate-processing workflow и разрешёнными инструментами; открытый self-directed агент и изменение кадровых правил в этот change не входят.

## Capabilities

### New Capabilities

- `agent-runtime`: durable goal graph, task queue, memory, tool grants, budgets, eval/repair/replan loop, side-effect control, escalation и resume semantics.

### Modified Capabilities

- `candidate-workflow`: добавить `WAITING_FOR_HUMAN`, durable продолжение существующего run и отличить устранимое препятствие от терминального `FAILED`.
- `integrations-and-operations`: заменить stage-local retry-only поведение runtime-контролируемыми attempts, checkpoints, budgets, recovery и escalation policy.
- `data-and-security`: распространить аудит, минимизацию и удаление на agent memory, goals, tasks, attempts, grants, decisions и escalation records.
- `quality-gates`: добавить независимые acceptance-сценарии restart recovery, duplicate delivery, budget exhaustion, repair/replan, tool denial, compensation и human resume.

## Impact

- Потребуются новые persistent entities и миграции для goals, plan versions, runs, tasks, dependencies, attempts, events, checkpoints, memory entries, grants, budgets, eval results, escalations и outbox/compensations.
- Потребуется постоянно работающий background Node worker отдельно от HTTP request lifecycle, а также dispatcher/provider adapters с idempotent resume.
- Изменятся candidate state presentation, operational dashboard, audit trail и ручные действия HR для эскалации/возобновления.
- Существующие transcription и protected LLM tracing boundaries должны подключаться как инструменты runtime, а не вызываться напрямую из фиксированного UI flow.
- Реализация канонического Drive → OCR/STT → assessment → PDF → Telegram pipeline и domain-specific recovery policies остаётся отдельными последующими changes поверх этого harness.
