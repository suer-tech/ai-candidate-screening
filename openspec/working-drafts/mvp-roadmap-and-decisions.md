# MVP roadmap и реестр продуктовых решений

**Статус: WORKING DRAFT / НЕНОРМАТИВНЫЙ LIVING DOCUMENT.**

## 1. Назначение и правила использования

Этот документ сохраняет проектно-релевантные факты, подтверждённые решения владельца, результаты UI-аудита и открытые вопросы из рабочих обсуждений. Он не является main spec, proposal, design, tasks или delta spec и не заменяет OpenSpec planning artifacts.

Main specifications в `openspec/specs/` остаются единственным каноническим источником требований. Любое подтверждённое решение ниже, которое расходится с main specs, становится нормативным только после отдельного reviewed OpenSpec change, проверки согласованности delta specs и синхронизации с main specs. До этого реализация следует main specs.

Active changes описывают предлагаемые изменения, но не заменяют main specs до синхронизации. По явному полномочию владельца оставшиеся вопросы MAY закрываться наиболее обоснованным вариантом только с пометкой `DEFAULTED BY OWNER AUTHORIZATION`, кратким rationale и сохранением конфликтов с main specs.

## 2. MVP roadmap

### Этап 1. Фундамент и эксплуатационный контур

**Цель:** создать безопасную и наблюдаемую основу для всех пользовательских сценариев.

**Канонические области:** `product-scope`, `integrations-and-operations`, `data-and-security`, `quality-gates`.

**Результат:** авторизованный контур единой роли HR; конфигурация и секреты интеграций; устойчивые ID и версии; аудит; защищённые соединения; контролируемые логи без ПДн и секретов; тестовые данные, cleanup и обязательный E2E-контур.

### Этап 2. Профиль вакансии

**Цель:** создать валидную вакансию и неизменяемую версию полного профиля оценки, пригодную для всех потребителей.

**Каноническая область:** `vacancy-profile`.

**Текущий change:** `validate-vacancy-abc-profile` ограничен в реализации валидацией ABC-направлений перед сохранением; полный capability-контракт в main specs шире этого implementation slice.

**Следующий planning step:** отдельный reviewed change должен согласовать новый ручной create-vacancy flow с требованиями активации, версионирования, шаблона ABC, Drive folder binding и quality gates.

### Этап 3. Приём кандидата и lifecycle

**Цель:** обнаружить кандидата в Google Drive, устойчиво связать его с вакансией и управлять комплектом материалов и lifecycle без дублей.

**Канонические области:** `candidate-workflow`, `data-and-security`.

**Результат:** внутренний UUID и связь с Drive Folder ID; ожидание стабильности; проверка минимального комплекта; наблюдаемая state machine; версии входов; архивирование, восстановление и каскадное удаление по правилам ПДн.

### Этап 4. Извлечение и транскрибация

**Цель:** получить проверяемый текст из резюме и интервью для последующей оценки.

**Канонические области:** `candidate-workflow`, `integrations-and-operations`, `data-and-security`.

**Результат:** извлечение PDF/DOCX, OCR сканированных страниц, определение медиаконтейнера по содержимому, стенограмма со спикерами, таймкодами и confidence, безопасное повторное использование завершённых дорогих этапов.

### Этап 5. Оценка и доказательность

**Цель:** применить зафиксированную версию профиля и сформировать воспроизводимый результат без подмены решения HR.

**Каноническая область:** `assessment-and-evidence`.

**Результат:** доказательства и локаторы; ABC как информационный блок; обязательный опыт, компетенции, стоп-факторы, риски, конфликты и пробелы; итоговая категория; отдельный автоматический допуск к КЕ; доказательное сравнение двух-трёх сопоставимых кандидатов без общего рейтинга.

### Этап 6. Результаты и уведомления

**Цель:** опубликовать согласованный результат, сохранить нормативные артефакты и дать HR безопасный доступ.

**Каноническая область:** `reporting-and-notifications`.

**Текущий change:** `add-in-app-report-preview` содержит planning artifacts для двух PDF, защищённого in-app preview и отдельного экспорта; восемь продуктовых вопросов закрыты в рабочем реестре, но решения должны быть согласованно перенесены в reviewed artifacts до реализации.

**Результат:** валидная пара PDF одной версии, статус `READY` только после проверки пары, краткая сводка, уведомление, защищённый просмотр и однозначный экспорт.

### Этап 7. E2E MVP и релизная готовность

**Цель:** доказать сквозное поведение на наблюдаемых пользовательских сценариях и безопасно очистить тестовые данные.

**Каноническая область:** `quality-gates`.

**Обязательный контур:** `E2E-VAC-001`, `E2E-TRN-001`, `E2E-ABC-001`, `E2E-RESULT-001`; independently authored acceptance tests; ожидаемо падающий тест до реализации; полный regression после изменений кода, моделей, инструкций, схем или интеграций.

## 3. Подтверждённые продуктовые решения

### 3.1. Просмотр и скачивание результатов

