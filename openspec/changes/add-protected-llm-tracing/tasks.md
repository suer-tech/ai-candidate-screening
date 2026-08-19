## 1. Независимый приёмочный baseline

- [x] 1.1 Независимому субагенту добавить исполняемые TST-098–TST-102 для complete attempt trace, access isolation, exact retention, fail-open outage и validated configuration boundary.
- [x] 1.2 Запустить сценарии на текущей реализации и зафиксировать ожидаемый RED без записи реальных ПДн в test evidence.

## 2. Vendor-neutral LLM trace contract

- [x] 2.1 Ввести единый attempt envelope и correlation IDs для generation, OCR, assessment, validation/repair и agent/tool subcalls; STT оставить в отдельном technical journal.
- [x] 2.2 Для каждого attempt сохранять exact request/messages, response, tool calls/results, timing, errors, provider/model identity и effective config.
- [x] 2.3 Сохранять внутри каждой trace record отдельный полный self-contained snapshot всех использованных материалов без замены общей reference/dedup link.
- [x] 2.4 Исключить secrets и credentials из trace payload, сохранив exact functional exchange и PII в protected store.

## 3. Защита, retention и отказоустойчивость

- [x] 3.1 Ограничить доступ к protected traces техническим администратором; не добавлять HR UI, export или отдельный tamper-evidence mechanism.
- [x] 3.2 Обеспечить exact 30-day retention, включая сохранение trace после более раннего окончательного удаления кандидата из приложения.
- [x] 3.3 Реализовать fail-open при недоступности trace store: LLM workflow продолжается, ordinary observability получает metadata-only incident о неполной трассировке.
- [x] 3.4 Проверить, что ordinary technical logs содержат только IDs/metadata и никогда не дублируют full prompts, responses, materials или tool payloads.

## 4. Configuration boundary

- [x] 4.1 Ввести валидируемое отображение logical capability на provider/model/prompt/schema/limits без неявного fallback.
- [x] 4.2 Хранить prompts, tool schemas, output schemas и non-secret defaults под version control, а credentials только в runtime secret boundary.
- [x] 4.3 Валидировать effective config при startup, применять изменения контролируемым restart и записывать immutable config snapshot/version в каждый attempt trace.
- [x] 4.4 Разделить логические роли request-serving, background processing, app data и protected trace store без фиксации конкретного deployment product.

## 5. Проверка и release gate

- [x] 5.1 Довести независимые acceptance и focused security/retention/outage/config tests до GREEN, включая tool-call и future-subcall fixtures.
- [ ] 5.2 Запустить применимые unit/lint проверки и полный набор `E2E-VAC-001`, `E2E-TRN-001`, `E2E-ABC-001`, `E2E-RESULT-001` с trace assertions.
- [x] 5.3 Проверить evidence для admin-only access, ordinary-log minimization, 30-day TTL, candidate-delete exception и fail-open incident; не включать full sensitive content в отчёт.
