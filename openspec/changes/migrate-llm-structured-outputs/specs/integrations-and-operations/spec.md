## ADDED Requirements

### Requirement: INT-023 [CONFIRMED] Строгий структурированный ответ передаётся транспортным контрактом
Для каждого LLM-вызова с версионируемым структурированным результатом система MUST передавать ожидаемую JSON Schema через специальное поле OpenAI-compatible API `response_format` с типом `json_schema` и строгим соблюдением схемы. Сериализованная JSON Schema MUST NOT дублироваться в system-, user- или repair-промпте. Сервер MUST сохранять короткую семантическую инструкцию вернуть структурированный результат и MUST независимо валидировать полученный ответ по ожидаемой версии схемы.

#### Scenario: Выполняется структурированный LLM-вызов
- **WHEN** сервер отправляет RouterAI запрос для capability со схемой ответа
- **THEN** provider request содержит `response_format.type = json_schema`, безопасное имя схемы, `strict = true` и точную версионируемую JSON Schema
- **AND** сообщения запроса не содержат сериализованную JSON Schema

#### Scenario: Провайдер вернул JSON по строгой схеме
- **WHEN** RouterAI завершил Structured Outputs запрос без отказа или обрезания
- **THEN** сервер разбирает и независимо валидирует ответ по ожидаемой `schemaVersion`
- **AND** исходный provider envelope сохраняется по действующим правилам трассировки

#### Scenario: Модель отказалась отвечать или ответ был обрезан
- **WHEN** provider envelope содержит refusal, незавершённый ответ или finish reason ограничения длины
- **THEN** сервер не считает отсутствующий schema-valid JSON успешным результатом
- **AND** возвращает типизированную безопасную ошибку для действующей retry/recovery policy

### Requirement: INT-024 [CONFIRMED] Structured Outputs конфигурируется fail-closed
Каждый используемый provider/model profile MUST явно декларировать поддержку Structured Outputs. До начала обработки система MUST проверить, что все выбранные response-schema artifacts совместимы с поддерживаемым strict subset JSON Schema. Отсутствующая поддержка, открытые объектные формы, несовместимые ключевые слова или неполный строгий контракт MUST блокировать готовность конфигурации. Система MUST NOT автоматически возвращаться к `json_object`, prompt-embedded schema или свободному тексту.

#### Scenario: Выбранная модель поддерживает Structured Outputs
- **WHEN** runtime загружает provider/model profile с явной поддержкой Structured Outputs и совместимыми схемами
- **THEN** конфигурация принимается и capability может выполнять запросы

#### Scenario: Поддержка модели не объявлена
- **WHEN** schema-bearing capability ссылается на provider/model profile без явной поддержки Structured Outputs
- **THEN** runtime отклоняет конфигурацию до выполнения LLM-вызова
- **AND** не включает legacy fallback

#### Scenario: Схема несовместима со strict subset
- **WHEN** response-schema artifact содержит запрещённую открытую объектную форму, необъявленное свойство или иное неподдерживаемое ограничение
- **THEN** runtime отклоняет конфигурацию с безопасной диагностикой, идентифицирующей artifact, но не раскрывающей секреты

### Requirement: INT-025 [CONFIRMED] Транспортная схема воспроизводима в защищённой трассе
Защищённая трасса каждого Structured Outputs вызова MUST однозначно фиксировать идентификатор, версию и hash response-schema artifact, фактически использованный response format и strict mode. Трасса MUST позволять доказать соответствие provider request ожидаемой схеме без сохранения credential или transport headers.

#### Scenario: Администратор проверяет структурированный вызов
- **WHEN** технический администратор исследует защищённую LLM-трассу
- **THEN** трасса однозначно показывает schema artifact, его hash и фактически отправленный strict response format
- **AND** не содержит API-ключа или authorization header