1. Сценарий входит в MVP. Google Shared Drive остаётся хранилищем и архивом, но HR не должен переходить туда для чтения готового результата.
2. После успешной обработки система автоматически создаёт и сохраняет два нормативных PDF: `Итоги по кандидату` и `ABC-тест`.
3. В разделе `Материалы` карточки кандидата показываются только две кнопки результатов последней успешной версии: `Итоги` и `ABC-тест`.
4. Во время первой обработки результатные элементы, placeholders и disabled-кнопки не показываются. Они появляются только после публикации валидной пары.
5. Прежние версии результатов HR не показываются и не доступны для просмотра или скачивания из карточки.
6. При запуске повторной обработки прежняя пара сразу скрывается до публикации новой валидной пары; старая пара не показывается как fallback.
7. Каждый PDF открывается без ручной подготовки в защищённом read-only modal поверх карточки. Приложение проверяет доступ, не раскрывает прямой публичный URL Drive и не уводит HR из приложения.
8. После закрытия modal карточка возвращается к обычному состоянию по умолчанию; сохранять вкладку, scroll, раскрытые блоки, выбранную историю или focus не требуется.
9. В modal доступны стандартные действия PDF viewer: чтение, scroll, zoom, поиск, печать и сохранение/скачивание только открытого документа.
10. Общая кнопка `Скачать отчёт` удаляется. Каждый документ скачивается отдельно и только из его modal; единого неопределённого скачивания нет.
11. Краткая сводка с рекомендацией остаётся в карточке кандидата.
12. Недоступный, повреждённый, неопубликованный PDF или version mismatch не должен давать ложный успех. `READY` допустим только для валидной согласованной пары одной актуальной версии.
13. При временной ошибке открытия modal показывает понятное сообщение и только действие закрытия; ручные recovery-действия HR не требуются.
14. **SUPERSEDED В ЧАСТИ КНОПКИ.** Ранее было зафиксировано, что при ошибке обработки HR видит понятный статус без кнопки ручного повтора. Актуальное решение сохраняет автоматические попытки, но после их исчерпания показывает отдельную кнопку ручной повторной обработки кандидату `FAILED`; правило уточнено в разделе 3.5.
15. Отдельный audit-event каждого preview не требуется. Обычная история анализа сохраняется, а действующие правила аудита экспорта и скачивания не меняются.

### 3.2. Создание вакансии

1. Название вакансии обязательно и уникально. Сравнение выполняется без учёта регистра и лишних пробелов.
2. `Новая вакансия` запускает последовательный полноценный интерфейс. Первый экран содержит только обязательное название; затем HR сразу вручную настраивает параметры оценки и полный профиль.
3. В flow нет кнопки `Сформировать черновик`, начальный профиль не генерируется LLM.
4. После заполнения параметров действие называется `Сохранить вакансию`. В UI не используются ярлык `черновик` и действие `Сохранить как черновик`.
5. После успешного сохранения вакансия автоматически становится активной и сразу участвует в candidate intake и analysis. Отдельных UI-состояний и кнопок preview или activation нет.
6. Сразу после успешного сохранения система автоматически создаёт отдельную папку вакансии в Google Shared Drive и связывает её с `vacancy ID`.
7. Создание и связывание папки идемпотентно: повтор использует уже связанную папку и не создаёт дубль.
8. Ранее обсуждавшееся решение о сохранённой неактивной вакансии с отдельными preview и activation отменено и не должно использоваться.

### 3.3. UI первого MVP

1. Кнопка `На следующий этап` удаляется.
2. Процесс приложения завершается на готовом кандидате и опубликованных отчётах/материалах для HR.
3. Приложение не хранит кадровое решение HR и не вводит hiring pipeline state. Возврат к этому сценарию возможен post-MVP только через отдельный reviewed change.
4. Раздел и верхний пункт навигации `Аналитика` полностью скрываются. Не показываются `Скоро`, disabled-control или demo-заглушка.

### 3.4. Архивирование кандидата

1. Кандидата нельзя архивировать, пока его workflow находится в processing, включая подготовку материалов, транскрибацию, анализ и валидацию.
2. Archive action недоступно и не выполняется до завершения processing.
3. Активный run не требуется отменять, приостанавливать или завершать из-за archive action, поскольку такой action во время processing не допускается.
4. Окончательное удаление кандидата доступно только после его архивации.
5. Окончательное удаление удаляет только данные приложения. Приложение никогда не удаляет папки или файлы Google Drive и не требует от HR удалять их вручную.
6. Отдельный status или очередь незавершённой Drive-cleanup не нужны. Любой ранее обсуждавшийся вариант с контролем удаления Drive-папки отменён.
7. Восстановление кандидата из архива обязательно записывается в аудит наряду с archive и delete.

### 3.5. Ручный запуск повторной обработки

