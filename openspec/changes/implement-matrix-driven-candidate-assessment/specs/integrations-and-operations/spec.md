## ADDED Requirements

### Requirement: INT-032 Готовая текстовая стенограмма без STT
Поддерживаемая готовая текстовая стенограмма MUST преобразовываться в versioned `transcript-bundle` того же downstream-контракта, что и результат распознавания записи. Для неё runtime MUST NOT вызывать FFmpeg/media processor или AssemblyAI. Исходный текст, имя и immutable версия файла, порядок реплик, явно указанные speaker labels и явно указанные таймкоды MUST сохраняться. Если таймкодов нет, runtime MUST сохранять устойчивую адресацию по строкам и MUST NOT выдавать синтетическое время за исходный таймкод. Пустой или неразбираемый текст MUST завершаться типизированной ошибкой.

#### Scenario: Готовая стенограмма содержит speaker labels и таймкоды
- **WHEN** candidate workflow обрабатывает поддерживаемый текстовый файл стенограммы
- **THEN** runtime создаёт `transcript-bundle` с исходным текстом и нормализованными репликами
- **AND** downstream этапы получают обычный transcript artifact
- **AND** media processor и AssemblyAI не вызываются

#### Scenario: В готовой стенограмме нет таймкодов
- **WHEN** непустой текст содержит реплики без временных отметок
- **THEN** реплики сохраняют порядок и номера исходных строк
- **AND** пользовательские evidence locators ссылаются на строки, а не на выдуманное время

### Requirement: INT-033 Несколько источников интервью
Все поддерживаемые записи и готовые стенограммы из immutable input manifest MUST быть обработаны в рамках одной transcription stage и объединены в один совместимый `transcript-bundle`. Каждая реплика MUST сохранять source file ID/version/name и локальный таймкод либо line locator своего файла. Speaker labels и одинаковые локальные таймкоды разных файлов MUST NOT смешивать provenance. Сбой одного обязательного interview-source MUST завершать transcription stage типизированной ошибкой без частичного молчаливого анализа остальных источников.

#### Scenario: Две записи и одна готовая стенограмма
- **WHEN** manifest содержит несколько поддерживаемых interview-source
- **THEN** runtime обрабатывает каждый из них и создаёт один transcript artifact
- **AND** downstream batching получает реплики всех источников с различимой provenance

### Requirement: INT-030 Versioned assessment skills
Компиляция, однократный fail-soft critic-editor, batch coverage extraction, gap-search, консолидация, поиск реальных конфликтов, сбалансированные дополнительные наблюдения, попунктное заполнение строк, мягкая проверка стоп-факторов/существенно отказных выводов и итоговый синтез MUST использовать отдельно версионируемые instruction и response schema artifacts через защищённый server-side LLM gateway. Каждая стадия MUST сохранять фактическую конфигурацию и protected trace. Batch extraction и gap-search MUST NOT принимать итоговые кадровые решения.

#### Scenario: Skill завершил вызов
- **WHEN** структурированный ответ принят
- **THEN** audit содержит skill, instruction, schema, model/configuration, входные artifact IDs и trace ID без секретов

### Requirement: INT-031 Ограниченный составитель единого отчёта
`compose-candidate-report/v1` MUST быть отдельной versioned capability со structured response schema. Она MUST получать только компактные validated artifacts и HR-safe evidence catalog, не raw resume/transcript, и MUST NOT иметь tools или side effects. Provider timeout/schema/reference failure MUST быть fail-soft и активировать deterministic report fallback.

#### Scenario: Composer вызывает provider
- **WHEN** validation stage завершён успешно
- **THEN** protected trace фиксирует versioned instruction/schema/model и artifact refs, не сохраняя raw candidate materials в пользовательском отчёте

### Requirement: OPS-020 Бюджет матричной компиляции
Один provider call компиляции или критика-редактора MUST иметь конфигурационный timeout не более 10 минут. Одна compilation attempt MUST включать один compiler call и один critic-editor call без отдельного repair и повторной критики. 30-минутный ориентир MUST оставаться наблюдаемой метрикой, а не hard timeout всей обработки.

#### Scenario: Компиляция продолжается больше 30 минут
- **WHEN** допустимые вызовы продолжают штатное выполнение после ориентира
- **THEN** система фиксирует превышение и не завершает процесс только из-за общего времени

### Requirement: OPS-021 Поэтапный routing
Matrix-driven workflow MUST поддерживать `disabled`, `shadow` и `production` routing. Shadow mode MUST сохранять отдельные артефакты и метрики, но MUST NOT изменять видимый результат, PDF или Telegram. Rollback MUST влиять только на новые запуски и MUST NOT смешивать workflow versions в существующем run.

#### Scenario: Shadow mode включён
- **WHEN** legacy workflow формирует пользовательский результат
- **THEN** matrix-driven workflow MAY выполняться параллельно без пользовательских side effects
