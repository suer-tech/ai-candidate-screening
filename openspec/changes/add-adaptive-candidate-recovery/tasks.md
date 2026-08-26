## 1. Независимый adaptive RED baseline

- [ ] 1.1 После согласования change поручить независимому субагенту реализовать TST-120–TST-125 без участия авторов основной реализации.
- [ ] 1.2 Добавить synthetic fixtures: ambiguous resume/interview sets, mixed/broken-text PDF, multi-stream media, anomalous/short transcripts, missing locator и oversized assessment context.
- [ ] 1.3 Запустить focused suite на canonical pipeline без adaptive branches и сохранить ожидаемый RED, tool call counts, runtime timeline и evidence artifacts.

## 2. Dependencies и policy registries

- [ ] 2.1 Добавить preflight совместимости `add-durable-agent-runtime` и `implement-canonical-candidate-pipeline`; блокировать adaptive feature flags без требуемых contract/artifact versions.
- [ ] 2.2 Реализовать versioned detector registry с feature schema, thresholds, outcomes и safe evidence.
- [ ] 2.3 Реализовать recovery registry с obstacle classes, required grants/budgets, branch tasks, expected change, post-gate и next branch.
- [ ] 2.4 Реализовать obstacle fingerprint/loop key и запрет повторной branch без изменившихся detector inputs/evidence.
- [ ] 2.5 Добавить domain sub-budgets selective OCR pages, alternative streams, local repairs и decomposed calls в общий runtime ledger.
- [ ] 2.6 Реализовать shadow detector outcome и metrics path, который не меняет production plan.

## 3. Неоднозначные материалы

- [ ] 3.1 Расширить material classifier deterministic features Drive identity, MIME/container, parser/probe result, document structure и registered role hints.
- [ ] 3.2 Реализовать optional structured LLM role proposal только с cited artifact features и без права самостоятельно выбрать primary при tie/low margin.
- [ ] 3.3 Реализовать `MATERIAL_ROLE_AMBIGUOUS` obstacle до document assessment/STT side effects.
- [ ] 3.4 Реализовать versioned material-selection artifact с actor, escalation/input versions и selected File IDs.
- [ ] 3.5 Реализовать same-run resume при неизменной input version и stale selection rejection после изменения files.
- [ ] 3.6 Добавить UI actions выбора primary resume/interview с safe distinguishing metadata и без случайного first-item default.
- [ ] 3.7 Довести TST-120 positive, ambiguous, stale и changed-input scenarios до GREEN.

## 4. PDF text-quality и selective OCR

- [ ] 4.1 Реализовать page feature extractor: usable characters, replacement/control ratio, garbled/repetition patterns, boundary coverage и parser warnings.
- [ ] 4.2 Реализовать versioned PDF text-quality detector и synthetic calibration fixtures для positive/negative outcomes.
- [ ] 4.3 Создавать OCR tasks только для failed page indices с page-scoped context/grant/budget.
- [ ] 4.4 Реализовать immutable extracted/OCR page artifacts и deterministic merge по stable page index с selected method/provenance.
- [ ] 4.5 Реализовать locator remapping/integrity gate после mixed-method merge.
- [ ] 4.6 Реализовать post-OCR gate и loop guard, запрещающий повтор той же page branch без нового evidence/source/policy.
- [ ] 4.7 Довести TST-121 и no-whole-document/no-extra-provider-call assertions до GREEN.

## 5. Transcript anomaly и alternative stream