1. В карточке кандидата нужна отдельная кнопка ручного запуска повторной обработки.
2. HR использует её после изменения материалов в связанной папке кандидата Google Drive.
3. Изменение файлов само по себе не запускает повторную обработку автоматически.
4. Ручной запуск создаёт новый run и новую версию результата по canonical version rules, не перезаписывая прежнюю версию.
5. Кнопка показывается в карточке кандидата со статусом `READY` и в карточке кандидата со статусом `FAILED` после исчерпания автоматических повторов.
6. Пока текущая обработка продолжается, кнопка остаётся видимой, но disabled. Понятное доступное пояснение сообщает, что повтор станет доступен после завершения текущего запуска.
7. Нажатие доступной кнопки открывает confirmation dialog. Предупреждение сообщает HR, что предыдущие результаты станут недоступны и данные кандидата будут обновлены.
8. После явного подтверждения система сначала выполняет стандартную проверку стабильности файлов в связанной папке кандидата Google Drive.
9. Новая обработка автоматически запускается только после успешного подтверждения стабильности. До этого run не стартует.
10. Отмена dialog не запускает проверку или run и не изменяет данные кандидата.
11. Перед реализацией требуется отдельный reviewed OpenSpec change и согласованный UI flow.

### 3.6. Основная задача MVP dashboard

1. MVP dashboard одновременно обеспечивает контроль текущей обработки кандидатов и ошибок.
2. Тот же dashboard даёт обзор готовых результатов кандидатов и candidate archive; active vacancies представлены только series графика `Поток кандидатов`, без отдельной summary-card.
3. Обе части являются операционным назначением MVP dashboard и не относятся к скрытой post-MVP аналитике качества работы рекрутеров.
4. Текущая визуальная структура и назначение блока `Контроль очереди` подходят для MVP и сохраняются.
5. Будущая реализация заменяет demo/static data блока реальными canonical workflow stage/status и elapsed time.
6. Числовой ETA показывается только при выполнении условий main specs; иначе используется точный текст `Недостаточно данных для прогноза`.
7. Сохранение layout не подтверждает текущие demo labels, hardcoded counts или расчёты времени.
8. Текущая визуальная структура малых summary cards кандидатов под очередью сохраняется для MVP.
9. Labels и counts summary cards строятся по актуальным canonical workflow statuses. Primary dashboard показывает `Недостаточно материалов`, отдельные `Транскрибация`, `AI-анализ`, `Проверка результатов`, затем `Готово`, `Ошибка`; `WAITING_FOR_STABILITY` остаётся queue/detail stage без primary card. Demo ratings, общий score и несуществующее состояние кадрового решения HR запрещены.
10. Demo-card `Ожидают решения` и её rating/decision семантика не сохраняются.
11. Summary-card `Активные вакансии` удаляется; в той же группе показывается lifecycle-card `Архив` с количеством всех архивированных кандидатов, archive filter и empty state `В архиве кандидатов нет.`
12. Semantic tones cards: недостаточно материалов — amber/yellow, `Транскрибация`, `AI-анализ` и `Проверка результатов` — различимые indigo/violet tones, готово — green, ошибка — red, архив — gray; text labels/counts сохраняются, recommendation colors не смешиваются со status palette.
13. График `Поток кандидатов` сохраняется в MVP и отображает реальные данные вместо demo/static values.
13. Блок `Результаты анализа` сохраняется и использует только четыре canonical recommendation categories: `Не рекомендовать`, `Недостаточно данных`, `Рекомендовать с оговорками`, `Рекомендовать`.
14. В `Результатах анализа` отсутствуют проценты соответствия, общий score и demo labels `Сильное соответствие`/`С рисками`; counts строятся из реальных canonical результатов.
15. Приветствие `Доброе утро`/`Добрый день`/`Добрый вечер` автоматически определяется по локальному времени `UTC+5`.
16. Dashboard-графики имеют рабочий period selector со значениями `7`, `30` и `90 дней`.
17. В графике `Поток кандидатов` кандидат учитывается в день успешного завершения обработки, а не в день первого обнаружения.
18. При повторной обработке dashboard учитывает каждого кандидата только один раз — по последней актуальной успешной версии результата; прежние result versions не добавляют counts.
19. Если последняя повторная обработка завершилась `FAILED`, прежний successful result исключается из dashboard graphs, summary и recommendation counts; до новой успешной актуальной версии ошибка кандидата показывается только в существующем блоке `Контроль очереди` и карточке кандидата.
20. В MVP не создаётся отдельный dashboard-блок ошибок, error summary, error list или error panel.
21. Индикатор Google Drive сохраняется в MVP, отражает реальное состояние интеграции и обновляется по результату проверки подключения каждые `15 секунд`.
22. Drive-индикатор имеет три пользовательских состояния: `Подключён`, `Проверяем подключение`, `Нет подключения`.
23. Точные границы приветствия, правила подсчёта, дополнительные filters, состав series, layout canonical status cards, recovery-actions Drive-индикатора и состав остальных blocks, metrics, states и actions требуют отдельного reviewed OpenSpec change или UI contract.

### 3.7. LLM tracing and configuration

