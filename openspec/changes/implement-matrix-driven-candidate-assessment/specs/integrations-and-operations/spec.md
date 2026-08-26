## ADDED Requirements

### Requirement: INT-030 Versioned assessment skills
Компиляция, однократная критика с непосредственным редактированием итоговой матрицы, извлечение claims, поиск непредусмотренных сигналов, оценка unmapped risk, независимая проверка critical risk, консолидация, глобальный конфликтный проход, заполнение строк, ABC и независимая верификация MUST использовать отдельно версионируемые instruction и response schema artifacts через защищённый server-side LLM gateway. Каждая стадия MUST сохранять фактическую конфигурацию и protected trace.

#### Scenario: Skill завершил вызов
- **WHEN** структурированный ответ принят
- **THEN** audit содержит skill, instruction, schema, model/configuration, входные artifact IDs и trace ID без секретов

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
