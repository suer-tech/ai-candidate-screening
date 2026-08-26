## Purpose

Определяет проверяемые domain-specific препятствия и ограниченные recovery policies, позволяющие кандидату продолжить обработку после локальной диагностики без полного повторного pipeline или скрытого угадывания.

## ADDED Requirements

### Requirement: ADV-001 [CONFIRMED] Detector создаёт доказуемый obstacle
Каждый adaptive detector SHALL иметь versioned policy, применимый stage/artifact type, измеримые входные признаки, outcome `NORMAL`, `REPAIRABLE`, `ALTERNATIVE_PATH`, `HUMAN_REQUIRED` либо `TERMINAL` и safe evidence. Detector MUST NOT изменять artifact или запускать tool сам; он только создаёт obstacle, который agent runtime сопоставляет с зарегистрированной recovery branch.

#### Scenario: PDF text layer признан непригодным
- **WHEN** versioned quality gate фиксирует измеримые нарушения пригодности на конкретных страницах
- **THEN** detector создаёт `ALTERNATIVE_PATH` со списком страниц и метриками
- **AND** OCR не запускается для страниц, прошедших gate

#### Scenario: Detector не имеет достаточных данных
- **WHEN** признаки не достигают ни одного доказуемого outcome
- **THEN** detector возвращает `HUMAN_REQUIRED` либо нормативное состояние недостаточности по policy
- **AND** не придумывает obstacle или repair

### Requirement: ADV-002 [CONFIRMED] Recovery выбирается в безопасном порядке
Для domain obstacle runtime SHALL сначала применить допустимый deterministic local repair, затем зарегистрированный alternative tool path, затем bounded decomposition/replan и только после этого human escalation, если предыдущие варианты неприменимы либо исчерпаны. Этап MAY быть пропущен, когда detector evidence доказывает его неприменимость. Full-pipeline rerun MUST NOT использоваться как default recovery.

#### Scenario: Исправим один locator
- **WHEN** все artifacts валидны, кроме одного отсутствующего evidence locator
- **THEN** runtime запускает local locator repair
- **AND** не повторяет Drive download, OCR, STT или полный assessment

#### Scenario: Local repair неприменим
- **WHEN** проблема относится к неоднозначному выбору двух интервью
- **THEN** runtime сразу создаёт human escalation выбора материала
- **AND** не пытается исправить ambiguity LLM-генерацией факта

### Requirement: ADV-003 [CONFIRMED] Повтор recovery требует нового evidence
Каждая adaptive attempt SHALL иметь obstacle fingerprint, входные artifact identities, expected change и budget charge. Одинаковая recovery branch MUST NOT повторяться для того же fingerprint, если detector inputs/evidence не изменились. Исчерпание branch либо domain budget SHALL создавать следующую policy branch или содержательную escalation.

#### Scenario: Selective OCR не улучшил страницу
- **WHEN** post-OCR gate возвращает тот же quality outcome без нового usable content
- **THEN** runtime не запускает OCR этой страницы повторно
- **AND** переходит к следующей разрешённой ветке или escalation

### Requirement: ADV-004 [CONFIRMED] Recovery сохраняет provenance и переиспользование
Adaptive output MUST ссылаться на исходный obstacle, прежние и новые artifacts, tool/policy versions и reused completed stages. Raw artifacts MUST оставаться неизменными; merged или repaired result SHALL быть новым successor artifact. Downstream task MUST использовать только результат, прошедший повторный применимый eval gate.

#### Scenario: Альтернативная аудиодорожка дала валидную стенограмму
- **WHEN** transcript gate принимает fallback result
- **THEN** assessment использует новый validated transcript artifact
- **AND** первая дорожка, её transcript и причина fallback остаются доступными для аудита

### Requirement: ADV-005 [CONFIRMED] Domain escalation предлагает конкретное решение
Adaptive escalation SHALL предлагать только actions, способные устранить зафиксированное препятствие: выбрать primary resume/interview, подтвердить speaker role, заменить конкретный файл, разрешить нормативную неоднозначность либо остановить run. Она MUST показывать безопасное detector evidence, выполненные branches, impact и reused artifacts; общее `Повторить всё` MUST NOT быть единственным действием.

#### Scenario: Два интервью одинаково правдоподобны
- **WHEN** classification policy не может доказуемо выбрать primary recording
- **THEN** HR видит оба файла с безопасными distinguishing metadata и выбирает один
- **AND** runtime объясняет, какие stages начнутся после выбора

### Requirement: ADV-006 [CONFIRMED] Adaptive quality измеряется отдельно
Система SHALL измерять detector outcomes, false-positive review outcomes, branch attempts, repair success, avoided expensive reruns, escalation rate, human wait и additional cost/time по policy version. Эти metrics MUST NOT содержать полный персональный текст и MUST NOT использоваться для автоматического изменения кадровых критериев.

#### Scenario: Policy сравнивается после rollout
- **WHEN** накоплены adaptive runs одной policy version
- **THEN** оператор видит success/escalation/cost metrics по obstacle class
- **AND** изменение thresholds выполняется новой configuration/policy version
