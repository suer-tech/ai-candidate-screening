## Purpose

Определяет ограниченный durable agent runtime, который превращает цель обработки кандидата в проверяемый план, безопасно выполняет его до результата и привлекает человека только при содержательном препятствии.

## ADDED Requirements

### Requirement: AGT-001 [CONFIRMED] Автономность ограничена явной целью
Каждый agent run SHALL иметь тип цели, candidate ID, неизменяемую input-version, vacancy-profile-version, критерии успешного завершения и разрешённую policy version. Runtime MUST NOT самостоятельно изменять кадровые правила, входные материалы, выбранную версию профиля или создавать цель вне зарегистрированного candidate-processing workflow.

#### Scenario: Автоматическая обработка запускается
- **WHEN** полный стабильный комплект кандидата и active profile version готовы
- **THEN** runtime создаёт goal с зафиксированными идентификаторами входов, профиля и policy
- **AND** все последующие действия остаются в границах этой цели

#### Scenario: План предлагает действие вне цели
- **WHEN** planner предлагает изменить профиль вакансии или обработать другого кандидата
- **THEN** runtime отклоняет действие до постановки task
- **AND** сохраняет нарушение policy как evidence

### Requirement: AGT-002 [CONFIRMED] Goal graph и план версионируются
Goal SHALL исполняться как направленный ациклический граф обязательных и условных tasks с явными dependencies, preconditions, expected outputs и completion criteria. Любой replan MUST создавать новую immutable plan version с причиной, ссылкой на obstacle и отображением reused, replaced, added и cancelled tasks; прежняя версия MUST оставаться доступной для аудита.

#### Scenario: Создан первоначальный план
- **WHEN** runtime принимает новую цель
- **THEN** он сохраняет plan version 1 с зависимостями и критериями завершения
- **AND** task становится runnable только после выполнения его preconditions

#### Scenario: Требуется replan
- **WHEN** допустимый repair не устраняет obstacle
- **THEN** runtime создаёт следующую plan version вместо изменения прежней
- **AND** переиспользует совместимые успешные artifacts и отмечает заменённые tasks

### Requirement: AGT-003 [CONFIRMED] События, задачи, попытки и checkpoints устойчивы
Goal, run, plan, task, attempt, event и checkpoint MUST сохраняться до выполнения внешнего действия или подтверждения task completion. После остановки либо перезапуска процесса runtime SHALL продолжать незавершённый run с последнего подтверждённого checkpoint без повторения совместимых завершённых дорогих этапов.

#### Scenario: Worker остановился после транскрибации
- **WHEN** процесс перезапускается после сохранённого transcript checkpoint, но до assessment
- **THEN** runtime возобновляет run с первой незавершённой dependency
- **AND** не отправляет аудио провайдеру повторно

#### Scenario: Процесс остановился до checkpoint
- **WHEN** attempt не имеет подтверждённого output checkpoint
- **THEN** runtime считает его outcome неизвестным
- **AND** применяет idempotent recovery policy инструмента до нового side effect

### Requirement: AGT-004 [CONFIRMED] Очередь допускает at-least-once delivery без дубликатов результата
Task delivery MAY происходить более одного раза, но claim MUST использовать lease и heartbeat, а effectful task MUST иметь idempotency key. Истёкший lease SHALL позволять другому worker продолжить task; параллельные workers MUST NOT создавать duplicate provider jobs, artifacts, reports, notifications или state transitions.

#### Scenario: Worker потерял lease
- **WHEN** heartbeat отсутствует дольше настроенного lease timeout
- **THEN** task становится доступной для recovery claim
- **AND** прежний worker больше не может подтвердить attempt как текущий

#### Scenario: Одно событие доставлено дважды
- **WHEN** два workers получают одинаковый runnable event
- **THEN** только один effective attempt изменяет состояние
- **AND** второй delivery связывается с существующим task outcome

### Requirement: AGT-005 [CONFIRMED] Внешняя provider job получает ранний checkpoint
Если инструмент создаёт асинхронную job у внешнего провайдера, runtime MUST сохранить provider, endpoint class, remote job ID, idempotency identity и безопасные request metadata сразу после подтверждения создания job и до начала polling. Recovery MUST сначала проверить известную remote job и MUST NOT создавать новую без доказательства, что прежняя отсутствует либо безопасно завершена.

#### Scenario: Worker остановился после создания STT job
- **WHEN** remote job ID сохранён, а polling не завершён
- **THEN** новый worker продолжает polling той же job
- **AND** не загружает запись повторно

