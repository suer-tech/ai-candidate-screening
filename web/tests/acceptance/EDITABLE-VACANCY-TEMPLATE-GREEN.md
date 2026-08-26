# VAC-040/TST-086 — full visible generation template GREEN evidence

## Independence and oracle integrity

- Executor: independent acceptance subagent `/root/prompt_acceptance`, not a participant in production implementation.
- Change under test: `add-editable-vacancy-prompts`, task 7.5 verification.
- Production source, acceptance oracle and OpenSpec task checkboxes were not changed during verification.
- The only acceptance-code cleanup was removal of unused helper `readPath`; comparison behavior and expectations were unchanged.
- Oracle hashes before and after execution were identical:
  - test runner: `E4F16EEE85EE74B5777AE1A05E0D80A29261F831429F4DA8ED33A72736ADE7E1`
  - RED fixture/oracle including the transparent-template case: `96230ECE4CE6E5241630BBD4D4540404E3F673377E8700D79021AFD2AA8ECB23`
  - comparison harness after lint-only cleanup: `1A694103F3EC8ED27E7EE0C542828C724299B30ABAB8282E7D13DD658A3C9A7B`
- Historical RED evidence remains present:
  - JSON SHA-256: `CA161F8B9E7A372D790BDC30BA0DF597CDEBF0DE8A0D0E30AD1EB85FD6D3838C`
  - JUnit SHA-256: `0397DC1C1DE7DD761C3FCD207E86055E086C64B8C3513771E54856B14124DF31`

## Automated result

- Timestamp: `2026-08-24T05:43:00.357Z`.
- Full focused suite: **7 passed, 0 failed, 0 skipped, 0 cancelled**.
- Targeted transparent-template scenario: **1 passed, 0 failed**.
- Machine JSON: **1 GREEN, 0 RED, 0 infrastructure errors**.
- Full, targeted, JUnit and JSON commands all exited with code `0`.

The unchanged scenario proves server rendering, absence of a client template copy, exact title insertion, sole-known-fact and professional-interpretation rules, company-assumption safety, `Требует решения HR`, exact five sections and five ABC directions, owner-interview meaning and required fields of `Допуск к КЕ`, server reset, exact rendered hash and separate structured title transmission.

## Direct rendered-template verification

- Synthetic title occurs exactly once in the rendered template.
- Rendered template length: `2751` characters.
- Exact rendered SHA-256: `sha256:fcb1dda91287e68cbb94c68a4a27b6145caa73d97c6c10bccb90e9e3b3538618`.
- Recomputing the snapshot hash from the exact rendered text produced the same value.
- A second server render used for reset produced byte-identical text and the same hash.

## Security leak scan

- Scanned GREEN JSON, JUnit, targeted console and full-suite console evidence.
- Scanned eight current technical log files under `.runtime/logs`; credential files and private candidate data were not read.
- Full 2751-character rendered template occurrences: `0` in evidence, `0` in technical logs.
- Fixed synthetic provider-secret/cookie sentinel occurrences: `0` in evidence, `0` in technical logs.
- Evidence contains no raw provider response or real personal data.

## Artifacts and reproduction

- JSON: `tests/acceptance/evidence/editable-vacancy-template-green.json`
- JUnit: `tests/acceptance/evidence/editable-vacancy-template-green.junit.xml`
- Targeted console: `tests/acceptance/evidence/editable-vacancy-template-green-console.txt`
- Full-suite console: `tests/acceptance/evidence/editable-vacancy-template-green-full-console.txt`

```powershell
cd web
npm run test:editable-vacancy-prompts
node --import tsx --test --test-name-pattern=server-rendered tests/editable-vacancy-prompts.acceptance.test.mjs
node --import tsx --test --test-name-pattern=server-rendered --test-reporter=junit --test-reporter-destination=tests/acceptance/evidence/editable-vacancy-template-green.junit.xml tests/editable-vacancy-prompts.acceptance.test.mjs
node tests/editable-vacancy-prompts.evidence.mjs --scenario VAC-040-server-rendered-visible-generation-template --output tests/acceptance/evidence/editable-vacancy-template-green.json
```

This closes only independent focused verification for task 7.5. Full regression, provisioned required E2E and manual local/VPS checks remain separate gates.
