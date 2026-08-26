## 1. Независимый RED acceptance baseline

- [x] 1.1 После согласования change поручить независимому субагенту реализовать TST-110–TST-116 с управляемыми worker restarts, concurrent claims, provider fixtures, budget/grant denial, repair/replan, escalation/resume и partial side effects.
- [x] 1.2 Добавить synthetic conformance goal и deterministic tool fixtures, не использующие реальные данные кандидатов или внешние расходы.
- [x] 1.3 Запустить focused suite на текущем коде, сохранить ожидаемый RED, machine result, readable timeline и очищенные evidence artifacts.

## 2. Persistent control-plane schema

- [x] 2.1 Добавить D1 migrations и Drizzle schema для goals, runs, immutable plan versions, tasks и task dependencies с candidate/input/profile/policy identities и revisions.
- [x] 2.2 Добавить attempts, append-only events и checkpoints с lease fencing token, idempotency identity и unknown-outcome state.
- [x] 2.3 Добавить scoped memory/artifact refs, tool grants, budget ledger/reservations, eval results и obstacle fingerprints.
- [x] 2.4 Добавить escalations/action versions, outbox intents и compensations с уникальными operation identities.
- [x] 2.5 Добавить foreign keys, uniqueness/check constraints и indexes для runnable claim, stale lease recovery, event lookup и cascade deletion.
- [x] 2.6 Реализовать migration/invariant tests, доказывающие immutable plan/event history и запрет orphan runtime records.

## 3. Goal, plan и event protocol

- [x] 3.1 Реализовать registry goal types и deterministic initial plan templates с versioned completion criteria и policy binding.
- [x] 3.2 Реализовать transactional command protocol: expected revision, append event и projection update в одной D1 transaction.
- [x] 3.3 Реализовать DAG/schema/policy validator для initial plan и replan, включая cycle, unsupported task, stale input/profile и missing completion gate.
- [x] 3.4 Реализовать idempotent trigger ingestion для input-ready, manual start, provider completion, timer, configuration и human-resolution events.
- [x] 3.5 Реализовать goal outcome rules `SUCCEEDED`, `WAITING_FOR_HUMAN`, `FAILED`, `CANCELLED`, `SUPERSEDED`, не считая пустую очередь успехом.

## 4. Durable scheduler и worker protocol

- [x] 4.1 Реализовать dependency/precondition evaluation и transactional promotion eligible tasks в `RUNNABLE`.
- [x] 4.2 Реализовать claim с lease owner/token/expiry, heartbeat и fenced checkpoint/outcome commands.
- [x] 4.3 Реализовать stale lease recovery, unknown-outcome reconciliation и отклонение late acknowledgement прежнего owner.
- [x] 4.4 Реализовать at-least-once duplicate delivery handling с одной effective transition и stable artifact/operation identities.
- [x] 4.5 Реализовать authenticated internal runtime API для publish, claim, heartbeat, checkpoint, complete, fail и event/timeline read.
- [x] 4.6 Реализовать постоянно работающий Node consumer с graceful shutdown, startup recovery и configurable polling/heartbeat cadence.

## 5. Tool registry, grants и budgets

- [x] 5.1 Реализовать versioned tool registry с input/output schemas, timeout/retry class, side-effect class, idempotency, checkpoint, secret и compensation metadata.
- [x] 5.2 Реализовать server-side grant issuance/check/revocation по tool, candidate/run/input scope, TTL, side-effect class и policy version до secret resolution.
- [x] 5.3 Реализовать policy-denial audit и гарантировать отсутствующий provider call для absent, expired, stale-scope и insufficient-side-effect grants.
- [x] 5.4 Реализовать durable budget configuration validation и ledger для wall time, attempts, repair, replan, LLM calls, tokens/cost и external requests.
- [x] 5.5 Реализовать transactional reserve/commit/release/reconcile и сохранение usage через restart/replan без автоматического пополнения.
- [x] 5.6 Подключить synthetic tools, transcription boundary и protected LLM tracing boundary через registry adapters без изменения их domain semantics.

## 6. Memory и безопасный context builder