**Статус:** WORKING DRAFT. Этот раздел не является main spec и не разрешает реализацию нового поведения без reviewed OpenSpec change.

**Canonical baseline:** `INT-020` и `INT-022` задают серверный AI-контур и воспроизводимость analysis/OCR через provider, base URL без секретов, model/version, instruction version, schema versions, run parameters, input IDs, неизменный raw response, normalized result и migration chain. `VAC-038/039` задают более узкие metadata для vacancy generation; `INT-010` сохраняет model/instruction version для speaker-role mapping. `SEC-003/006/010` запрещают секреты и полный персональный текст в technical logs, а `SEC-007` включает raw/normalized AI responses в каскадное удаление. `SEC-005` и `OPS-003/004` покрывают business audit, attempts, errors, timings и configuration version.

**Gap:** единого контракта для всех LLM calls нет. Main specs не гарантируют сохранение точных ordered messages, context/content blocks, tool definitions/calls/results, provider request IDs, usage/finish reasons, полной generation configuration, parent-child correlation, каждой retry-attempt и защищённого trace-store lifecycle. В текущей реализации отсутствуют RouterAI client, persistent audit/trace schema и общий correlation contract; существующий AssemblyAI pipeline сохраняет raw STT response и normalized transcript, но не является общей LLM tracing реализацией.

**Цель:** обеспечить единую полную трассировку всех LLM calls, включая vacancy generation, OCR, assessment, validation/repair и будущие agent/tool subcalls, так, чтобы уполномоченный оператор мог восстановить точный исторический exchange — request context/messages, response и tool calls — с привязкой к business run, inputs, configuration и attempts. AssemblyAI STT не входит в LLM trace contract и сохраняется в отдельном technical journal. Для каждого отдельного LLM-вызова/attempt и каждой обработки запроса trace store сохраняет собственную копию использованных материалов и входного снимка; trace record должна быть самодостаточной и не может заменять этот снимок общей reference или dedup link. Protected trace хранит exact full content без redaction или masking. Deterministic re-execution того же ответа не требуется и не обещается. Полный LLM exchange с PII хранится в отдельном защищённом trace store, а обычные technical logs содержат только IDs/metadata без полного content. Конкретная технология trace store намеренно не фиксируется; модель доступа и lifecycle должна быть определена отдельным reviewed OpenSpec change до реализации.

**Retention:** каждый protected LLM trace хранится ровно `30 дней` и не удаляется раньше при окончательном удалении кандидата из приложения. Это подтверждённое исключение конфликтует с текущим cascade deletion `SEC-007` и требует будущего reviewed security-spec change до реализации.

**Trace availability:** недоступность записи protected trace не блокирует LLM call или workflow; processing продолжается по fail-open policy. Система обязательно создаёт observability incident/metadata record о неполной трассировке без full content.

**Реестр решений владельца:** все 10 вопросов закрыты.

1. **RESOLVED.** Цель — только точное историческое восстановление request/response/tool-call exchange. Deterministic re-execution одного и того же ответа не требуется и не обещается.
2. **RESOLVED.** Полный LLM exchange с PII хранится в отдельном защищённом trace store. Обычные technical logs содержат только IDs/metadata без полного content. Конкретная технология хранилища намеренно отложена.
3. **RESOLVED.** Для каждого LLM-вызова/attempt и каждой обработки запроса trace store сохраняет отдельную копию использованных материалов и входного снимка. Общая reference, hash или dedup link не заменяют эту копию: каждая trace record должна быть самодостаточной для точного исторического восстановления.
4. **RESOLVED.** Единый trace contract обязателен для всех LLM calls: vacancy generation, OCR, assessment, validation/repair и будущих agent/tool subcalls. AssemblyAI STT не входит в LLM trace contract и сохраняется в отдельном technical journal.
5. **RESOLVED.** Полный protected LLM trace с prompts и PII доступен только техническому администратору. HR не получает доступ.
6. **RESOLVED.** Каждый protected LLM trace хранится ровно `30 дней` и не удаляется раньше, даже если кандидат окончательно удалён из приложения до истечения этого срока. Это подтверждённое исключение из текущего `SEC-007`, а не изменение main spec без reviewed change.
7. **RESOLVED.** Protected trace хранит exact full content без redaction или masking, чтобы исторический LLM exchange был полностью восстановим. Ordinary technical logs по-прежнему содержат только IDs/metadata и не содержат full content.
8. **RESOLVED.** Если запись protected trace недоступна, LLM call и workflow не блокируются: processing продолжается по fail-open policy. Обязателен observability incident/metadata record о неполной трассировке без full content.
9. **RESOLVED.** MVP не требует отдельного integrity/tamper-evidence mechanism для protected traces: append-only semantics, hash chain и signature не являются обязательными.
10. **RESOLVED.** В MVP не нужен отдельный UI или export для просмотра protected traces. Техническому администратору достаточно прямого доступа к защищённому trace store и логам; HR доступа не получает.

**Будущий planning step:** несмотря на закрытие всех 10 вопросов, до реализации требуется отдельный reviewed OpenSpec change. Каталог change пока не создан.

