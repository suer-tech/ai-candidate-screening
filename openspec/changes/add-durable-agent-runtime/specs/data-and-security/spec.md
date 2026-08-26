## MODIFIED Requirements

### Requirement: SEC-005 [CONFIRMED] Журнал действий
Аудит MUST фиксировать доступ к карточке; создание, изменение, активацию и удаление вакансии; создание, перемещение, архивирование и удаление кандидата; добавление и замену материалов; запуск и повтор анализа; выбор версии профиля для нового запуска; экспорт данных; а также создание goal/plan, tool grant/denial, attempt/checkpoint, budget decision, eval result, repair, replan, escalation, human resolution, compensation и terminal outcome. Каждая запись agent runtime MUST содержать actor/worker, policy и plan versions, object identities и безопасную причину без полного персонального содержимого, secrets или скрытых provider instructions. Каждый absolute timestamp аудита MUST храниться в UTC ISO 8601; отображение MUST использовать `Asia/Yekaterinburg` с явным `+05:00`. Операция изменения готового результата MUST отсутствовать в пользовательском интерфейсе и прикладном API.

#### Scenario: HR запускает новую версию вместо изменения результата
- **WHEN** авторизованный HR после изменения материалов явно запускает новый анализ
- **THEN** журнал содержит событие, субъект, объект, версии входов и профиля и время запуска
- **AND** прежний результат остаётся неизменным

#### Scenario: Кандидат перемещён между вакансиями
- **WHEN** HR меняет связь кандидата с вакансией
- **THEN** журнал содержит пользователя, кандидата, прежнюю и новую вакансии и время

#### Scenario: Agent изменил план
- **WHEN** runtime создаёт новую plan version после obstacle
- **THEN** аудит содержит прежний и новый plan, obstacle, policy, budget usage и reused artifacts
- **AND** не содержит полный текст резюме, стенограммы или секреты

#### Scenario: Tool call запрещён
- **WHEN** grant check отклоняет действие
- **THEN** аудит содержит requested capability, scope и безопасную причину denial
- **AND** внешний side effect отсутствует

## ADDED Requirements

### Requirement: SEC-011 [CONFIRMED] Agent memory и runtime records входят в lifecycle кандидата
Working memory, artifact metadata, goals, plans, tasks, attempts, checkpoints, eval results, escalations, budget ledger и tool grants SHALL считаться производными данными кандидата. Они MUST следовать его access, archive, retention и cascade-deletion policy по SEC-007. После удаления персональные payloads MUST быть удалены; минимальная неперсональная tombstone MAY сохранять только техническую identity и состояние cleanup.

#### Scenario: Кандидат удалён
- **WHEN** запускается cascade deletion
- **THEN** runtime отменяет leases и pending tasks, отзывает grants и удаляет personal memory/evidence payloads
- **AND** дальнейший trigger не возобновляет run по tombstoned candidate identity

#### Scenario: Кандидат архивирован
- **WHEN** кандидат получает archive lifecycle flag
- **THEN** новые automatic triggers и notifications для его runs блокируются
- **AND** существующие records сохраняются по retention policy и доступны только через разрешённый archive access

### Requirement: SEC-012 [CONFIRMED] Tool grants применяют наименьшие права
Grant MUST разрешать только минимальный capability и side-effect class, необходимые конкретному task, и MUST NOT содержать provider secret. Runtime SHALL получать secret через разрешённый server-side secret mechanism только после успешной grant/policy проверки. Planner и LLM MUST NOT самостоятельно расширять grant, TTL или scope.

#### Scenario: Planner запрашивает расширение прав
- **WHEN** proposed task требует capability вне зарегистрированной policy
- **THEN** runtime не выпускает grant и не передаёт secret
- **AND** создаёт policy obstacle для registered replan либо escalation

#### Scenario: Grant истёк
- **WHEN** worker начинает tool call после TTL
- **THEN** вызов блокируется до любого provider request
- **AND** runtime требует новый policy-authorized grant

### Requirement: SEC-013 [CONFIRMED] Agent context минимизирует персональные данные
Каждый planner, evaluator и repair call MUST получать только поля и artifacts, необходимые его bounded task. Full resume, transcript или cross-artifact context MUST NOT передаваться, если task может быть выполнен по меньшему scoped representation. Context manifest SHALL сохранять identities и purpose без дублирования полного содержимого в технических логах.

#### Scenario: Repair исправляет один evidence locator
- **WHEN** repair task относится к одному утверждению
- **THEN** model context ограничивается утверждением, допустимыми source fragments и schema
- **AND** не включает несвязанные персональные разделы или данные других кандидатов
