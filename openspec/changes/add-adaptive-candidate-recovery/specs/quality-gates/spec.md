## ADDED Requirements

### Requirement: TST-120 [CONFIRMED] Material ambiguity не допускает silent selection
Независимый acceptance suite MUST проверить один однозначный primary material, два правдоподобных resume, два правдоподобных interview, stale HR selection и изменение files во время ожидания. Oracle MUST проверять отсутствие STT/assessment до разрешения ambiguity, устойчивые File IDs, versioned selection и same-run resume только при неизменной input version.

#### Scenario: Два интервью требуют выбора
- **WHEN** controlled manifest содержит две одинаково правдоподобные recordings
- **THEN** provider fixture не получает STT job до решения HR
- **AND** escalation содержит оба File IDs и конкретное действие выбора

### Requirement: TST-121 [CONFIRMED] Selective OCR проверяется на смешанном PDF
Acceptance MUST использовать PDF с пригодной text page, scanned page и непустой, но повреждённой text-layer page. Oracle SHALL проверить detector metrics, OCR calls только для failed pages, отдельные raw artifacts, deterministic merge и запрет повторного OCR без нового evidence.

#### Scenario: OCR вызван выборочно
- **WHEN** две из трёх страниц не проходят quality gate
- **THEN** RouterAI fixture получает ровно два page calls
- **AND** locator каждой merged page сохраняет правильный method/provenance

### Requirement: TST-122 [CONFIRMED] Alternative audio stream запускается только после anomaly gate
Acceptance MUST проверить normal first stream, аномально пустую first stream с речью на второй, короткое содержательное интервью и отсутствие валидной речи на всех streams. Oracle MUST считать FFmpeg/STT calls, проверять budget, artifacts/provenance и содержательную terminal escalation без бесконечного перебора.

#### Scenario: Вторая stream восстанавливает transcript
- **WHEN** первая stream даёт доказуемую anomaly, а вторая возвращает валидную стенограмму
- **THEN** assessment использует validated fallback transcript
- **AND** существует ровно по одному разрешённому STT attempt на проверенную stream

#### Scenario: Первая stream валидна
- **WHEN** transcript проходит gate
- **THEN** вторая stream не извлекается и не отправляется провайдеру

### Requirement: TST-123 [CONFIRMED] Evidence repair остаётся локальным
Acceptance MUST инъецировать один missing locator, отсутствующее подтверждение и repair, меняющий смысл recommendation. Oracle SHALL проверять context manifest, отсутствие upstream reruns, successor artifact/provenance и replan при semantic impact.

#### Scenario: Исправлен один locator
- **WHEN** source fragment подтверждает claim
- **THEN** выполняется один bounded repair и повторная evidence gate
- **AND** Drive/OCR/STT/full-assessment call counts не увеличиваются

#### Scenario: Evidence отсутствует
- **WHEN** разрешённые fragments не подтверждают claim
- **THEN** repair не создаёт locator
- **AND** итог использует нормативное состояние недостаточности

### Requirement: TST-124 [CONFIRMED] Decomposition и merge не меняют assessment rules
Acceptance MUST принудительно вызвать context-limit decomposition, invalid one-section output, cross-section conflict и duplicate claim. Oracle MUST проверить общий input/profile fingerprint, bounded section scopes, block-on-missing, deterministic deduplication, global gates и единственный formula calculation после merge.

#### Scenario: Большой анализ разделён
- **WHEN** preflight превышает configured context limit
- **THEN** runtime создаёт только registered section tasks в пределах replan budget
- **AND** ни один subtask не публикует самостоятельную recommendation

#### Scenario: Sections конфликтуют
- **WHEN** controlled outputs содержат несовместимые claims с evidence
- **THEN** merge создаёт conflict вместо silent overwrite
- **AND** публикация ждёт применимого repair/replan либо normative conflict outcome

### Requirement: TST-125 [CONFIRMED] Adaptive recovery имеет bounded regression gate
После focused RED/GREEN одна production-like сборка MUST пройти TST-120–TST-124, TST-110–TST-116 и четыре обязательных canonical E2E. Evidence package SHALL включать obstacle/detector/branch timeline, tool call counts, budgets, reused artifacts, escalation/resume и отсутствие cross-candidate data. Change MUST оставаться незавершённым без provisioned agent runtime и canonical pipeline.

#### Scenario: Focused adaptive tests зелёные на mock orchestration
- **WHEN** durable restart/lease и canonical E2E не запускались на той же сборке
- **THEN** change не считается готовым к production или archive
- **AND** missing contour фиксируется как blocker, а не N/A без основания
