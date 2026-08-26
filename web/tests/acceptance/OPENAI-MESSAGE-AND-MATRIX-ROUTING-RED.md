# OpenAI-compatible message normalization and matrix routing — independent RED regression

- Author/executor: independent acceptance subagent `/root/matrix_acceptance_red`.
- Production code changed: no.
- OpenSpec task checkboxes changed: no.
- Data: synthetic only; no real candidate information, credentials, network access or provider spend.
- Recorded at: `2026-08-26T09:02:10.0501095Z`.
- Command: `cd web && npx tsx --test --test-name-pattern="LLM-TRANSPORT|MATRIX-ROUTING|canonical goal graph" --test-reporter=junit --test-reporter-destination=tests/acceptance/evidence/openai-message-and-matrix-routing-red.junit.xml tests/openai-message-and-matrix-routing.acceptance.test.ts server/candidate-pipeline/pipeline.test.ts`.
- Result: exit code `1`; six focused cases, five GREEN and one expected RED.

## Result

- `LLM-TRANSPORT-RED-001` — RED. The captured OpenAI-compatible request currently contains object-valued `messages[0].content`; the contract requires the JSON string `JSON.stringify(originalObject)`.
- `LLM-TRANSPORT-002` — GREEN. String content is byte-for-byte unchanged after request serialization.
- `LLM-TRANSPORT-003` — GREEN. Array content blocks remain an array with unchanged values.
- `MATRIX-ROUTING-004` — GREEN. Production discovery pins the primary goal to `candidate-analysis-matrix/v1` with `workflowVersion: matrix-v2` when routing is `production`.
- `MATRIX-ROUTING-005` — GREEN. Shadow routing keeps the legacy primary branch and creates `candidate-analysis-matrix-shadow/v1` with `workflowVersion: matrix-v2-shadow`, a distinct trigger and `validated-assessment` completion.
- Existing `canonical goal graph is registered against durable runtime tools` — GREEN. This pre-existing test is the non-duplicated evidence that the shadow plan excludes report-pair, Drive-publication and Telegram tools and ends at validation.

Machine-readable evidence: `evidence/openai-message-and-matrix-routing-red.junit.xml`.
