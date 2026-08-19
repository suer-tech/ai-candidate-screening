## 1. Независимый приёмочный baseline

- [x] 1.1 Независимому субагенту добавить исполняемые TST-094–TST-097 для real-data queue, canonical status cards, period charts, recommendations и Drive indicator.
- [x] 1.2 Запустить сценарии на static/demo dashboard и зафиксировать ожидаемый RED.

## 2. Dashboard read model

- [x] 2.1 Реализовать единый server-side snapshot текущих non-archived candidates, archived candidate count, active-vacancy flow series, current runs и latest actual result versions.
- [x] 2.2 Рассчитывать exact separate counts для `MATERIALS_INCOMPLETE`, `TRANSCRIBING`, `ANALYZING`, `VALIDATING`, `READY`, `FAILED` и отдельной lifecycle-card `Архив`, без primary `WAITING_FOR_STABILITY`, combined processing, `Активные вакансии`, score/ratings/HR decision state.
- [x] 2.3 Формировать queue top-5: terminal failures первыми, затем самые старые текущие processing runs с stage, elapsed и canonical ETA/fallback.

## 3. Периодные показатели

- [x] 3.1 Реализовать общий period selector `7/30/90` дней для dashboard graphs.
- [x] 3.2 Строить поток кандидатов по локальной дате последней актуальной успешной обработки, считать кандидата один раз и исключать прежний success при latest `FAILED`.
- [x] 3.3 Строить результаты анализа только по четырём canonical recommendation categories без процентов общего score или demo labels.
- [x] 3.4 Группировать flow series по active vacancy ID и использовать явно определённые inclusive period boundaries.

## 4. Dashboard UI и интеграции

- [x] 4.1 Реализовать responsive seven-card layout с отдельными `Транскрибация`, `AI-анализ`, `Проверка результатов`, card `Архив`, доступной amber/indigo/green/red/gray status palette и только real snapshot.
- [x] 4.2 Реализовать приветствие по UTC+5 с границами утро `05:00`, день `12:00`, вечер `18:00`.
- [x] 4.3 Реализовать Drive indicator с polling каждые 15 секунд и состояниями `Подключён`, `Проверяем подключение`, `Нет подключения` без ручного recovery.
- [x] 4.4 Не добавлять отдельный error panel, demo controls или post-MVP recruiter analytics; ошибки показывать в queue и candidate card.

## 5. Проверка и release gate

- [x] 5.1 Довести acceptance и focused aggregation/timezone/Drive/UI tests до GREEN, включая exact seven cards, отсутствие primary stability/combined processing, separate exact filters, responsive layout, archive semantics и accessible colors.
- [x] 5.2 Запустить применимые unit, acceptance, lint, TypeScript и build проверки.
- [x] 5.3 Зафиксировать evidence real-data snapshot, archive summary semantics, insufficient ETA, latest FAILED exclusion и все три Drive states.
- [ ] 5.4 Запустить на provisioned production-like окружении полный набор `E2E-VAC-001`, `E2E-TRN-001`, `E2E-ABC-001`, `E2E-RESULT-001`.