**Будущий reviewed change должен закрепить:**

1. Единый data/correlation contract для всех LLM calls, attempts, messages, responses, tool calls и самодостаточных input snapshots.
2. Границу protected trace store и ordinary technical logs, exact full content без redaction в trace и metadata-only incident/log records.
3. Доступ только технического администратора без HR access, отдельного MVP UI и export.
4. Retention ровно `30 дней`, включая подтверждённое исключение из cascade deletion `SEC-007`, и соответствующий security-spec delta.
5. Fail-open поведение при недоступности trace write и обязательный observability incident о неполной трассировке.
6. Отсутствие обязательного integrity/tamper-evidence mechanism в MVP и отдельный technical journal для AssemblyAI STT.
7. Vendor-neutral configuration boundaries для provider/model/prompt versions и исполняемые security, deletion, failure и trace quality gates.

**Configuration defaults по полномочию владельца:**

1. **DEFAULTED BY OWNER AUTHORIZATION.** Deployment использует отдельные logical services для web/API и background workflow/media/AI processing; persistent application data и protected traces имеют отдельные storage boundaries. Container orchestration MAY быть реализована Docker Compose на одном сервере, но product contract не зависит от конкретного orchestrator. **Rationale:** media/long-running work уже запрещено выполнять в request lifecycle, а vendor-neutral service boundaries сохраняют переносимость.
2. **DEFAULTED BY OWNER AUTHORIZATION.** Non-secret runtime config проходит schema validation при startup и фиксируется immutable snapshot для каждого run. При invalid config service не становится ready; config changes применяются после controlled restart, без hot reload в MVP. **Rationale:** воспроизводимость важнее оперативного изменения параметров без restart.
3. **DEFAULTED BY OWNER AUTHORIZATION.** Business code выбирает logical capability, а runtime config отдельно сопоставляет её provider profile, model identifier, prompt version, schema version, limits, timeout и retry policy. Неявный model fallback отключён; любой fallback должен быть явно сконфигурирован и отражён в trace. **Rationale:** исключить незаметную смену поведения модели.
4. **DEFAULTED BY OWNER AUTHORIZATION.** Prompt templates, tool schemas, response schemas, safe config defaults и их versions/hashes хранятся в version control как reviewed immutable release artifacts. Rendered prompts и candidate content хранятся только в protected trace. **Rationale:** review/versioning исходников без помещения PII в репозиторий.
5. **DEFAULTED BY OWNER AUTHORIZATION.** API keys, service-account credentials, tokens, encryption keys и secret-bearing URLs поступают только из runtime secret boundary; они не хранятся в VCS, image, compose manifest, CLI arguments, ordinary logs или protected exchange content. **Rationale:** согласованность с `SEC-003` и отсутствие credential leakage.
6. **DEFAULTED BY OWNER AUTHORIZATION.** В MVP нет operator UI для изменения model/prompt config; технический администратор управляет reviewed config artifacts и runtime secrets, а deployment сохраняет effective non-secret config snapshot. **Rationale:** минимальный контролируемый operational surface.
7. **DEFAULTED BY OWNER AUTHORIZATION.** Exact provider/model values остаются deployment config и не закрепляются product spec; trace сохраняет фактически использованные значения. **Rationale:** vendor-neutral OpenSpec при полной исторической наблюдаемости.

## 4. Конфликты main specs и подтверждённых решений

Эти пункты нельзя реализовывать как новое нормативное поведение до reviewed change.

### 4.1. Create-vacancy flow

- Ручная настройка без LLM и без `Сформировать вакансию` конфликтует с `VAC-030–033`, `VAC-037–039`, где задан серверный LLM-flow, структурированный сгенерированный черновик и его обработка.
- Отказ от термина и состояния `черновик` затрагивает `VAC-015–021`, `VAC-030–037` и связанные quality gates, где черновик является отдельным редактируемым состоянием.
- Автоматическая активация сразу после `Сохранить вакансию` и отсутствие preview/activation конфликтуют с `VAC-014`, `VAC-019–021`, где обязательны preview, явное утверждение HR и отдельная активация валидной неизменяемой версии.
- Уникальность названия вакансии и автоматическое идемпотентное создание Drive-папки требуют новых нормативных требований и quality gates; текущие main specs не задают полный контракт этих действий.
- Судьба `VAC-039` и смежных ссылок на LLM после удаления генерации из create flow не определена.

### 4.2. История результатов и повторная обработка

