## ADDED Requirements

### Requirement: TST-094 [CONFIRMED] Dashboard queue и summary используют canonical data
Independent acceptance MUST seed every canonical state, archive and terminal error, then verify ordering, five-record limit, ETA fallback, exact seven primary cards, separate `TRANSCRIBING`, `ANALYZING`, `VALIDATING` counts/filters, archive count/filter/empty state, semantic tone mapping, text labels independent from color, responsive grid behavior, absence of primary `Ожидание стабильности`, absence of combined processing card, absence of `Активные вакансии` summary and absence of ratings/decision state.

#### Scenario: Mixed operational data показаны
- **WHEN** dashboard содержит failures, processing, ready and archived candidates
- **THEN** queue/workflow cards match current non-archived records and canonical grouping
- **AND** `TRANSCRIBING`, `ANALYZING`, `VALIDATING` have separate exact cards/filters and `WAITING_FOR_STABILITY` has no primary card
- **AND** archived candidates excluded from active counts and included exactly once in `Архив`
- **AND** archive click opens the general queue archive filter
- **AND** insufficient/processing stages/ready/failed/archive use amber/indigo/green/red/gray tones without changing recommendation colors or relying on color alone

### Requirement: TST-095 [CONFIRMED] Period and flow aggregation reject double counts
Matrix for `7/30/90` MUST verify local inclusive ranges, zero dates, vacancy series, current-success completion date, reprocess replacement and terminal-failure exclusion.

#### Scenario: Prior success superseded by failure
- **WHEN** candidate has old success and latest terminal failed run
- **THEN** flow graph has no count for either result version
- **AND** error card/queue contains candidate exactly once

### Requirement: TST-096 [CONFIRMED] Recommendation graph uses only canonical categories
Acceptance MUST verify exact four categories, current READY version, same period selection, filtered navigation and absence of percent/general score/demo labels.

#### Scenario: All categories seeded
- **WHEN** one current result exists in each category
- **THEN** block shows four counts and no fifth category
- **AND** total equals eligible current READY candidates in range

### Requirement: TST-097 [CONFIRMED] Greeting, Drive states and no-demo boundary are observable
Controlled clock/connectivity tests MUST cover all greeting boundaries, three Drive states and 15-second cycles. UI audit MUST fail on separate error panel, recruiter analytics, unsupported export/filter or static demo value.

#### Scenario: Drive check fails then recovers
- **WHEN** one check fails and next 15-second check succeeds
- **THEN** states pass through `Проверяем подключение`, `Нет подключения`, `Проверяем подключение`, `Подключён`
- **AND** no manual recovery action appears
