## 1. Независимый canonical RED baseline

- [x] 1.1 После согласования change поручить независимому субагенту проверить и при необходимости дополнить `E2E-VAC-001`, `E2E-TRN-001`, `E2E-ABC-001`, `E2E-RESULT-001` по текущим main specs без изменения oracle под существующий код.
- [x] 1.2 Добавить production-like control fixtures для Google Drive, controlled RouterAI, AssemblyAI, PDF publication и Telegram recipients с уникальными test identities и cleanup contract.
- [x] 1.3 Запустить четыре E2E на текущей сборке, сохранить ожидаемый RED по отсутствующим stages и отделить product failures от environment preflight blockers.

## 2. Runtime dependency и domain schema

- [x] 2.1 Зафиксировать совместимую version `add-durable-agent-runtime` contracts и блокировать production routing без queue/checkpoint/grant/budget/gate/outbox primitives.
- [x] 2.2 Добавить D1 schema/migrations для Drive objects, material roles, snapshots, manifests и immutable input versions.
- [x] 2.3 Добавить document/page/OCR, media/transcript, fact/evidence/assessment artifact entities с provider/schema/config provenance.
- [x] 2.4 Добавить report versions, document descriptors/checksums/publication bindings, notification events/deliveries и stage/run metrics.
- [x] 2.5 Добавить cleanup state и foreign-key/identity constraints, связывающие domain artifacts с candidate/run/input/profile versions.
- [x] 2.6 Реализовать migration, immutability, isolation и cascade lifecycle tests на чистой и существующей D1 schema.

## 3. Personal Google Drive OAuth discovery и input versions

- [x] 3.1 Использовать `GoogleMyDriveAdapter` и durable OAuth token provider как единственный Drive backend; ограничить paginated listing зарегистрированным корнем `Найм` и устойчивыми Folder/File IDs.
- [x] 3.2 Реализовать 15-second discovery trigger и idempotent candidate-folder registration с tombstone guard.
- [x] 3.3 Реализовать minute full snapshots file ID/version/size и исключить `Результаты/` до входного material registry.
- [x] 3.4 Реализовать stability counter: три неизменных полных интервала, reset при изменении и пропуск Drive-error interval.
- [x] 3.5 Реализовать material classifier/manifest и минимальный resume+interview completeness gate до дорогих tasks.
- [x] 3.6 Реализовать immutable input version, automatic first-run trigger и manual new-run behavior для последующих версий.
- [x] 3.7 Добавить acceptance/integration tests rename/move/copy folder, duplicate scan/event, partial upload, missing material и changed active input.

## 4. Document extraction, OCR и locators

- [x] 4.1 Реализовать authorized Drive download checkpoint для конкретной file version без public link.
- [x] 4.2 Реализовать PDF и DOCX extraction adapters с immutable raw/normalized document artifacts и page/section boundaries.
- [x] 4.3 Реализовать page OCR RouterAI tool через protected LLM gateway с versioned schema/instruction, confidence и raw trace identity.
- [x] 4.4 Реализовать deterministic merge extracted/OCR text без перезаписи raw outputs и с method provenance каждой страницы.
- [x] 4.5 Реализовать canonical document locator file/version/artifact/page-or-section/text-span/bbox и referential-integrity gate.
- [x] 4.6 Добавить fixtures/tests text PDF, scanned PDF, mixed pages, DOCX, corrupt/unsupported file, low confidence и locator stability.

## 5. Durable media и transcription chain

- [x] 5.1 Обернуть media content probe, FFmpeg extraction и cleanup существующих temp artifacts в registered runtime tools.
- [x] 5.2 Сохранять audio checksum/config checkpoint и переиспользовать его при совместимой повторной транскрибации.
- [x] 5.3 Обернуть AssemblyAI create/poll в durable provider job: ранний remote-job checkpoint, restart resume и unknown-outcome reconcile.
- [x] 5.4 Сохранять raw response, normalized structured transcript и TXT как три согласованных immutable representations.
- [x] 5.5 Реализовать low-confidence aggregation и отдельный speaker-role mapping artifact без переписывания provider labels.
- [x] 5.6 Добавить integration/acceptance tests real FFmpeg boundary, controlled STT, diarization, timestamps, restart-after-create и no duplicate upload.

## 6. RouterAI structured capabilities

