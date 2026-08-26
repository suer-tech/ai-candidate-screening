# Task 8.1 — RED acceptance evidence

- Date: 2026-08-21
- Command: `npm run test:vacancy-flow:v2`
- Result: expected RED (`7` tests, `0` passed, `7` failed)
- Machine evidence: `vacancy-operator-flow-v2-red.junit.xml`

Observed production gaps:

1. `TST-139` — create screen has `Сформировать вакансию` and calls `/api/vacancies/generate`, rather than saving a minimal active vacancy without LLM.
2. `TST-140` — vacancy settings have no `Сгенерировать описание` action that fills an unsaved editor.
3. `TST-141` — settings still render `Сохранить новую версию`.
4. `TST-142` — discovery declares a 60-second stability interval and no explicit four-snapshot 0/15/30/45 contract.
5. `TST-143` — the production discovery boundary exposes no explicit changed-snapshot reset contract (automatic-first-run and fingerprint idempotency already exist).
6. `TST-144` — Docker does not prove an executable FFmpeg binary and `/health` only checks `Boolean(ffmpegStaticPath)`.
7. `TST-145` — media readiness does not perform synthetic extraction.

No production implementation was changed while capturing this baseline.