- [ ] 5.1 Расширить media probe stable stream identities, codec/channels/duration и speech/content features для каждой supported stream.
- [ ] 5.2 Реализовать transcript anomaly detector по duration, words/utterances, timestamp coverage, speech evidence, provider status/confidence и continuity.
- [ ] 5.3 Добавить negative guard: короткий, но содержательный transcript должен проходить без fallback.
- [ ] 5.4 Заменить hardcoded first-stream-only extraction branch: первая stream остаётся default, alternative разрешена только при `ALTERNATIVE_PATH`.
- [ ] 5.5 Реализовать initial hard limit максимум одной alternative stream, budget reservation и deterministic stream ranking по probe evidence.
- [ ] 5.6 Сохранять отдельные audio/STT artifacts, detector evidence и selected validated transcript provenance для каждой проверенной stream.
- [ ] 5.7 Реализовать escalation проверить/заменить recording после исчерпания streams/budget без full media rerun.
- [ ] 5.8 Довести TST-122 normal, fallback-success, short-valid и all-invalid scenarios до GREEN.

## 6. Локальный evidence repair

- [ ] 6.1 Расширить evidence gate structured violation claim ID, artifact/version mismatch и разрешёнными source fragment identities.
- [ ] 6.2 Реализовать claim dependency closure и минимальный repair context manifest без unrelated sections/candidate data.
- [ ] 6.3 Реализовать bounded outcomes add/fix locator, downgrade to insufficiency и remove unsupported confirmed claim как successor artifact.
- [ ] 6.4 Реализовать semantic-impact gate для recommendation, stop factor, access-to-KE и cross-section dependencies.
- [ ] 6.5 Переводить semantic repair в targeted replan вместо local merge; upstream extraction/OCR/STT переиспользовать.
- [ ] 6.6 Добавить post-repair evidence/consistency gates и запрет вымышленного locator при отсутствии source support.
- [ ] 6.7 Довести TST-123 и exact upstream/full-assessment call-count assertions до GREEN.

## 7. Assessment decomposition и merge

- [ ] 7.1 Реализовать model context/output preflight по versioned context manifest и фактическому configured model limit.
- [ ] 7.2 Зарегистрировать bounded section map facts/evidence, experience, ABC, competencies, access-to-KE, risks/stop-factors и conflicts.
- [ ] 7.3 Реализовать immutable section task schemas с общим input/profile/config fingerprint и запретом section-level final recommendation.
- [ ] 7.4 Реализовать block-on-missing/invalid section и local recovery только затронутого subtask.
- [ ] 7.5 Реализовать deterministic merge по stable section/claim IDs с duplicate deduplication без повышения confidence.
- [ ] 7.6 Реализовать cross-section contradiction detection и locator referential-integrity gate.
- [ ] 7.7 Повторно применять global evidence/conflict/stop-factor/access-to-KE gates и вычислять deterministic recommendation ровно один раз после merge.
- [ ] 7.8 Довести TST-124 context-limit, invalid-section, conflict и duplicate scenarios до GREEN.

## 8. Adaptive escalation, metrics и rollout

- [ ] 8.1 Зарегистрировать typed actions `select-primary-file`, `confirm-speaker-role`, `replace-file`, `accept-insufficient-data`, `cancel-run` с eligibility/schema checks.
- [ ] 8.2 Расширить escalation UI safe detector evidence, branches, impact, reused artifacts и concrete next action без общего retry-all fallback.
- [ ] 8.3 Реализовать metrics detector outcomes, false-positive reviews, branch attempts/success, avoided reruns, escalation/human wait и additional time/cost без personal text.
- [ ] 8.4 Добавить per-obstacle shadow/active feature flags и rollback к canonical path без удаления immutable adaptive artifacts.
- [ ] 8.5 Провести synthetic calibration и включать branches последовательно: material ambiguity, selective OCR, alternative audio, evidence repair, decomposition.
- [ ] 8.6 Довести TST-120–TST-125 и focused security/budget/loop tests до GREEN.
- [ ] 8.7 На одной production-like сборке запустить TST-110–TST-125 и полный набор `E2E-VAC-001`, `E2E-TRN-001`, `E2E-ABC-001`, `E2E-RESULT-001`.
- [ ] 8.8 Проверить 30-дневный evidence package, absence of cross-candidate context, hard budgets и cleanup; не завершать change при неполных dependency contours.
