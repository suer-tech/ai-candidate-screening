# VAC-040/TST-086 — full visible generation template RED baseline

## Independence declaration

- Author and executor: independent acceptance subagent `/root/prompt_acceptance`.
- The author did not participate in production implementation of this delta and changed no production source, main specification or OpenSpec task checkbox.
- Change under test: `add-editable-vacancy-prompts`, tasks 1.3–1.4 baseline for the confirmed transparent-template delta.
- The previous six editable-prompt scenarios and their expectations were retained; one new scenario was appended.

## New acceptance contract

Scenario `VAC-040-server-rendered-visible-generation-template` requires:

- a fully visible template rendered by the protected server API from artifact `vacancy-profile/v1`, with no client template copy;
- exact insertion of synthetic title `ACCEPT-TEMPLATE-20260824 — Руководитель отдела продаж` and a hash of the exact rendered text;
- an explicit statement that vacancy title is the only known source fact;
- use of the common professional interpretation of the role without presenting company-specific assumptions as facts;
- marker `Требует решения HR` for employer-dependent decisions;
- exact sections `Образ результата`, `ABC-критерии`, `Компетенции`, `Стоп-факторы`, `Допуск к КЕ`;
- exactly five ABC directions: `Продуктивность`, `Инициатива`, `Самообучаемость`, `Корпоративные ценности`, `Автономность`;
- definition of `Допуск к КЕ` as readiness for an interview with the company owner, including criterion wording, requiredness, rules and observable signs, result source and missing checks;
- reset fetched from the server, restoring the same rendered text, hash and exact title without a client-side copy;
- separate structured transmission of the exact title even after HR removes it from the textarea;
- a visible explanation that result format and mandatory structure remain fixed by the server.

## Expected RED before production changes

- Timestamp: `2026-08-24T05:39:25.908Z`.
- Full focused suite: **6 passed, 1 failed, 0 skipped, 0 cancelled**.
- Targeted new scenario: **0 passed, 1 failed**.
- Machine evidence: **0 GREEN, 1 RED, 0 infrastructure errors**.
- Focused, targeted, JUnit and JSON commands all exited with code `1`, as expected for the pre-implementation baseline.
- Failure classification: product contract `NOT_IMPLEMENTED`; the existing conformance adapter has no `rendered-generation-template` behavior. Test modules, fixture loading and harness execution succeeded.

## Evidence safety

- Fixture set is synthetic and permits no provider, network, database or Drive effects.
- No real personal data, credential or raw provider response is stored.
- Because production does not yet return the template, the RED artifacts contain no full server prompt text.

## Evidence and reproduction

- Machine JSON: `tests/acceptance/evidence/editable-vacancy-template-red.json`
- Targeted JUnit: `tests/acceptance/evidence/editable-vacancy-template-red.junit.xml`
- Targeted console: `tests/acceptance/evidence/editable-vacancy-template-red-console.txt`
- Full-suite console: `tests/acceptance/evidence/editable-vacancy-template-red-full-console.txt`

```powershell
cd web
npm run test:editable-vacancy-prompts
npm run test:editable-vacancy-template:red
npm run test:editable-vacancy-template:red-evidence
npm run test:editable-vacancy-template:red-json
```

This document records only the independent RED baseline. Production implementation and later GREEN evidence belong to tasks 3.5, 4.5, 5.6 and 7.5.
