## Purpose

Определяет наблюдаемый операционный dashboard MVP для контроля workflow, ошибок, candidate archive, актуальных результатов, active-vacancy flow series и состояния Google Drive без recruiter analytics и вымышленных score.

## ADDED Requirements

### Requirement: DASH-001 [CONFIRMED] Dashboard использует реальные данные и локальное приветствие
Dashboard SHALL одновременно показывать контроль processing/errors, candidate archive и обзор current results. Active vacancies MAY присутствовать как series графика `Поток кандидатов`, но summary-card `Активные вакансии` MUST отсутствовать. Demo/static values MUST NOT отображаться как реальные. Greeting SHALL использовать display name текущего HR и время `UTC+5`: `Доброе утро` 05:00–11:59, `Добрый день` 12:00–17:59, `Добрый вечер` 18:00–04:59.

#### Scenario: HR открывает dashboard вечером
- **WHEN** local time `Asia/Yekaterinburg` равно 19:00
- **THEN** dashboard показывает `Добрый вечер` и display name текущего HR
- **AND** blocks получают current persisted data

### Requirement: DASH-002 [CONFIRMED] Контроль очереди показывает current stages и terminal errors
Block `Контроль очереди` SHALL показывать terminal errors первыми, затем active processing runs от старого start time к новому, максимум пять records и action `Вся очередь`. Record MUST содержать candidate, vacancy, canonical status/stage, elapsed time и numeric ETA только по WF-032; иначе точный текст `Недостаточно данных для прогноза`. Error details SHALL быть доступны в record/card; отдельный error panel MUST отсутствовать.

#### Scenario: Есть errors и processing
- **WHEN** dashboard получает terminal failures и active runs
- **THEN** failures расположены первыми, затем runs по ascending start time
- **AND** отображается не более пяти records с переходом во всю очередь

#### Scenario: ETA sample недостаточна
- **WHEN** WF-032 не разрешает numeric ETA
- **THEN** record показывает `Недостаточно данных для прогноза`
- **AND** не показывает demo либо guessed duration

### Requirement: DASH-003 [CONFIRMED] Summary cards отражают canonical workflow semantics
Dashboard SHALL показывать ровно семь primary summary cards: `Недостаточно материалов`, `Транскрибация`, `AI-анализ`, `Проверка результатов`, `Готово`, `Ошибка` для current non-archived candidates и lifecycle-card `Архив` для всех archived candidates. Processing cards MUST соответствовать exact canonical states `TRANSCRIBING`, `ANALYZING` и `VALIDATING`, иметь отдельные counts и MUST NOT объединяться. Technical states `NEW`, `WAITING_FOR_STABILITY` и `MATERIALS_READY` MUST NOT иметь primary summary card, но MAY оставаться видимыми как current stage в queue или candidate detail. Cards SHALL иметь доступные semantic tones: insufficient materials — amber/yellow, processing stages — distinguishable indigo/violet tones, ready — green, failed — red, archived — gray. Color MUST NOT быть единственным индикатором: каждая card сохраняет текстовый label, count и exact filter semantics. Recommendation colors MUST оставаться отдельными и не переопределяться status palette. `Архив` MUST NOT считаться workflow status, MUST показывать точное число archived candidates, включая `0`, и SHALL использовать нейтральное lifecycle-оформление. Click workflow-card SHALL открыть general queue с фильтром соответствующего canonical state; click `Архив` SHALL открыть general queue с archive filter и семантическим empty state `В архиве кандидатов нет.` при нулевом результате. Seven-card layout SHALL адаптировать число колонок к доступной ширине без изменения порядка, labels или counts. Ratings, general score, HR decision state, combined processing card, primary card `Ожидание стабильности` и summary-card `Активные вакансии` MUST отсутствовать.

#### Scenario: Processing stages рассчитаны отдельно
- **WHEN** current candidates находятся в `TRANSCRIBING`, `ANALYZING` и `VALIDATING`
- **THEN** cards `Транскрибация`, `AI-анализ` и `Проверка результатов` показывают отдельные counts своих exact states
- **AND** click каждой card фильтрует queue только по соответствующему state

#### Scenario: Technical stability stage не занимает primary card
- **WHEN** current candidate находится в `WAITING_FOR_STABILITY`
- **THEN** primary summary не содержит card `Ожидание стабильности` и не включает кандидата в другую summary card
- **AND** queue или candidate detail MAY продолжать показывать его canonical technical stage