- [x] 6.1 Реализовать production RouterAI OpenAI-compatible adapter поверх existing config/attempt gateway с server-only secrets и protected traces.
- [x] 6.2 Зарегистрировать versioned capabilities/schemas/instructions для OCR, speaker mapping, fact extraction, assessment и bounded repair.
- [x] 6.3 Реализовать supported-schema adapters, strict validation и явный `UNSUPPORTED_SCHEMA_VERSION` без выдумывания missing fields.
- [x] 6.4 Реализовать hard timeout/retry/budget accounting и safe provider errors для каждого capability.
- [x] 6.5 Добавить controlled-output contract tests и отдельный real-model smoke без дословного golden comparison.

## 7. Evidence graph и assessment

- [x] 7.1 Реализовать fact extraction из document/transcript artifacts с source kind, locator, confidence и provenance.
- [x] 7.2 Реализовать evidence graph, unresolved conflict representation и запрет significant claim без допустимого source.
- [x] 7.3 Реализовать ABC direction assessment по зафиксированной vacancy profile version с `A/B/C/CONFLICT/Недостаточно данных` semantics.
- [x] 7.4 Реализовать required/desired experience, competencies, access-to-KE, risks и explicit stop-factor matching по main rules.
- [x] 7.5 Реализовать deterministic recommendation formula ASM-050 отдельно от LLM и сохранить её inputs/decision evidence.
- [x] 7.6 Реализовать immutable assessment snapshot с exact input/profile/tool/model/schema/policy versions.
- [x] 7.7 Реализовать schema/evidence/consistency/formula gates и bounded repair successor attempt без изменения исходного response.
- [x] 7.8 Добавить known-fact, conflict, insufficient-evidence, stop-factor, locator completeness и reproducibility tests.

## 8. Два PDF и Drive publication

- [x] 8.1 Реализовать versioned render models для ABC-файла и итогового отчёта со всеми обязательными main-spec sections.
- [x] 8.2 Реализовать Node PDF rendering tool из одного immutable assessment snapshot.
- [x] 8.3 Реализовать PDF validation: signature/parse, required sections, known facts, locators, identities, cross-report consistency и checksum.
- [x] 8.4 Реализовать shared result version и pair gate, запрещающий `READY` при отсутствии или invalidity одного PDF.
- [x] 8.5 Реализовать idempotent `Результаты/vNNNN/` provisioning/publication с stable file identities и timeout reconcile.
- [x] 8.6 Связать result descriptors с существующим preview/export UI без публикации secrets или signed URL за scope.
- [x] 8.7 Добавить partial-pair, duplicate publication, immutable previous version и content-oracle acceptance tests.

## 9. Telegram, metrics и cleanup

- [x] 9.1 Реализовать logical success/error notification events и server-configured allowed recipient registry.
- [x] 9.2 Реализовать per-recipient Telegram outbox attempts, idempotency, backoff и unknown-response reconcile независимо от `READY`.
- [x] 9.3 Реализовать safe Telegram templates без лишних персональных данных, secrets и internal errors.
- [x] 9.4 Реализовать UTC/monotonic milestones, stage/provider/queue durations, retry counts, time-to-READY и delivery time.
- [x] 9.5 Реализовать comparable configuration fingerprint, 90-day ETA sample и `Недостаточно данных для прогноза` guard.
- [x] 9.6 Подключить runtime projections к operational dashboard без вычисления вымышленных queue states в браузере.
- [x] 9.7 Реализовать durable cascade-cleanup goal для runtime/domain/provider/temp/report artifacts и tombstone by Drive Folder ID.
- [x] 9.8 Добавить archive, delete, retention, notification-failure и metrics/ETA tests.

## 10. E2E control plane и rollout

- [x] 10.1 Реализовать authenticated external E2E control API для fixture provisioning, trigger, milestone wait, artifact/evidence read и full cleanup.
- [x] 10.2 Запустить pipeline в shadow mode от Drive до validated assessment без visible publication и сравнить event/artifact timeline.
- [x] 10.3 Включить PDF/Telegram side effects только после GREEN pair/outbox recovery tests и hard budget verification.
- [ ] 10.4 Довести независимо принятые четыре canonical E2E до GREEN на одной production-like build/config identity.
- [x] 10.5 Запустить unit, typecheck, lint, build, migration, integration, security и full regression suites.
- [x] 10.6 Выполнить real-provider smoke в согласованном регионе и проверить trace/secret/privacy boundaries.
- [ ] 10.7 Сформировать 30-дневный evidence package и не завершать change при N/A без requirement-level обоснования либо неполном cleanup.
