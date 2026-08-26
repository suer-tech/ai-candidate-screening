## Context

См. `proposal.md` — Why. Main specs являются полным behavioral contract. `add-durable-agent-runtime` задаёт execution primitives, но намеренно не реализует domain tools. Текущий код содержит отдельные transcription, LLM tracing, result-document и dashboard boundaries; Drive discovery, OCR/assessment, PDF generation и Telegram delivery отсутствуют.

## Goals / Non-Goals

**Goals:**
- Представить канонический candidate workflow одним versioned goal template поверх durable runtime.
- Сохранять каждый дорогой или внешний результат как immutable, повторно используемый artifact с provenance.
- Разделить недетерминированное извлечение/оценку и детерминированные validation/recommendation/publication gates.
- Получить production-like evidence по всем четырём обязательным E2E на одной сборке.

**Non-Goals:**
- Менять main requirements, формулу рекомендации, минимальный комплект или структуру отчётов.
- Добавлять новые adaptive branches сверх уже согласованных retry/repair contracts.
- Реализовывать свободный planner: pipeline graph детерминирован и привязан к policy version.
- Переписывать работающие transcription/tracing модули, если их можно обернуть tool adapter.

## Decisions

### 1. Один goal template, параллельные независимые ветви

Goal `candidate-analysis` фиксирует candidate, input version и active vacancy profile version. Graph:

1. `drive-discover/snapshot/stability/material-manifest`;
2. параллельно `document-download/extract/OCR` и `media-download/probe/audio-extract/STT`;
3. `speaker-role-map` после transcript;
4. `fact-and-evidence-extraction` после document/transcript artifacts;
5. `profile-assessment` и deterministic recommendation;
6. schema/evidence/consistency gates;
7. параллельное формирование двух PDF, затем pair verification/publication gate;
8. `READY`, затем независимый Telegram outbox delivery.

Нельзя создавать второй orchestration path в UI: automatic/manual triggers публикуют events одного template. Эта схема упрощает повтор и делает зависимости наблюдаемыми.

### 2. Product data отделены от runtime data

Runtime tables хранят execution protocol; domain tables хранят immutable business artifacts:

- Drive objects, material roles, snapshots и input versions;
- document/page extraction и OCR artifacts;
- media probe, audio artifact, provider job и transcript representations;
- extracted facts, evidence nodes/locators, conflicts и assessment version;
- report version, document descriptors/checksums/publication identity;
- notification logical event и per-recipient delivery attempts;
- stage/run duration dimensions и cleanup state.

Task checkpoint содержит ссылку на domain artifact identity, а не копию полного payload. Candidate status является projection run state, а не самостоятельным scheduler.

### 3. Drive scanner работает по IDs и snapshots

Короткий scheduled trigger каждые 15 секунд перечисляет candidate folders только сверху вниз от зарегистрированного корня `Найм` личного `Моего диска`. Доступ выполняется через server-side OAuth connection, durable token provider и scoped runtime grant; произвольный client File ID не расширяет область доступа. Folder/File IDs и provider version metadata являются identity; names/path используются только для отображения. Для обнаруженной папки minute trigger строит полный snapshot `fileId/version/size/role`. Три неизменных сравнения создают immutable input version. `Результаты/` исключается до material classification.

Polling выбран вместо webhook-only схемы: main specs задают частоты, а webhook delivery не заменяет обязательную проверку snapshots. Идемпотентный cursor может оптимизировать list, но не менять наблюдаемую семантику.

### 4. Material manifest валидируется до дорогих tools

Classifier сначала использует MIME/container/file metadata и зарегистрированные extensions, затем безопасный content probe. Manifest фиксирует одну роль каждого входа, ambiguity и обязательный комплект. Недостаток материала останавливает goal до обработки; повреждённый присутствующий файл становится stage obstacle согласно main/runtime policy.

Политики неоднозначных двух резюме/интервью не изобретаются здесь: неразрешённая неоднозначность эскалируется по текущим требованиям, а adaptive classification будет отдельным change.

### 5. Document pipeline сохраняет page-level provenance

PDF/DOCX adapters создают normalized document и страницы/секции. Для PDF text extraction и OCR результаты хранятся раздельно с method, tool/model/instruction/schema versions, confidence и source geometry. OCR запускается по main policy для страниц, требующих распознавания; объединение не переписывает raw outputs.

Canonical locator содержит Drive file ID/version, document artifact ID, page/section, normalized text span и при наличии bbox. Каждый significant assessment claim ссылается на locator либо явно получает недостаточность данных.

### 6. Existing transcription boundary становится resumable tool chain

Media content probe предшествует FFmpeg. Audio extraction создаёт checksum artifact; provider create response немедленно checkpoint-ит AssemblyAI remote job ID, после чего polling может пережить restart. Raw provider response, normalized structured transcript и TXT остаются тремя связанными immutable representations. Speaker labels не переписываются role mapping; mapping хранится отдельным artifact с confidence/evidence.

Локальный synchronous module сохраняется внутри Node adapter, но orchestration, retries и polling state принадлежат runtime.

### 7. RouterAI adapter единый для OCR, extraction и assessment

