## ADDED Requirements

### Requirement: TST-110 [CONFIRMED] Durable runtime принимается после реальных restart points
Независимый acceptance suite MUST останавливать и заново запускать worker до task claim, во время active lease, после внешнего side effect до local acknowledgement, после provider-job checkpoint и между eval/repair. Каждый сценарий MUST доказать продолжение с последнего подтверждённого checkpoint, отсутствие duplicate expensive work и достижение того же проверяемого outcome.

#### Scenario: Restart после remote job creation
- **WHEN** test завершает worker после сохранения remote job ID и запускает новый worker
- **THEN** новый worker продолжает polling той же job
- **AND** provider fixture фиксирует ровно одно создание job

### Requirement: TST-111 [CONFIRMED] Delivery, lease и idempotency проверяются конкурентно
Acceptance MUST доставлять одинаковый event нескольким workers, истекать lease и имитировать late completion прежнего owner. Oracle MUST проверять одну effective transition, один provider side effect, один artifact identity и отклонение stale acknowledgement.

#### Scenario: Два workers получили один task
- **WHEN** test одновременно разрешает claim одной runnable task
- **THEN** только текущий lease owner подтверждает effective attempt
- **AND** duplicate delivery не создаёт второй результат

### Requirement: TST-112 [CONFIRMED] Budgets и tool grants являются hard gates
Test matrix MUST исчерпывать attempts, repair, replan, LLM call/token/cost, wall-time и external-request budgets; проверять restart без сброса usage; а также absent, expired, wrong-scope и wrong-side-effect grants. Ни один denied либо over-budget case MUST NOT выполнять внешний side effect.

#### Scenario: Бюджет исчерпан после restart
- **WHEN** run использовал разрешённый repair budget до остановки worker
- **THEN** после restart следующий repair блокируется
- **AND** durable evidence показывает прежнее usage и `BUDGET_EXHAUSTED`

#### Scenario: Grant не разрешает запись
- **WHEN** task с read-only grant запрашивает write
- **THEN** provider fixture не получает запрос
- **AND** audit содержит policy denial без secret

### Requirement: TST-113 [CONFIRMED] Eval, repair и replan доказываются раздельно
Acceptance MUST проверить `PASS`, локальный successful repair, repeated violation, replan с новой immutable plan version и запрет бесконечного loop. Oracle SHALL сравнивать inputs/outputs gates, obstacle identity, reused artifacts, budget ledger и связь plan versions.

#### Scenario: Один output локально исправлен
- **WHEN** controlled evaluator возвращает repairable violation
- **THEN** runtime создаёт только bounded repair task и повторную eval
- **AND** завершённые extraction/transcription tasks не выполняются снова

#### Scenario: Repair не помогает
- **WHEN** fixture возвращает одинаковое violation до exhaustion policy
- **THEN** число repair/replan остаётся в пределах budget
- **AND** run переходит к содержательной escalation либо terminal outcome без бесконечного model loop

### Requirement: TST-114 [CONFIRMED] Human escalation и resume проверяются сквозным сценарием
Acceptance MUST проверить, что устранимое препятствие создаёт `WAITING_FOR_HUMAN`, а не общий `FAILED`; escalation содержит obstacle, attempts, evidence, impact, reused artifacts и конкретное действие. Resolution с неизменными inputs MUST продолжать тот же run; замена input MUST создавать новую version и новый связанный run.

#### Scenario: HR разрешает obstacle без изменения входов
- **WHEN** test выполняет разрешённое действие для актуальной escalation version
- **THEN** тот же run продолжает зависимый task с прежними checkpoints и budget usage
- **AND** уже завершённый дорогой этап не повторяется

#### Scenario: HR использует устаревшую escalation
- **WHEN** resolution относится к старой version
- **THEN** runtime отклоняет действие без изменения plan/run
- **AND** возвращает текущее препятствие

### Requirement: TST-115 [CONFIRMED] Side-effect recovery и compensation не публикуют частичный успех
Acceptance MUST инъецировать timeout-before-call, timeout-after-effect, partial PDF pair, lost Telegram response и compensation failure. Oracle MUST проверять durable intent, idempotency identity, recovery decision, visible outcome и отсутствие duplicate publication/notification.

#### Scenario: Второй PDF не сохранён
- **WHEN** первый PDF создан, а второй publication call завершается ошибкой
- **THEN** candidate не получает success notification
- **AND** recovery либо compensation оставляет одну согласованную visible result version

### Requirement: TST-116 [CONFIRMED] Agent runtime проходит обязательный regression contour
После RED/GREEN новых независимых сценариев одна и та же production-like сборка MUST пройти focused agent-runtime suite и полный набор `E2E-VAC-001`, `E2E-TRN-001`, `E2E-ABC-001`, `E2E-RESULT-001`. Evidence package SHALL включать machine result, readable event/plan timeline и очищенные runtime artifacts; green unit mocks без provisioned runtime MUST NOT считаться завершением change.

#### Scenario: Focused suite зелёный только локально
- **WHEN** production-like restart/concurrency/provider fixtures не запускались
- **THEN** implementation tasks остаются незавершёнными
- **AND** change не готов к archive или production release