- Показ только последней версии и отсутствие доступа HR к прежним версиям конфликтуют с `REP-004`, где история версий отчёта должна быть доступна.
- Немедленное скрытие прежней пары при повторной обработке конфликтует с `WF-014` и `WF-031`, где прежний результат остаётся доступным и неизменным.
- Подтверждённый flow сохраняет ключевые ограничения `WF-014/WF-031`: изменение файлов само не запускает анализ, используются стабильные входы, а новый run создаёт новую result version.
- Порядок отличается от текущего `WF-014`: main spec сначала стабилизирует новую версию и затем ожидает manual launch, а подтверждённое решение сначала принимает manual confirmation, после него выполняет stability check и автоматически стартует при её успехе. Этот порядок требует reviewed delta.
- Доступность той же кнопки для `FAILED` после исчерпания автоматических повторов соответствует обязательному ручному retry из `PRD-020` и `WF-023`. Ранее записанное решение об отсутствии кнопки для processing error отменено в этой части и должно быть согласованно исправлено в связанных working/planning artifacts будущего change.
- In-app modal, отсутствие публичного Drive URL, две именованные кнопки и отдельное скачивание расширяют main specs и не противоречат им сами по себе, но требуют reviewed delta и quality gates.

### 4.3. UI без отдельного workflow HR

- Удаление `На следующий этап` и отказ от hiring pipeline state соответствуют текущей границе main specs: система поддерживает решение HR, но не хранит кадровое решение и не описывает рекрутинговую воронку.
- Скрытие `Аналитики` совместимо с `PRD-021`, где аналитика качества работы рекрутеров отложена post-MVP. Это не отменяет обязательный операционный dashboard, очередь, статусы, ошибки и фильтры из main specs.

### 4.4. Удаление кандидата и Google Drive

- Решение считать удаление завершённым после очистки только данных приложения и никогда не требовать удаления Drive-папки конфликтует с `SEC-007`, где полное удаление завершается только после отсутствия исходной папки и HR должен удалить её отдельно.
- Новый lifecycle prerequisite `delete only after archive`, отсутствие Drive-cleanup status/queue и обязательный audit-event восстановления требуют отдельного нормативного контракта и обновления связанных quality gates.
- Минимальная tombstone и защита от повторного обнаружения прежнего Drive Folder ID должны быть согласованы в будущем change с новым правилом, по которому исходная папка может оставаться в Drive постоянно.

### 4.5. Retention protected LLM traces

- Подтверждённое решение сохранять protected LLM trace с PII ровно `30 дней` и не удалять его раньше при окончательном удалении кандидата прямо конфликтует с `SEC-007`, где исходные и нормализованные AI-ответы, технические JSON и другие производные данные должны удаляться каскадно вместе с кандидатом.
- Это решение является рабочим подтверждённым исключением, но не заменяет canonical `SEC-007` до отдельного reviewed security-spec change, согласованных retention/deletion quality gates и синхронизации main specs.

## 5. Закрытые defaults и UI-сценарии для planning changes

### 5.1. Архивирование, восстановление и удаление кандидата

**Подтверждённые решения:** archive action недоступно во время processing; delete доступно только после archive; delete очищает только данные приложения и не удаляет и не требует удалять Drive-папки/файлы; Drive-cleanup status/queue отсутствуют; restore обязательно аудируется.

Открытых вопросов по archive lifecycle не осталось.

**Уже определено main specs:** archive обратим, сохраняет все данные и прежнее workflow-state, скрывает кандидата из active/default surfaces и отключает автоматические запуски/уведомления; restore не запускает анализ; delete требует подтверждения, удаляет внутренние и производные данные и сохраняет минимальную tombstone без ПДн. Текущее требование main specs о ручном удалении исходной Drive-папки конфликтует с подтверждённым решением и остаётся каноническим до reviewed change.

### 5.2. Demo controls и фильтры

1. **DEFAULTED BY OWNER AUTHORIZATION.** No-op `Фильтры`, `Экспорт` в vacancy candidate table и `Найти вакансию` удаляются из MVP. **Rationale:** отсутствующий spec scope нельзя заменять demo promise.

**Уже определено main specs:** функциональные фильтры общей очереди по вакансии и явный архивный фильтр входят в MVP; архивные кандидаты не входят в `Все` и другие active/default surfaces. Экспорт готового результата кандидата нормативен, экспорт списка кандидатов — нет.

### 5.3. Статусы кандидата

1. **DEFAULTED BY OWNER AUTHORIZATION.** Labels: `Новый`, `Ожидание стабильности`, `Недостаточно материалов`, `Материалы готовы`, `Транскрибация`, `Анализ`, `Проверка результата`, `Готово`, `Ошибка`. Archive — отдельный lifecycle badge. **Rationale:** прямое отображение canonical state machine.
2. **DEFAULTED BY OWNER AUTHORIZATION.** Stage boundaries: STT start -> `TRANSCRIBING`; first assessment call after prerequisites -> `ANALYZING`; structured response received and checks started -> `VALIDATING`. **Rationale:** provider-neutral observable events.
3. **DEFAULTED BY OWNER AUTHORIZATION.** Primary badge reflects current input/run; after new inputs or confirmed reprocess old `READY` is not shown as current success. **Rationale:** status must describe current processing truth.

