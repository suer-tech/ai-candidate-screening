## MODIFIED Requirements

### Requirement: INT-015 [CONFIRMED] Извлечение аудио
Фоновый Node-процесс MUST по умолчанию извлекать первую аудиодорожку FFmpeg в M4A: совместимый AAC копируется, иначе преобразуется в AAC mono 48 kHz 96 kbit/s; видео, субтитры, data-потоки, главы и лишние metadata MUST исключаться. Если validated transcript первой дорожки проходит anomaly gate, альтернативная аудиодорожка MUST NOT обрабатываться. Если transcript аномально пуст либо неполон относительно media duration/probe evidence и контейнер содержит другую поддерживаемую дорожку с признаками речи, runtime MAY в пределах adaptive budget извлечь и проверить следующую доказуемую candidate stream. Каждая проверенная stream, причина fallback и выбранный transcript artifact MUST сохраняться раздельно; runtime MUST NOT перебирать streams бесконечно или выбирать результат только потому, что он длиннее.

#### Scenario: Несовместимый кодек
- **WHEN** выбранная по policy аудиодорожка не совместима с целевым контейнером
- **THEN** создаётся M4A с заданными параметрами AAC без остальных потоков

#### Scenario: Первая дорожка дала нормальную стенограмму
- **WHEN** transcript первой stream проходит completeness/anomaly gate
- **THEN** альтернативные streams не извлекаются и не отправляются в STT
- **AND** первая stream остаётся выбранным provenance

#### Scenario: Первая дорожка не содержит полезной речи
- **WHEN** transcript первой stream аномально пуст, а probe подтверждает другую supported stream с признаками речи
- **THEN** runtime создаёт bounded fallback attempt для конкретной альтернативной stream
- **AND** исходные audio/transcript artifacts и detector evidence сохраняются

#### Scenario: Ни одна дорожка не дала валидную стенограмму
- **WHEN** разрешённые streams и adaptive budget исчерпаны
- **THEN** runtime создаёт содержательную escalation заменить или проверить запись
- **AND** не запускает полный media pipeline заново без нового evidence

## ADDED Requirements

### Requirement: INT-023 [CONFIRMED] Качество PDF text layer проверяется до решения об OCR
Для каждой PDF page система SHALL вычислять versioned text-quality evidence, включающее наличие текста, usable-character ratio, долю replacement/control characters, extraction coverage и согласованность page boundaries. Непустой text layer MUST NOT автоматически считаться пригодным. OCR SHALL запускаться только для страниц, не прошедших quality gate; прошедшие страницы MUST переиспользовать extracted text. Raw extraction, OCR и merged successor artifact MUST сохраняться раздельно.

#### Scenario: Смешанный PDF
- **WHEN** часть страниц содержит пригодный text layer, а часть состоит из повреждённого или бессодержательного текста
- **THEN** OCR выполняется только для непройденных страниц
- **AND** итоговый документ объединяет page artifacts с method/provenance

#### Scenario: Все страницы пригодны
- **WHEN** каждая page проходит text-quality gate
- **THEN** OCR provider не вызывается
- **AND** extracted text используется без adaptive cost

#### Scenario: OCR не улучшил страницу
- **WHEN** post-OCR gate не получает пригодный successor text
- **THEN** та же page не отправляется на повторный OCR без изменившейся policy либо нового source version
- **AND** obstacle переходит к следующей разрешённой branch или escalation

### Requirement: INT-024 [CONFIRMED] Аномалия стенограммы определяется доказуемо
Transcript anomaly detector SHALL учитывать media/audio duration, provider job status, число слов/utterances, временное покрытие, speech/probe evidence и provider confidence. Одно только короткое интервью MUST NOT считаться ошибкой. Detector MUST сохранять policy version и признаки, а alternative-stream fallback MUST запускаться только для `ALTERNATIVE_PATH` outcome.

#### Scenario: Короткое, но содержательное интервью
- **WHEN** transcript короток, но имеет согласованные utterances, timestamps и покрытие обнаруженной речи
- **THEN** anomaly detector принимает его
- **AND** альтернативная stream не обрабатывается

#### Scenario: Успешная provider job вернула почти пустой текст
- **WHEN** длительная stream имеет probe evidence речи, но transcript не имеет согласованного временного покрытия
- **THEN** detector создаёт evidence-backed obstacle
- **AND** runtime проверяет зарегистрированный alternative path либо эскалирует
