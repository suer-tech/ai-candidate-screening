## ADDED Requirements

### Requirement: WF-051 [CONFIRMED] Доказательный прогресс обработки
Server projection MUST возвращать каждому кандидату `progressPercent` от 0 до 100, вычисленный только из durable candidate state и успешно завершённых canonical tasks. Значение MUST быть монотонным внутри одной input/run version, MUST NOT расти по времени и MUST сбрасываться только при создании новой версии обработки.

#### Scenario: Этап завершён
- **WHEN** canonical task успешно завершена и checkpoint сохранён
- **THEN** server projection повышает progress до зафиксированного milestone этой task

#### Scenario: Обработка ожидает человека или завершилась ошибкой
- **WHEN** run переходит в `WAITING_FOR_HUMAN` или terminal failure
- **THEN** progress сохраняет последний доказанный milestone и не имитирует дальнейшее выполнение

#### Scenario: Кандидат готов
- **WHEN** валидная пара отчётов опубликована и кандидат получает `READY`
- **THEN** `progressPercent` равен 100 независимо от отдельного состояния Telegram delivery

### Requirement: WF-052 [CONFIRMED] Полоса прогресса во всех карточках
Dashboard `Контроль очереди` и каждая карточка кандидата в общем списке MUST показывать доступную и визуально одинаковую полосу `progressPercent` для активной обработки. Полоса MUST иметь текстовое/ARIA значение; для `NEW`, archived и terminal states интерфейс MUST показывать явное состояние без выдуманного движения.

#### Scenario: HR смотрит dashboard
- **WHEN** в очереди есть обрабатываемый кандидат
- **THEN** его processing card содержит статус, время и полосу с server-derived процентом

#### Scenario: HR смотрит всех кандидатов
- **WHEN** отображается карточка того же кандидата
- **THEN** она показывает тот же процент и milestone, что dashboard