Существующие config/attempt gateway/prompt-schema registry/protected trace используются через registered tools. Каждый call фиксирует capability, provider/endpoint/model, instruction/schema versions, input artifact identities, timeout/retry/budget и protected raw trace identity. Browser не получает provider secret или raw internal prompt.

Structured output сначала проходит schema version/adapters, затем domain gate. Repair создаёт новый runtime task и новый trace, не изменяя исходный ответ.

### 8. Evidence-first assessment разделён на этапы

LLM извлекает факты и candidate-to-profile observations, но не является единственным автором итоговой рекомендации. Pipeline отдельно строит:

- evidence graph и conflicts;
- ABC direction states;
- competencies и access-to-KE states;
- required/desired experience;
- risks и explicit stop-factor matches;
- insufficiency/conflict markers.

Детерминированный evaluator применяет ASM-050 и связанные main requirements к validated structure. Любой significant output без допустимого evidence блокирует публикацию либо получает нормативное состояние недостаточности, а не домысел.

### 9. Validation gate формирует publishable snapshot

Final assessment snapshot включает exact input/profile/config versions, all artifacts, formula output и gate evidence. Обязательные gates: supported schema, required sections, locator referential integrity, no forbidden invention, conflict/stop-factor consistency, recommendation formula и cross-report consistency. Snapshot immutable; repair создаёт successor assessment attempt до publication.

### 10. Два PDF создаются из одного snapshot

Node report tools формируют versioned HTML models для ABC и итогового отчёта и рендерят PDF одним approved engine/config. До Drive publication выполняются PDF magic/parse checks, обязательные разделы, known facts, locator text, candidate/profile/result version и checksum validation. Pair получает общий result version; наличие только одного файла не делает результат готовым.

`Результаты/vNNNN/` создаётся/находится по stable publication identity. Publication intents и file IDs/checksums checkpoint-ятся, чтобы timeout не создавал duplicate visible versions.

### 11. READY и Telegram delivery разделены

После подтверждения обоих опубликованных PDF candidate становится `READY`. Затем один logical notification event создаёт per-recipient outbox entries с stable idempotency identities. Delivery retries не откатывают `READY`; terminal delivery failure отражается отдельно и создаёт operational evidence/notification по main policy.

### 12. Метрики выводятся из runtime и domain milestones

Сохраняются monotonic durations и UTC milestones discovery, stability, queue, extraction/OCR, media/STT, assessment, validation, PDF, Drive, time-to-READY и Telegram delivery. ETA использует только сопоставимые successful runs согласно main spec; configuration fingerprint включает tool/model/schema/policy versions и parallelism.

### 13. Cleanup является отдельным durable goal

Archive блокирует triggers, не удаляя artifacts. Delete/retention создаёт cleanup goal: revoke grants, cancel tasks, delete transcripts/OCR/AI/PDF/temp/provider artifacts, сохранить Drive Folder ID tombstone и ждать удаления исходной папки HR согласно SEC-007. Каждый adapter подтверждает cleanup checkpoint; отсутствие одного подтверждения оставляет cleanup incomplete.

### 14. External E2E control plane управляет synthetic fixtures

Control API создаёт уникальные test vacancy/candidate folders, загружает synthetic resume/interview, предоставляет controlled RouterAI responses, ждёт milestones, читает evidence и очищает все derived artifacts. Real-model smoke изолирован от deterministic required E2E. Одна build/config identity связывает четыре сценария.

## Risks / Trade-offs

- [Большой change затрагивает весь pipeline] → Вводить tools по вертикальным slices и держать production routing выключенным до milestone gates.
- [Drive polling создаёт нагрузку] → Использовать cursor/indexed identities, но сохранять нормативные интервалы и полные stability snapshots.
- [Слабый PDF text layer выглядит валидным] → В этом change применять только согласованный extraction/OCR contract; anomaly-driven selective OCR оформить adaptive change.
- [LLM output формально валиден, но содержательно слаб] → Evidence/consistency gates и controlled repair; не ослаблять deterministic oracle.
- [Partial external publication] → Stable intents, pair visibility gate, reconcile/compensation и immutable result versions.
- [E2E требует реальные сервисы и расходы] → Controlled providers для обязательного contour, отдельный real smoke и hard budgets.
- [Незавершённый agent runtime блокирует pipeline] → Начинать domain adapters/tests параллельно, но не включать production routing до готовности runtime primitives.

## Migration Plan

1. Независимо реализовать/актуализировать canonical E2E и получить RED на отсутствующих production stages.
2. Добавить domain schema и Drive discovery/material/input-version vertical slice в shadow mode.
3. Подключить document extraction/OCR и transcription adapters с immutable artifacts/checkpoints.
4. Подключить evidence/assessment/formula/validation до publishable snapshot без внешней публикации.
5. Подключить PDF pair publication, затем Telegram outbox и operational metrics.
6. Реализовать cascade cleanup и external E2E control plane.
7. Выполнить четыре E2E на одной production-like сборке, затем включать per-stage routing feature flags.

Rollback выключает создание новых candidate-analysis goals и effectful publication tools. Уже подтверждённые immutable results сохраняются; незавершённые runs controlled-pause без потери checkpoints и могут быть продолжены после возврата совместимой версии.
