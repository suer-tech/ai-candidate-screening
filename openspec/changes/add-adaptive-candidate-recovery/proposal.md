## Why

Durable runtime гарантирует продолжение и ограничивает действия, но сам по себе не знает, как распознать реалистичные domain obstacles: неоднозначные материалы, формально непустой, но бесполезный PDF text layer, аномально пустую стенограмму или единичный пробел evidence. Нужны согласованные adaptive policies, чтобы агент локально диагностировал и исправлял такие случаи, а не повторял весь pipeline или завершался общей ошибкой.

## What Changes

- Добавить проверяемые obstacle detectors для неоднозначного material manifest, низкокачественного PDF text layer, аномально пустой/неполной transcript и локальных evidence/assessment defects.
- Добавить policy выбора между deterministic repair, альтернативным tool path, bounded decomposition/replan и human escalation.
- При нескольких правдоподобных резюме или интервью не угадывать silently: использовать доказуемую classification policy, а при неразрешимой неоднозначности просить HR выбрать конкретные файлы.
- Для страниц с формально существующим, но непригодным text layer разрешить selective OCR только проблемных страниц и доказуемое объединение результатов.
- **BREAKING:** заменить безусловное использование только первой аудиодорожки на диагностический fallback: альтернативная дорожка MAY обрабатываться только после anomaly gate и content probe, в пределах бюджета и с provenance.
- Для одного отсутствующего/невалидного evidence locator выполнять локальный repair утверждения, не повторяя extraction, OCR, STT и весь assessment.
- При context/output limit декомпозировать assessment на bounded subtasks по согласованным разделам, затем объединять их только через schema/evidence/consistency gate.
- Ограничить domain repairs и replans budgets/obstacle fingerprints; повтор без нового evidence запрещён.
- Формировать domain-specific escalation с конкретным выбором файла, подтверждением роли, заменой материала или ручным решением по неустранимой неоднозначности.
- Не добавлять автоматическое кадровое решение, cross-candidate memory или новые assessment criteria.

## Capabilities

### New Capabilities

- `adaptive-candidate-recovery`: domain obstacle taxonomy, detector evidence, bounded recovery branches, decomposition/merge и concrete escalation policies.

### Modified Capabilities

- `candidate-workflow`: определить поведение при нескольких правдоподобных материалах и связь human selection с immutable input version/run.
- `integrations-and-operations`: добавить selective OCR по quality gate и диагностический выбор альтернативной audio stream вместо жёсткого first-stream-only fallback.
- `assessment-and-evidence`: добавить локальный repair evidence и проверяемую decomposition/merge при context/output limits.
- `quality-gates`: добавить независимые adaptive acceptance-сценарии и доказательства отсутствия full-pipeline rerun, silent guessing и бесконечных loops.

## Impact

- Затрагиваются material classifier, document quality metrics, OCR router, media probe/FFmpeg selection, transcript quality gates, evidence graph, assessment planner/evaluator, escalation UI и test fixtures.
- Change зависит от `add-durable-agent-runtime` и `implement-canonical-candidate-pipeline`; adaptive branches не должны иметь отдельную очередь, memory или side-effect protocol.
- Потребуются новые versioned detector/recovery policies и metrics для false positive/repair success/escalation rate.
- Existing first-audio-stream implementation и связанные tests потребуют изменения только после независимого RED acceptance.
