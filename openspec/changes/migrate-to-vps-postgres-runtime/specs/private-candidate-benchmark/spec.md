## Purpose

Определяет приватный локальный benchmark на согласованном реальном кандидате, который проверяет качество сквозного pipeline без передачи эталонных отчётов приложению или внешним AI-провайдерам.

## ADDED Requirements

### Requirement: Benchmark fixtures разделяются по роли до запуска
Локальный benchmark manifest MUST явно классифицировать каждый файл как `pipeline-input`, `consent-proof`, `reference-abc`, `reference-result` либо `excluded`. Запуск MUST требовать consent-proof и MUST fail closed при неоднозначной классификации; manifest, исходные файлы и результаты MUST оставаться ignored/private.

#### Scenario: Файлы кандидата классифицированы
- **WHEN** benchmark preflight читает локальную папку `candidate`
- **THEN** он подтверждает consent, ровно один reference ABC, ровно один reference result и допустимый комплект pipeline inputs без вывода имени или содержимого

#### Scenario: Эталон попал во вход
- **WHEN** checksum reference ABC либо reference result присутствует в input manifest, upload request, provider payload или candidate Drive snapshot
- **THEN** запуск блокируется до первого provider call

### Requirement: Benchmark использует утверждённую неизменяемую версию профиля
До анализа LLM MUST сформировать draft профиля из заданного вручную названия вакансии, после чего HR MUST просмотреть, при необходимости отредактировать и явно утвердить exact version. Ignored local approval pack MUST содержать schema/version, checksum exact profile snapshot и approval metadata без данных кандидата. Полный benchmark MUST использовать только этот snapshot и MUST fail closed до первого чтения pipeline inputs или provider call при отсутствии approval, несовпадении checksum либо попытке новой неявной генерации. Reference ABC/result, extracted anchors и любые reference-derived данные MUST NOT использоваться для создания или изменения профиля.

#### Scenario: Утверждённый профиль отсутствует или изменён
- **WHEN** approval pack отсутствует либо checksum текущего profile snapshot не совпадает с утверждённым
- **THEN** benchmark завершается `PROFILE_APPROVAL_REQUIRED` до чтения материалов кандидата и внешних вызовов

#### Scenario: Benchmark повторяется после изменения модели или prompt
- **WHEN** запускается новый quality iteration
- **THEN** используется тот же утверждённый profile snapshot и его fingerprint входит в evidence
- **AND** новая недетерминированная генерация профиля не подменяет основание сравнения

### Requirement: Эталонные документы доступны только offline oracle
Reference ABC/result MUST читаться только локальным benchmark oracle после завершения generation. Их текст, bytes, embeddings, extracted anchors и filenames MUST NOT передаваться web/API приложения, Google Drive candidate input, RouterAI, AssemblyAI, Telegram или любой сетевой endpoint.

#### Scenario: Формируется provider trace
- **WHEN** pipeline вызывает внешний provider
- **THEN** network audit доказывает отсутствие reference checksums и reference-derived text в request

### Requirement: Oracle использует версионируемые критические критерии
Ignored local oracle manifest MUST содержать version, checksum утверждённого profile snapshot, expected recommendation class, ABC direction grades, critical fact/risk/contradiction anchors и обязательные report sections. Oracle MUST отказываться от сравнения при несовпадении profile checksum. GREEN MUST требовать: exact recommendation; 100% обязательных sections; 100% significant generated claims с допустимым evidence locator; не менее 85% critical anchor recall; не менее 80% совпадения ABC grades без инверсии `A↔C`; ноль invented stop-factors. Пороговые значения MUST быть versioned и изменение порога MUST инвалидировать прежнее evidence.

#### Scenario: Результат критично отличается
- **WHEN** хотя бы один hard criterion не выполнен
- **THEN** benchmark завершается RED с агрегированными категориями расхождения без персонального текста
- **AND** release блокируется до исправления и повторного полного запуска

#### Scenario: Формулировка отличается, смысл подтверждён
- **WHEN** generated report использует иной текст, но structured fact соответствует anchor и имеет допустимый locator
- **THEN** oracle оценивает факт по нормализованной структуре, а не по дословному совпадению PDF

### Requirement: Benchmark исполняет полный реальный pipeline
Benchmark MUST на локальном PostgreSQL выполнить discovery/provision, document extraction/OCR, media extraction, AssemblyAI, RouterAI evidence/assessment, deterministic recommendation, validation, два PDF, controlled publication и notification boundary. По умолчанию visible Drive/Telegram effects MUST быть shadow; отдельный effectful run MAY выполняться только с явным флагом и automatic cleanup.

#### Scenario: Benchmark завершён
- **WHEN** все provider stages и oracle gates завершились
- **THEN** evidence содержит build/config/model/schema/oracle fingerprints, stage outcomes, cleanup confirmations и агрегированные scores без credentials, provider IDs, Drive IDs и персонального текста

### Requirement: Benchmark не загрязняет product state
После каждого GREEN или RED запуска MUST удаляться benchmark candidate/runtime/domain/blob/notification state, созданные Google Drive объекты, provider remote media и временные файлы. До human review ровно два generated PDF MAY сохраняться только в ignored private evidence directory с ограниченными правами, checksum, build/run/profile fingerprints и hard retention deadline; они MUST NOT загружаться обратно в приложение, Drive или provider. После review либо истечения retention отдельный cleanup MUST удалить эти PDF и сохранить агрегированное deletion evidence. Failure любой обязательной фазы cleanup MUST делать evidence неприемлемым.

#### Scenario: Oracle вернул RED
- **WHEN** качество не прошло порог
- **THEN** provider/application/Drive/temp cleanup всё равно выполняется и отдельно подтверждается до возврата команды
- **AND** generated PDF доступны только локальному human review до retention deadline

#### Scenario: Human review завершён
- **WHEN** HR подтвердил завершение review либо наступил retention deadline
- **THEN** обе generated PDF удаляются из private evidence directory
- **AND** evidence подтверждает отсутствие app/Drive/provider/temp/generated-PDF remnants без filenames и персонального текста