### Requirement: AGT-006 [CONFIRMED] Event triggers запускают только идемпотентные переходы
Runtime SHALL принимать зарегистрированные triggers: готовность стабильной input version, ручной запуск, завершение provider job, наступление retry/review timer, изменение разрешённой configuration version и human-resolution event. Каждый trigger MUST иметь устойчивую identity и precondition; повтор либо событие неактуальной версии MUST NOT создавать новый run или возвращать plan назад.

#### Scenario: Повторно получено событие готовности материалов
- **WHEN** trigger с теми же candidate ID и input-version уже обработан
- **THEN** runtime связывает его с существующим run
- **AND** не создаёт duplicate goal

#### Scenario: Пришёл результат старой provider job
- **WHEN** event относится к superseded attempt
- **THEN** runtime сохраняет его как late evidence
- **AND** не заменяет output текущего plan

### Requirement: AGT-007 [CONFIRMED] Память разделена по назначению и области
Runtime SHALL разделять working memory текущего run, immutable artifact/evidence memory и append-only decision/event history. Каждая запись MUST иметь candidate ID, run ID, input/profile versions, provenance, sensitivity class и retention link. Cross-candidate semantic memory MUST быть выключена по умолчанию; данные одного кандидата MUST NOT использоваться как содержательная память другого кандидата.

#### Scenario: Planner читает рабочую память
- **WHEN** planner строит следующий шаг
- **THEN** он получает только разрешённые записи текущего run и явно общие неперсональные policy artifacts
- **AND** не получает содержимое другого кандидата

#### Scenario: Рабочая гипотеза опровергнута
- **WHEN** eval gate отклоняет hypothesis
- **THEN** runtime помечает её недействующей для дальнейшего plan
- **AND** сохраняет исходную запись и решение в history

### Requirement: AGT-008 [CONFIRMED] Каждый инструмент требует ограниченный grant
Перед tool call runtime MUST проверить grant, содержащий tool capability, candidate/run/input scope, разрешённые операции, side-effect class, TTL, budget link и policy version. Отсутствующий, истёкший или превышающий scope grant MUST блокировать вызов до любого внешнего side effect и создавать policy-denial evidence.

#### Scenario: OCR task имеет read-only grant
- **WHEN** task пытается удалить Drive file
- **THEN** runtime отклоняет вызов до обращения к Drive
- **AND** сохраняет requested action, grant и причину отказа без секрета

#### Scenario: Grant относится к старой input version
- **WHEN** task пытается использовать его для новой версии материалов
- **THEN** runtime считает grant недействительным
- **AND** требует новый plan-bound grant

### Requirement: AGT-009 [CONFIRMED] Бюджеты ограничивают автономный цикл
Каждый goal SHALL иметь конфигурационные пределы wall time, task attempts, repair attempts, replan count, LLM calls, tokens/cost и external requests, а каждый task SHALL списывать фактическое использование в durable ledger. Runtime MUST резервировать достаточный остаток до effectful call, MUST NOT превышать hard limit и MUST NOT сбрасывать usage при restart либо replan.

#### Scenario: Repair budget исчерпан
- **WHEN** следующий repair превысит разрешённый предел
- **THEN** runtime не запускает repair
- **AND** создаёт obstacle `BUDGET_EXHAUSTED` для escalation либо terminal policy

#### Scenario: Worker перезапущен
- **WHEN** run продолжается после restart
- **THEN** использованный budget восстанавливается из ledger
- **AND** попытки не начинаются с нулевого счётчика

### Requirement: AGT-010 [CONFIRMED] Eval gates создают проверяемое evidence
Переход к зависимому task или публикации MUST требовать успешных применимых gates: schema validity, artifact completeness, evidence locator coverage, logical consistency, profile/input version match и side-effect readiness. Каждый gate SHALL сохранять policy/version, входные artifact identities, машинный результат, найденные violations и решение `PASS`, `REPAIRABLE`, `REPLAN_REQUIRED` либо `HUMAN_REQUIRED`.

#### Scenario: Assessment не содержит обязательный locator
- **WHEN** evidence gate находит утверждение без допустимого источника
- **THEN** публикация блокируется
- **AND** violation становится входом ограниченного repair task

#### Scenario: Все обязательные gates пройдены
- **WHEN** final artifacts соответствуют зафиксированным inputs/profile и все gates имеют `PASS`
- **THEN** goal может перейти к staged publication
- **AND** completion evidence содержит ссылки на результаты gates

### Requirement: AGT-011 [CONFIRMED] Feedback loop выполняет ограниченный repair и replan
При obstacle runtime SHALL классифицировать его как transient, repairable, replan-required, human-required или terminal. Repair MUST быть локальным, иметь ожидаемое изменение и отдельный eval; успешные совместимые artifacts MUST переиспользоваться. Replan разрешён только после неуспешного либо неприменимого repair, в пределах бюджета и зарегистрированных plan templates. Runtime MUST NOT выполнять бесконечный model-driven loop.

