# Executive reports and result read-through — RED evidence

- Date: 2026-08-24
- Change: `implement-canonical-candidate-pipeline`
- Command: `npm run test:reports:executive-readthrough`
- Result: expected RED — 4 tests, 1 passed, 3 failed
- Machine evidence: `executive-report-and-result-readthrough-red.junit.xml`

## Observed failures

1. `E2E-RESULT-001: Итоги is a compact one-page-like executive report without raw evidence dump`
   - The one-page/250 KB executive layout checks pass.
   - The renderer prints an internal `artifact:` marker supplied through evidence content instead of sanitizing it.

2. `E2E-ABC-001/E2E-RESULT-001: neither PDF exposes internal identities or forbidden explanatory copy`
   - The renderer prints candidate/vacancy/profile IDs directly in the visible header and accepts run/artifact/file IDs in section bodies.
   - The same oracle also forbids UUIDs, the A/B/C scale legend and the phrase that conflicts require an HR decision.

3. `E2E-ABC-001/E2E-RESULT-001: preview and download read through immutable artifact when published Drive file is unavailable`
   - `readCurrentResult` calls only `artifacts.readPdf(descriptor.storageId)` for the Drive storage ID.
   - There is no caught Drive-read failure, immutable artifact read-through or reconcile path for either preview or download.

## Passing invariant

`E2E-ABC-001: ABC profile prints the five canonical Russian direction names` passes for all five required names: Продуктивность, Инициатива, Самообучаемость, Корпоративные ценности and Автономность.

The local one-page `candidate/Итоги_Зотова Александра.pdf` is used only as the structural product reference; its personal content is not copied into evidence. Task 10.4 remains incomplete because this is a RED release gate. No production code was changed.
