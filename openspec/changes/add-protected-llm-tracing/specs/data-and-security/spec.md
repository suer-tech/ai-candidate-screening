## MODIFIED Requirements

### Requirement: SEC-006 [CONFIRMED] Минимизация технических логов
Ordinary technical/client logs MUST NOT содержать full resume, transcript, prompts, LLM request/response/tool content, protected input snapshots или integration secrets. Они MAY содержать diagnostic IDs, provider/model metadata без secrets, timings, safe errors и incomplete-tracing incidents. Exact full LLM content с PII SHALL храниться только в protected trace store по capability `llm-tracing-and-configuration`.

#### Scenario: Компонент пишет ошибку
- **WHEN** component пишет ordinary log о call либо trace failure
- **THEN** log содержит correlation IDs и safe metadata
- **AND** full content, PII payload и secrets отсутствуют

### Requirement: SEC-007 [CONFIRMED] Архивирование и каскадное удаление
Archive SHALL быть обратимым lifecycle flag, сохранять application data и последнее workflow state, скрывать candidate из active/default surfaces и отключать automatic launches/notifications. Permanent delete MUST быть доступен только archived candidate и каскадно удалять application card, personal fields, transcripts, OCR results, normalized analysis, fragments, embeddings, user PDFs, technical JSON, temporary files and other application derivatives. Приложение MUST NOT удалять или ожидать удаления Google Drive folders/files; minimal non-PII tombstone SHALL предотвращать rediscovery прежнего Folder ID. Protected LLM traces являются явным исключением: они MUST сохраняться до собственного exact 30-day expiry и MUST NOT удаляться раньше из-за candidate deletion. После expiry trace MUST удаляться.

#### Scenario: Candidate deleted before trace expiry
- **WHEN** candidate permanent delete происходит до 30-day trace expiry
- **THEN** обычные application derivatives удаляются по lifecycle contract
- **AND** protected traces остаются isolated и admin-only до expiry

#### Scenario: Trace retention завершён
- **WHEN** trace достигает 30-day expiry
- **THEN** protected full content удаляется независимо от candidate lifecycle
- **AND** ordinary logs не получают его copy

#### Scenario: Срок хранения истёк
- **WHEN** retention policy требует permanent delete archived candidate
- **THEN** application-derived data удаляются по candidate lifecycle
- **AND** protected traces сохраняются до собственного exact expiry

#### Scenario: Кандидат архивирован
- **WHEN** HR архивирует завершённого кандидата
- **THEN** application data и последнее workflow state сохраняются
- **AND** protected traces не меняют собственный retention deadline

#### Scenario: Удаление подтверждено, но исходная папка существует
- **WHEN** permanent delete подтверждён, а Drive folder существует
- **THEN** application deletion завершается без удаления или ожидания удаления Drive content
- **AND** protected traces остаются isolated до expiry

#### Scenario: Полное удаление завершено
- **WHEN** permanent delete application data завершён
- **THEN** остаются только допустимый minimal tombstone, внешние Drive artifacts и protected traces до expiry
- **AND** tombstone и ordinary logs не копируют trace content

## ADDED Requirements

### Requirement: SEC-011 [CONFIRMED] Protected LLM trace имеет отдельную access boundary
Protected trace store MUST требовать technical-administrator authentication and authorization, быть недоступным HR application role и не раскрывать content через product API/UI. Конкретная storage technology MUST NOT определяться product spec.

#### Scenario: Product API запрашивает protected content
- **WHEN** request идёт через HR-facing application surface
- **THEN** protected trace content не выдаётся
- **AND** response не раскрывает storage location или access credential
