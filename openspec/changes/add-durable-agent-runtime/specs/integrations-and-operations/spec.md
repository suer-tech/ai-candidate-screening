## MODIFIED Requirements

### Requirement: OPS-003 [CONFIRMED] Тайм-ауты и повторы
Каждый tool task MUST иметь конфигурационный timeout, ограниченные attempts и отдельный error code. Стартовая конфигурация MUST задавать: Google Drive и короткие внешние запросы — 60 секунд и не более 3 attempts всего; FFmpeg — 20 минут и не более 1 retry; ожидание результата задания AssemblyAI — 60 минут, а отдельные сетевые запросы к нему — 60 секунд и не более 3 attempts всего; OCR RouterAI — 3 минуты на страницу и не более 2 retries; анализ RouterAI — 10 минут и не более 2 retries; валидация и сохранение — 2 минуты и не более 3 attempts всего. Между доступными same-task retries MUST применяться задержки 5, 15 и 45 секунд в указанном порядке. Изменение этих значений по фактическим метрикам MUST выполняться конфигурацией и MUST NOT требовать изменения business logic.

Same-task automatic retry MUST применяться только к network error, timeout, HTTP 429 или HTTP 5xx. Повреждённый либо неподдерживаемый обязательный файл, HTTP 4xx кроме 429 и invalid input/output MUST завершать текущий attempt без бессмысленного same-call retry. После этого agent runtime MUST классифицировать obstacle и выполнить только зарегистрированный bounded repair/replan, создать содержательную escalation `WAITING_FOR_HUMAN` либо завершить run терминальным `FAILED`. Repair/replan MUST иметь отдельные budgets и MUST NOT маскироваться под новый retry того же вызова. Частичный отчёт и уведомление об успехе MUST NOT публиковаться. Recovery MUST начинаться с минимального необходимого task и переиспользовать совместимые результаты завершённых дорогих этапов; замена необрабатываемого обязательного файла MUST создавать новую input version по WF-014.

#### Scenario: Этап завис
- **WHEN** tool task превышает свой timeout
- **THEN** временная ошибка повторяется по конфигурационной retry policy и backoff
- **AND** после исчерпания attempts runtime классифицирует obstacle для repair, replan, escalation либо terminal outcome

#### Scenario: Входной файл повреждён
- **WHEN** extraction обнаруживает повреждённый или неподдерживаемый обязательный файл
- **THEN** same-task retry и автоматическая частичная публикация не выполняются
- **AND** кандидат получает `WAITING_FOR_HUMAN` с требованием заменить конкретный материал и описанием переиспользуемых artifacts

#### Scenario: Настройка уточнена по метрикам
- **WHEN** IT изменяет timeout, attempts или agent budget в допустимой configuration
- **THEN** новая policy version применяется только к новым attempts согласно compatibility rules
- **AND** изменение не требует изменения business logic

#### Scenario: Выход модели невалиден
- **WHEN** eval gate классифицирует output как repairable
- **THEN** runtime не повторяет тот же вызов бесконтрольно
- **AND** создаёт отдельный bounded repair task с собственным expected output, attempt и budget

### Requirement: OPS-006 [CONFIRMED] Фоновая среда медиаобработки
FFmpeg, ожидание AssemblyAI и другие long-running/effectful agent tasks MUST выполняться вне Cloudflare Worker request lifecycle в постоянно работающем background Node runtime с временным диском, разрешёнными secrets, durable task claim и heartbeat. Веб-приложение MAY публиковать trigger и отслеживать run, но MUST NOT удерживать HTTP request до завершения workflow. Перезапуск background process MUST восстанавливать tasks из persistent queue и checkpoints.

#### Scenario: Загружено видео
- **WHEN** веб-приложение принимает trigger обработки
- **THEN** оно сохраняет trigger и передаёт long-running медиа tasks фоновому Node runtime
- **AND** HTTP request завершается без ожидания FFmpeg или AssemblyAI

#### Scenario: Background process перезапущен
- **WHEN** worker запускается после остановки с незавершёнными tasks
- **THEN** он восстанавливает eligible tasks после проверки leases и checkpoints
- **AND** не создаёт duplicate provider jobs или outputs