#### Scenario: Локальный repair успешен
- **WHEN** gate обнаруживает одну исправимую структурную ошибку результата LLM
- **THEN** runtime создаёт bounded repair task только для повреждённого output
- **AND** после `PASS` продолжает исходный plan без повторения предыдущих дорогих tasks

#### Scenario: Repair не устранил препятствие
- **WHEN** повторная eval возвращает то же violation и repair budget допускает replan
- **THEN** runtime создаёт новую plan version с альтернативной зарегистрированной веткой
- **AND** сохраняет обе попытки и причину изменения плана

### Requirement: AGT-012 [CONFIRMED] Эскалация содержит проблему и конкретное действие человека
Если препятствие требует человека либо допустимые repair/replan исчерпаны, runtime SHALL создать escalation record и перевести run в `WAITING_FOR_HUMAN`, а не в общий `FAILED`. Escalation MUST содержать goal/run, текущий stage, obstacle code и описание, влияние на результат, безопасное evidence, выполненные attempts/repairs, использованный budget, переиспользуемые artifacts и одно или несколько разрешённых concrete human actions.

#### Scenario: Повреждён обязательный файл
- **WHEN** runtime подтверждает, что запись интервью невозможно обработать автоматически
- **THEN** escalation просит HR заменить конкретный файл
- **AND** объясняет, какие этапы завершены и что будет переиспользовано после замены

#### Scenario: Эскалацию нельзя сделать содержательной
- **WHEN** runtime не может определить разрешённое действие человека или безопасно сформировать evidence
- **THEN** run переходит в terminal `FAILED` с отдельным internal error code
- **AND** не показывает выдуманную рекомендацию

### Requirement: AGT-013 [CONFIRMED] Human resolution продолжает тот же run либо явно создаёт новый
Каждое действие по escalation MUST проверять actor, ожидаемую escalation version и текущие input/profile versions. Решение, не меняющее immutable inputs, SHALL возобновлять тот же run с выбранного task и сохранёнными budgets/artifacts. Замена входного файла или профиля MUST следовать существующим правилам новой версии и создавать новый run, сохраняя связь с escalation origin.

#### Scenario: HR подтверждает допустимое неоднозначное сопоставление
- **WHEN** решение не меняет input version и разрешено escalation policy
- **THEN** тот же run выходит из `WAITING_FOR_HUMAN`
- **AND** продолжает с зависимого task без повторения завершённых этапов

#### Scenario: HR заменяет файл
- **WHEN** разрешение создаёт новую input version
- **THEN** прежний run остаётся неизменным и завершает ожидание как superseded
- **AND** новый run ссылается на исходную escalation и использует только совместимые artifacts

### Requirement: AGT-014 [CONFIRMED] Внешние side effects выполняются по staged policy
Внешний side effect SHALL быть классифицирован как read-only, idempotent-write, reversible-write либо irreversible-write. Effectful operation MUST иметь precondition gate, idempotency identity и durable intent до вызова. Reversible operations MUST иметь compensation policy; irreversible operation MUST выполняться только в последней разрешённой фазе и не должна использоваться как пробный repair.

#### Scenario: Публикация пары PDF частично завершилась
- **WHEN** первый файл создан, а второй не прошёл проверку или сохранение
- **THEN** runtime не публикует success и выполняет configured recovery либо compensation
- **AND** повтор использует те же publication identities без duplicate visible result

#### Scenario: Telegram response потерян
- **WHEN** outcome отправки неизвестен после timeout
- **THEN** outbox сохраняет неизвестный outcome и использует idempotency policy перед повтором
- **AND** candidate result не откатывается из `READY`

### Requirement: AGT-015 [CONFIRMED] Goal завершается только доказанным исходом
Goal MUST перейти в `SUCCEEDED` только когда все обязательные tasks завершены, completion criteria доказаны gate evidence и необходимые side effects подтверждены согласно policy. `WAITING_FOR_HUMAN`, `FAILED`, `CANCELLED` и `SUPERSEDED` SHALL быть отдельными исходами с причиной; отсутствие runnable tasks само по себе MUST NOT считаться успехом.

#### Scenario: Очередь пуста из-за неверного plan
- **WHEN** goal не имеет runnable tasks, но completion criteria не выполнены
- **THEN** runtime создаёт planning obstacle
- **AND** запускает разрешённый replan либо escalation вместо `SUCCEEDED`

#### Scenario: Результат полностью опубликован
- **WHEN** обязательные gates и side effects подтверждены
- **THEN** goal получает `SUCCEEDED` с completion evidence
- **AND** дальнейшая duplicate delivery не меняет итог