- [x] 6.1 Реализовать working, immutable artifact/evidence и append-only decision/event memory kinds с provenance, sensitivity и version scopes.
- [x] 6.2 Реализовать artifact references/checksums для Drive/R2 payloads без дублирования полного содержимого в D1 logs/events.
- [x] 6.3 Реализовать task-purpose context manifest, который выдаёт только разрешённые current-run entries и общие неперсональные policy artifacts.
- [x] 6.4 Добавить tests запрета cross-candidate memory, superseded working facts, secret/raw-instruction leakage и over-broad repair context.
- [x] 6.5 Расширить archive/delete lifecycle: остановить tasks, отозвать grants, удалить personal runtime payloads и сохранить только допустимую tombstone.

## 7. Eval, obstacle, repair и replan loop

- [x] 7.1 Реализовать deterministic pre-gates и versioned evaluator contract `PASS`, `REPAIRABLE`, `REPLAN_REQUIRED`, `HUMAN_REQUIRED` с violations/evidence refs.
- [x] 7.2 Реализовать obstacle classifier/fingerprint для transient, repairable, replan-required, human-required и terminal classes.
- [x] 7.3 Реализовать bounded repair task creation с конкретным expected change, отдельным attempt/budget и обязательной повторной eval.
- [x] 7.4 Реализовать immutable replan из allowlisted recovery templates с reused/replaced/added/cancelled task mapping.
- [x] 7.5 Реализовать loop guard по obstacle fingerprint и budgets, исключающий повтор того же repair без изменившегося evidence.
- [x] 7.6 Добавить timeline/audit evidence для gate, repair и replan, включая обе plan versions и reused expensive artifacts.

## 8. Escalation и human resume

- [x] 8.1 Реализовать versioned escalation record с safe summary, obstacle, impact, attempts, budgets, evidence, reusable artifacts и allowlisted action schemas.
- [x] 8.2 Добавить candidate projection `WAITING_FOR_HUMAN`, сохранив `FAILED` только для terminal outcome без допустимого действия.
- [x] 8.3 Реализовать escalation UI/API с конкретными действиями, optimistic escalation revision и запретом общей retry-all команды как замены объяснению.
- [x] 8.4 Реализовать same-run resume для resolution без изменения immutable inputs с прежними checkpoints и budget usage.
- [x] 8.5 Реализовать supersede + linked new run при замене input/profile version и отклонение stale/unauthorized resolution.

## 9. Side effects, outbox и compensation

- [x] 9.1 Реализовать durable intent до effectful call и adapter contract для read-only, idempotent-write, reversible-write и irreversible-write.
- [x] 9.2 Реализовать reconcile timeout-before/after-effect по idempotency identity без слепого duplicate call.
- [x] 9.3 Реализовать outbox state отдельно от candidate readiness и unknown-delivery handling для synthetic notification tool.
- [x] 9.4 Реализовать compensation intent/outcome для reversible fixtures и visibility gate, запрещающий частичный success.
- [x] 9.5 Добавить controlled partial-PDF-pair и lost-response acceptance fixtures, не реализуя production PDF/Telegram pipeline в этом change.

## 10. Наблюдаемость, rollout и release gate

- [x] 10.1 Добавить operational runtime projection: goal/run, plan, current tasks/leases, attempts, budgets, gates, obstacle/escalation и last progress time.
- [x] 10.2 Добавить metrics queue wait, execution, provider wait, repair/replan overhead и human wait без персонального содержимого.
- [x] 10.3 Добавить feature flags для synthetic, shadow и per-tool routing; rollback MUST прекращать новые goals и controlled-pause существующие runs без потери checkpoints.
- [ ] 10.4 Довести независимо созданные TST-110–TST-116 и focused schema/protocol/security tests до GREEN.
- [x] 10.5 Запустить typecheck, lint, unit/integration/build и проверить миграции на чистой и существующей D1 schema.
- [ ] 10.6 На одной production-like сборке выполнить focused restart/concurrency/side-effect suite и полный набор `E2E-VAC-001`, `E2E-TRN-001`, `E2E-ABC-001`, `E2E-RESULT-001`.
- [x] 10.7 Проверить 30-дневный evidence package и оставить change незавершённым, если provisioned background runtime или обязательный regression contour отсутствуют.
