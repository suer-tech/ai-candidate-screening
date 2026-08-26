## Context

См. `proposal.md` — Why. `add-durable-agent-runtime` задаёт generic obstacle/repair/replan/escalation protocol, а `implement-canonical-candidate-pipeline` — domain artifacts и stages. Этот change добавляет только versioned detectors и recovery branches, которые используют те же queue, memory, grants, budgets, gates и audit.

## Goals / Non-Goals

**Goals:**
- Обнаруживать конкретные quality/ambiguity obstacles до того, как слабый artifact попадёт дальше по pipeline.
- Исправлять минимальный повреждённый участок и доказуемо переиспользовать upstream artifacts.
- Делать стоимость, provenance и причину каждой adaptive branch наблюдаемыми.
- Сводить решение человека к конкретному выбору, а не техническому `FAILED`.

**Non-Goals:**
- Давать агенту произвольный поиск новых tools или неограниченный loop.
- Автоматически выбирать кандидата, менять vacancy profile или assessment formula.
- Использовать данные других кандидатов для classification/repair.
- Заменять controlled retry transient provider errors adaptive branches.

## Decisions

### 1. Detector registry отделён от recovery registry

Detector definition содержит artifact type, feature extractor, thresholds/policy version, outcomes и evidence schema. Recovery definition содержит допустимые obstacle codes, required grants/budgets, alternative tasks, expected change, post-gate и next branch. Detector не вызывает tool напрямую; runtime сохраняет obstacle event и только затем валидирует recovery branch.

Это разделение позволяет тестировать false positives и менять thresholds без скрытого изменения orchestration.

### 2. Material classification идёт от сильных deterministic признаков к escalation

Classifier использует Drive identity, MIME/container, parser/probe success, document structure и зарегистрированные role hints. Отображаемое имя может быть слабым признаком, но никогда единственным. LLM MAY предложить role с cited artifact features, однако automatic primary требует, чтобы после policy scoring остался ровно один кандидат и были пройдены hard format/content gates.

При tie/low margin создаётся `MATERIAL_ROLE_AMBIGUOUS`. HR action выбирает File ID и создаёт immutable selection artifact. Если input version не изменилась, тот же run продолжается; иначе selection stale.

### 3. PDF quality оценивается page-by-page до OCR

Feature extractor считает usable non-whitespace characters, replacement/control ratio, repeated-glyph/garbled patterns, page-boundary coverage и parser warnings. Thresholds находятся в versioned policy и калибруются synthetic fixtures; raw text не пишется в metrics.

Каждая failed page создаёт отдельный OCR task. Merge использует page index как stable key и хранит `extracted`, `ocr`, `selectedMethod`, quality evidence и locator mapping. Повторный post-gate блокирует тот же OCR branch по obstacle fingerprint, если content/policy не изменились.

OCR всего документа отклонён: он дороже, ухудшает хорошие locators и скрывает источник текста.

### 4. Transcript anomaly не равна короткому transcript

Detector сопоставляет audio duration, speech activity/probe features, word/utterance count, timestamp coverage, provider status/confidence и continuity. Outcome `ALTERNATIVE_PATH` требует одновременно доказанной слабости текущего transcript и наличия другой supported stream с признаками речи.

Начальная policy разрешает проверить максимум одну alternative stream после первой; лимит является hard configuration и budget item. Streams ранжируются deterministic media-probe evidence, а не длиной полученного текста. Valid first transcript завершает branch без дополнительного FFmpeg/STT.

### 5. Alternative audio — successor branch, не повтор STT

Каждая stream получает stable identity `(fileVersion, streamIndex, codec, channels)` и отдельные audio/STT artifacts. Fallback plan добавляет extract/transcribe/gate только для выбранной stream. После `PASS` material selection указывает validated transcript artifact; прежний остается immutable с obstacle link. При отсутствии `PASS` создаётся escalation проверить/заменить recording.

### 6. Evidence repair работает по claim dependency closure

Evidence gate возвращает claim ID, violation и разрешённые source fragment identities. Context builder включает только claim, его dependent rule/schema и fragments. Repair может:

