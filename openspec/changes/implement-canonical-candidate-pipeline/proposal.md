## Why

Main specs уже полностью определяют канонический путь кандидата от Google Drive до двух PDF и Telegram, но production runtime для большинства этапов отсутствует. После появления durable agent runtime нужно подключить согласованные этапы как реальные tools и довести четыре обязательных E2E до GREEN без добавления новых кадровых правил.

## What Changes

- Реализовать discovery в зарегистрированном корне `Найм` личного `Моего диска` через server-side OAuth, устойчивую идентичность папок/файлов, snapshots, stability counter, material registry и input versions.
- Реализовать защищённое скачивание, document extraction для PDF/DOCX и per-page OCR RouterAI с confidence и source locators.
- Подключить FFmpeg/AssemblyAI transcription boundary к durable tasks, provider-job checkpoints, resume polling, diarization quality и speaker-role mapping.
- Реализовать versioned RouterAI assessment: facts, evidence graph, ABC, competencies, access-to-KE, risks, stop factors, conflicts и deterministic recommendation formula.
- Реализовать schema/evidence/consistency validation и ограниченный repair уже предусмотренных structured outputs без изменения main requirements.
- Реализовать два нормативных PDF, content verification, checksums, immutable publication в `Результаты/vNNNN/` и version binding.
- Реализовать Telegram outbox, per-recipient delivery attempts, idempotency и независимость delivery state от `READY`.
- Реализовать run/stage metrics, SLA observation, ETA history, operational projections и cascade cleanup.
- Использовать contracts `add-durable-agent-runtime`: goal/task/checkpoint/grant/budget/gate/escalation/outbox; фиксированный UI workflow или новый параллельный orchestration path не создавать.
- Пройти независимый RED/GREEN acceptance и полный обязательный E2E contour на одной production-like сборке.

## Capabilities

### New Capabilities

Нет. Change не добавляет нового observable поведения.

### Modified Capabilities

Нет. Реализация должна соответствовать текущим main specs `candidate-workflow`, `assessment-and-evidence`, `reporting-and-notifications`, `integrations-and-operations`, `data-and-security` и `quality-gates` без изменения их requirements.

## Impact

- Затрагиваются D1 schema, Drive adapters/scanner, document/OCR modules, transcription dispatcher, RouterAI assessment/eval, evidence store, PDF generation/publication, Telegram outbox, cleanup, background Node worker и operational UI projections.
- Существующие локальные transcription, LLM tracing, result-document descriptors и UI preview используются как границы, но перестают быть изолированными demo-фрагментами.
- `add-durable-agent-runtime` является implementation dependency; production routing pipeline нельзя включать до готовности его queue/checkpoint/grant/budget primitives.
- Specs artifact намеренно пропущен через `skip_specs: true`, поскольку main specs остаются единственным источником поведения.
