## MODIFIED Requirements

### Requirement: INT-022 [CONFIRMED] Воспроизводимость AI
Система MUST применять единый trace contract ко всем LLM calls/attempts: vacancy generation, OCR, speaker mapping, assessment, validation/repair и future agent/tool subcalls. Для каждого call SHALL сохраняться protected exact exchange, self-contained input snapshot, actual provider/endpoint/model, instruction/prompt/tool/schema versions, generation/execution parameters, correlation/timing/error metadata, raw response, normalized output and migration chain по `llm-tracing-and-configuration`. AssemblyAI STT SHALL оставаться отдельным technical journal. Для файла без OCR metadata MUST явно показывать отсутствие OCR call.

#### Scenario: Аудит анализа
- **WHEN** administrator открывает trace конкретной result version
- **THEN** доступны every related LLM attempt, exact exchange and effective config
- **AND** correlation связывает calls с input/profile/result versions

#### Scenario: Аудит распознавания документа
- **WHEN** документ обработан OCR capability
- **THEN** protected trace содержит exact OCR LLM exchange, self-contained input snapshot и effective config
- **AND** при отсутствии OCR call metadata явно фиксирует, что распознавание моделью не выполнялось

#### Scenario: Speaker mapping выполнен
- **WHEN** LLM определяет speaker roles
- **THEN** mapping call использует тот же protected trace contract
- **AND** original STT journal остаётся отдельным

## ADDED Requirements

### Requirement: INT-050 [CONFIRMED] Logical capability определяет LLM configuration boundary
Каждый LLM caller MUST передавать logical capability and business correlation context в общий server-side gateway. Gateway SHALL resolve schema-validated effective non-secret config and runtime secrets without exposing direct provider calls or credentials client-side. Provider/model literals MUST NOT быть обязательной частью business rules.

#### Scenario: OCR capability вызвана
- **WHEN** workflow требует OCR
- **THEN** gateway resolves OCR-specific provider/model/prompt/schema config
- **AND** actual effective values сохраняются в trace