- добавить/исправить locator без изменения semantics;
- понизить claim до insufficiency;
- предложить удалить неподтверждённый claim.

Если меняются stop factor, recommendation input, access-to-KE или cross-section conflict, repair считается semantic и создает targeted replan dependency closure вместо local merge.

### 7. Decomposition определяется зарегистрированной section map

Preflight использует фактический model context/output limit и токен-оценку versioned context manifest. Только доказанное превышение создаёт plan sections: facts/evidence, experience, ABC, competencies, access-to-KE, risks/stop factors, conflicts. Общие facts/evidence сначала извлекаются один раз и передаются ссылками; разделы не получают право вычислять recommendation.

Произвольное деление моделью отклонено: оно делает merge и coverage непроверяемыми.

### 8. Merge детерминирован и завершается global eval

Section outputs индексируются stable section/claim IDs и общей schema version. Merge проверяет input/profile/config fingerprint, mandatory sections, locator referential integrity, duplicate identities и explicit contradictions. Duplicates не увеличивают confidence. После merge выполняются общие conflict, stop-factor, access-to-KE, evidence и formula gates; recommendation вычисляется один раз.

Invalid section ремонтируется локально; incompatible fingerprints делают plan invalid и требуют replan/escalation.

### 9. Domain budgets являются подбюджетами goal

Adaptive policy резервирует отдельные лимиты selective OCR pages, alternative streams, local evidence repairs и decomposed section calls. Они списываются в общий runtime ledger. Obstacle fingerprint + branch ID + input artifact identity образуют loop key. Replan не пополняет бюджет.

### 10. Adaptive escalation использует типизированные actions

Actions: `select-primary-file`, `confirm-speaker-role`, `replace-file`, `accept-insufficient-data`, `cancel-run`. Каждый action имеет schema и eligibility policy. UI показывает distinguishing metadata/evidence и последствия; полный raw resume/transcript открывается только через существующий authorized artifact view.

### 11. Rollout начинается с shadow detectors

Detector сначала пишет shadow outcome/metrics, не меняя plan. Synthetic fixture corpus измеряет expected positives/negatives. После принятия threshold version включается branch по obstacle class feature flag. Costly fallbacks и human escalations включаются отдельно; automatic success path всегда сравнивается с canonical baseline.

## Risks / Trade-offs

- [Detector ошибочно запускает дорогой fallback] → Shadow rollout, synthetic negative fixtures, hard per-branch budgets и false-positive review metrics.
- [Слишком строгий PDF gate отправляет обычный текст в OCR] → Page-level metrics/versioned thresholds и запрет whole-document fallback.
- [Вторая аудиодорожка содержит перевод/музыку] → Speech/content probe, максимум одна alternative stream в initial policy и post-transcript gate.
- [Локальный repair незаметно меняет вывод] → Claim dependency closure и semantic-impact gate, переводящий изменение в targeted replan.
- [Decomposition теряет cross-section contradictions] → Общий evidence layer, stable claim IDs и обязательные global gates после merge.
- [HR перегружен частыми ambiguity escalations] → Автоматический выбор только при доказуемом unique primary и метрики escalation/false-positive для policy calibration.
- [Adaptive change включён раньше canonical pipeline] → Dependency preflight и feature flags блокируют branch registration без совместимых artifacts/runtime contracts.

## Migration Plan

1. Независимый субагент создаёт TST-120–TST-125 и фиксирует RED на canonical pipeline без adaptive policies.
2. Добавить detector/recovery registries и synthetic fixture corpus в shadow mode.
3. Включить material ambiguity и selective OCR branches после negative/positive calibration.
4. Заменить first-stream-only behavior bounded alternative-stream branch после GREEN media tests.
5. Включить local evidence repair, затем section decomposition/merge с global gates.
6. Включить typed escalation UI/actions и adaptive metrics.
7. Выполнить focused adaptive, durable runtime и полный canonical E2E contour на одной production-like сборке.

Rollback отключает adaptive branch feature flags и возвращает canonical detector outcomes, не удаляя evidence/artifacts. Уже созданные successor artifacts остаются immutable; незавершённые runs controlled-pause и продолжаются только после выбора совместимой policy version.