#### Scenario: Error card выбрана
- **WHEN** HR нажимает `Ошибка`
- **THEN** открывается general queue с canonical `FAILED` filter
- **AND** не создаётся отдельная error list на dashboard

#### Scenario: Archive card выбрана
- **WHEN** HR нажимает `Архив`
- **THEN** открывается general queue с lifecycle archive filter
- **AND** count включает archived candidates независимо от их сохранённого workflow status
- **AND** при пустом архиве dashboard показывает `0`, а queue показывает `В архиве кандидатов нет.`

#### Scenario: Status cards различимы без цвета
- **WHEN** dashboard отображается без восприятия цвета
- **THEN** insufficient, transcription, analysis, validation, ready, failed и archive остаются различимы по text label и count
- **AND** color palette не изменяет recommendation-category semantics

### Requirement: DASH-004 [CONFIRMED] Dashboard graphs имеют единый period selector
Graphs SHALL иметь selector `7`, `30`, `90 дней`. Period MUST включать current local calendar date и предыдущие `N-1` dates в `Asia/Yekaterinburg`. Selection SHALL применяться к `Поток кандидатов` и `Результаты анализа`; нулевые даты MUST сохраняться, отсутствие data MUST показываться empty state без demo values.

#### Scenario: Выбран период 30 дней
- **WHEN** HR выбирает `30 дней`
- **THEN** оба graph blocks используют одну 30-day date range
- **AND** data вне range не учитываются

### Requirement: DASH-005 [CONFIRMED] Поток кандидатов считает current successful results по vacancies
Graph `Поток кандидатов` SHALL иметь отдельную series для каждой active vacancy и считать current non-archived candidate один раз по local date завершения последней актуальной successful result version. Detection date и prior result versions MUST NOT создавать count. Если latest reprocess terminal `FAILED`, old success MUST быть исключён до новой successful current version.

#### Scenario: Candidate повторно успешно обработан
- **WHEN** current successful version завершена в другой день, чем prior version
- **THEN** candidate учитывается один раз в date current version
- **AND** prior date больше не содержит его count

#### Scenario: Latest reprocess failed
- **WHEN** latest current run завершился `FAILED`
- **THEN** candidate отсутствует во всех flow series
- **AND** остаётся видимым в queue/error status card и candidate card

### Requirement: DASH-006 [CONFIRMED] Результаты анализа используют четыре recommendation categories
Block `Результаты анализа` SHALL считать current non-archived `READY` candidates в выбранном period по ровно четырём categories: `Не рекомендовать`, `Недостаточно данных`, `Рекомендовать с оговорками`, `Рекомендовать`. Percent match, general score и demo labels MUST отсутствовать. Category click SHALL открыть filtered general queue. Candidate с latest `FAILED` MUST отсутствовать до нового current success.

#### Scenario: Recommendation category выбрана
- **WHEN** HR выбирает `Рекомендовать с оговорками`
- **THEN** открывается queue с этим canonical result filter и той же date range
- **AND** candidate counts совпадают с dashboard block

### Requirement: DASH-007 [CONFIRMED] Google Drive indicator отражает live integration state
Dashboard SHALL проверять Drive connectivity каждые 15 секунд и показывать ровно `Подключён`, `Проверяем подключение`, `Нет подключения`. Initial и in-flight check MUST показывать `Проверяем подключение`; success — `Подключён`; failed check — `Нет подключения`. Manual recovery action MUST отсутствовать.

#### Scenario: Connectivity check выполняется
- **WHEN** начинается очередной check
- **THEN** indicator показывает `Проверяем подключение`
- **AND** после result переходит в одно terminal display state до следующего check

### Requirement: DASH-008 [CONFIRMED] Dashboard не включает post-MVP или demo behavior
MVP dashboard MUST NOT показывать recruiter quality analytics, HR decision state, list export, separate error panel, static delta badges, demo ratings либо unsupported filters/actions.

#### Scenario: Dashboard принят для MVP
- **WHEN** acceptance перечисляет interactive controls и visible labels
- **THEN** каждый control имеет contract из этой capability либо linked main spec
- **AND** unsupported demo controls отсутствуют
