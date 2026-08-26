# READY candidate detail and compact reports — RED evidence

- Date: 2026-08-24
- Main specs: assessment-and-evidence, reporting-and-notifications, quality-gates
- Required E2E links: `E2E-ABC-001`, `E2E-RESULT-001`
- Command: `npm run test:ready-detail-compact-reports`
- Result: expected RED — 2 tests, 0 passed, 2 failed
- Machine evidence: `ready-detail-compact-reports-red.junit.xml`

## Exact failures

1. `E2E-RESULT-001 regression: READY detail projects the structured assessment into AI overview`
   - `projectCandidate` returns recommendation plus generic publication summary.
   - Structured recommendation basis, stop factors, ABC, competencies, risks, access-to-KE and evidence are absent from the READY result projection.
   - The test separately protects against presenting ETA fallback `Недостаточно данных для прогноза` as an assessment result.

2. `E2E-ABC-001/E2E-RESULT-001 regression: oversized evidence still produces exactly two compact readable PDFs`
   - Rendering itself stays compact and retains the required short Russian section titles.
   - `validateRenderedReportPdf` rejects that readable report with `PDF_CONTENT_ORACLE_FAILED`, because the current oracle requires the complete oversized `locator.exactText` inside the user PDF.

The executable gate uses a realistic oversized evidence locator, requires exactly the ABC/final-result model pair, 1–3 pages per report, at most 750 KB, readable required section labels, and no raw evidence dump token. Local manual references `candidate/АВС тест_Зотова А..pdf` and `candidate/Итоги_Зотова Александра.pdf` are one-page product-shape references; their personal contents are not copied into test evidence.

No production code was changed.