**Наблюдаемые проблемы demo:** отсутствуют отдельные `WAITING_FOR_STABILITY`, `MATERIALS_READY`, `VALIDATING`, `FAILED`; `Нужны материалы` расходится с нормативным `Недостаточно материалов`; `Проверка файлов` используется как top-level status без canonical аналога; `В архиве` ошибочно заменяет workflow-state; `Готов` показывается без доказанной валидной пары PDF; progress-тексты смешаны с recommendation.

### 5.4. Create-vacancy UI

1. **DEFAULTED BY OWNER AUTHORIZATION.** Unsaved state не сохраняется; modified navigation требует discard confirmation, reload очищает форму. **Rationale:** отсутствие скрытого draft lifecycle.
2. **DEFAULTED BY OWNER AUTHORIZATION.** Редактор получает независимую копию стандартного ABC template; reset с подтверждением возвращает initial template. **Rationale:** ручной flow сохраняет каноническую non-LLM starting point.
3. **DEFAULTED BY OWNER AUTHORIZATION.** Generation-specific `VAC-030–039` и tests удаляются, скрытого альтернативного LLM create flow нет. **Rationale:** один однозначный create contract.
4. **DEFAULTED BY OWNER AUTHORIZATION.** Save считается успешным только после idempotent Drive folder binding; до этого vacancy не active. **Rationale:** исключить active vacancy без intake folder.

### 5.5. Точные UI-сценарии, требующие фиксации

1. Для archive/restore/delete нужны наблюдаемые сценарии расположения controls, подтверждения удаления, очистки только данных приложения без Drive-cleanup и возврата в прежнее состояние.
2. Для status UI нужны сценарии каждого canonical состояния, terminal error, insufficient materials, недостаточной ETA-выборки и coexistence старого READY с новым run.
3. Для create-vacancy нужны сценарии validation обязательного уникального названия, ручного заполнения, save+automatic activation, идемпотентного Drive folder binding и recovery при ошибке сохранения/создания папки.
4. Для report preview продуктовые вопросы закрыты; перед реализацией нужны coherent reviewed artifacts и acceptance scenarios пары документов, version binding, modal, отдельного download и отказов.
5. Для ручной повторной обработки нужны сценарии обнаружения новой версии материалов, доступности кнопки у `READY`, доступности после исчерпания automatic retries у `FAILED`, видимого disabled-состояния с пояснением во время active run, confirmation dialog с предупреждением, безопасной отмены, stability check после подтверждения, запрета запуска до успешной стабилизации и создания нового run/result version.

## 6. Связанные рабочие материалы

- Main specs: `openspec/specs/`.
- Карта документации: `docs/README.md`.
- Архитектура: `docs/ARCHITECTURE.md`.
- Реестр create-vacancy flow: `openspec/working-drafts/create-vacancy-flow-open-questions.md`.
- Реестр UI-аудита: `openspec/working-drafts/ui-audit-decisions.md`.
- Реестр dashboard-решений: `openspec/working-drafts/dashboard-decisions.md`.
- LLM tracing/configuration: рабочий раздел 3.7 этого документа; перед реализацией требуется отдельный reviewed OpenSpec change, каталог пока не создан.
- Реестр вопросов preview: `openspec/changes/add-in-app-report-preview/open-questions.md`.
- Active change preview: `openspec/changes/add-in-app-report-preview/`.
- Active change ABC validation: `openspec/changes/validate-vacancy-abc-profile/`.
- Архив миграции исходных требований: `openspec/changes/archive/2026-08-18-migrate-requirements-to-openspec/`.

## 7. Журнал решений

### 2026-08-19. Источник требований

- Main specs признаны единственным каноническим источником; working drafts сохраняют обсуждение, но не разрешают реализацию против main specs.

### 2026-08-19. Просмотр результатов в приложении

- Подтверждены две кнопки последней пары PDF, защищённый read-only modal, отсутствие перехода в Drive, отдельное скачивание из modal, удаление общей кнопки download и сохранение краткой сводки.
- Последовательно закрыты вопросы истории в карточке, поведения при reprocess/error/первой обработке, modal close, PDF viewer controls, ошибки открытия и аудита preview.

### 2026-08-19. Create-vacancy flow

- Подтверждены обязательное уникальное название, последовательный ручной editor и отсутствие LLM-генерации.
- Первоначальное решение о сохранении без активации с отдельными preview/activation отменено.
- Актуальное решение: `Сохранить вакансию` автоматически активирует её и запускает идемпотентное создание/связывание папки Google Shared Drive.

### 2026-08-19. UI первого MVP

