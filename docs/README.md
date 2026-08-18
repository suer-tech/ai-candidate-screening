# Документация AI-скриннера

Статус карты проекта: обновлена 2026-08-18. Исходное ТЗ сохранено в корне проекта и не изменяется.

Каталог `docs/` содержит только карту и архитектурное описание проекта. Единственный нормативный источник продуктовых требований — main specifications в `openspec/specs/`.

## Карта проекта

1. [Архитектура и потоки](ARCHITECTURE.md)
2. [Машиночитаемый индекс компонентов](index.json)

## Нормативные спецификации

1. [Продукт и границы MVP](../openspec/specs/product-scope/spec.md)
2. [Сценарий обработки кандидата](../openspec/specs/candidate-workflow/spec.md)
3. [Оценка и доказательность](../openspec/specs/assessment-and-evidence/spec.md)
4. [Параметры вакансии](../openspec/specs/vacancy-profile/spec.md)
5. [Итоговый отчёт и уведомления](../openspec/specs/reporting-and-notifications/spec.md)
6. [Интеграции и эксплуатационные требования](../openspec/specs/integrations-and-operations/spec.md)
7. [Данные, доступ и безопасность](../openspec/specs/data-and-security/spec.md)
8. [Тестирование и production gate](../openspec/specs/quality-gates/spec.md)

## Статусы требований

- `CONFIRMED` — согласовано и обязательно для реализации.
- `TBD` — решение ещё должно быть принято.
- `POST-MVP` — за пределами первой версии.
- `ASSUMPTION` — рабочее предположение, которое нужно подтвердить.

Идентификаторы требований стабильны. Изменения оформляются в `openspec/changes/` и после review синхронизируются с main specs; наличие требования в спецификации не является доказательством его реализации.