- `На следующий этап` удаляется; кадровое решение и hiring pipeline не хранятся.
- Верхняя `Аналитика` полностью скрывается без placeholder.
- Archive action недоступно во время processing; архивировать активный run нельзя.
- Окончательное удаление кандидата доступно только после его архивации.
- Delete очищает только данные приложения; приложение не удаляет и не требует удаления Drive-папок/файлов, отдельного Drive-cleanup status нет.
- Restore обязательно фиксируется в аудите наряду с archive/delete; archive lifecycle questions закрыты.
- В карточке кандидата подтверждена отдельная кнопка ручной повторной обработки после изменения материалов; она доступна у `READY` и terminal `FAILED` после исчерпания automatic retries, а во время active run остаётся видимой disabled с пояснением; после confirmation система сначала проверяет стабильность Drive-файлов и только затем автоматически запускает новый run/result version.
- MVP dashboard объединяет контроль processing/errors с обзором ready results и candidate archive; active vacancies представлены flow series без отдельной summary-card.
- Текущая визуальная структура `Контроль очереди` сохраняется для MVP, но demo/static data заменяются canonical stage/status, elapsed time и допустимым ETA либо `Недостаточно данных для прогноза`.
- Layout малых summary cards под очередью сохраняется и адаптивно перестраивается для семи: `Недостаточно материалов`, `Транскрибация`, `AI-анализ`, `Проверка результатов`, `Готово`, `Ошибка`, `Архив`. `Ожидание стабильности` не является primary dashboard card; processing stages не объединяются. Demo ratings, общий score и HR decision state запрещены.
- Summary-card `Активные вакансии` заменена на lifecycle-card `Архив`: count всех archived candidates, нейтральное оформление, переход в archive filter и empty state `В архиве кандидатов нет.`; archive не становится workflow status.
- График `Поток кандидатов` сохраняется в MVP и переводится с demo/static values на реальные данные.
- `Результаты анализа` сохраняются только с четырьмя canonical recommendation categories без процентов, общего score и demo labels.
- Dashboard greeting автоматически выбирает утро/день/вечер по локальному времени `UTC+5`.
- Для dashboard-графиков подтверждён рабочий period selector `7`/`30`/`90 дней`.
- `Поток кандидатов` учитывает кандидата по дате успешного завершения обработки, а не по дате первого обнаружения.
- При повторной обработке dashboard считает кандидата один раз по последней актуальной успешной версии; прежние result versions не создают дополнительных counts.
- После `FAILED` повторной обработки прежний successful result исключается из dashboard graphs/summary/recommendation counts; ошибка отображается только в `Контроле очереди` и карточке кандидата до новой успешной актуальной версии.
- Отдельные dashboard error summary/list/panel в MVP не создаются.
- Индикатор Google Drive сохраняется, показывает реальное состояние интеграции, проверяет подключение каждые `15 секунд` и использует состояния `Подключён`, `Проверяем подключение`, `Нет подключения`.

### 2026-08-19. LLM tracing and configuration

- Зафиксирована цель полной трассировки всех LLM calls, canonical gap и реестр 10 product/security questions для последовательного решения владельцем.
- Вопрос 1 закрыт: требуется точное историческое восстановление exchange без требования или обещания deterministic re-execution.
- Вопрос 2 закрыт: полный PII-bearing LLM exchange хранится в отдельном защищённом trace store, ordinary technical logs содержат только IDs/metadata; технология хранилища не фиксируется.
- Вопрос 3 закрыт: каждый LLM call/attempt и каждая обработка запроса получают отдельную самодостаточную копию материалов/input snapshot; общая reference/hash/dedup link не заменяет её.
- Вопрос 4 закрыт: единый trace contract охватывает vacancy generation, OCR, assessment, validation/repair и будущие agent/tool subcalls; AssemblyAI STT ведётся отдельно в technical journal.
- Вопрос 5 закрыт: полный protected LLM trace с prompts/PII доступен только техническому администратору; HR доступа не получает.
- Вопрос 6 закрыт: protected LLM trace хранится ровно `30 дней` и не удаляется раньше при окончательном удалении кандидата. Конфликт с cascade deletion `SEC-007` требует reviewed security-spec change.
- Вопрос 7 закрыт: protected trace сохраняет exact full content без redaction/masking для полного исторического восстановления; ordinary logs остаются без full content.
- Вопрос 8 закрыт: недоступность protected trace write не блокирует LLM call/workflow; processing продолжается fail-open, а система обязательно сохраняет observability incident/metadata record о неполной трассировке без full content.
- Вопрос 9 закрыт: MVP не требует отдельного append-only/hash-chain/signature механизма integrity/tamper evidence для protected traces.
- Вопрос 10 закрыт: отдельный UI/export для protected traces в MVP не нужен; техническому администратору достаточно доступа к trace store и логам, HR доступа не получает.
- Набор из 10 LLM tracing questions полностью закрыт. До реализации всё равно требуется отдельный reviewed OpenSpec change для trace/correlation data model, protected-store/log boundary, admin-only access, 30-day retention и исключения из `SEC-007`, fail-open incident, AssemblyAI journal, configuration boundary и quality gates.

### 2026-08-19. UI-аудит controls и lifecycle

- Подтверждено фактическое demo-поведение: `Фильтры` и `Экспорт` в вакансии, а также поиск вакансии являются no-op controls; общие candidate filters работают, но archive ошибочно попадает в default surfaces.
- Текущий archive существует только в локальном UI-state; restore, delete, persistence, audit и cleanup отсутствуют.
- Demo status labels не реализуют полную canonical state machine и смешивают workflow-stage, recommendation и progress message.
