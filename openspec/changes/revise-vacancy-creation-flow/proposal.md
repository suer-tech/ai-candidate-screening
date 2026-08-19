## Why

Текущий canonical create-vacancy flow требует LLM-генерацию, draft, preview и отдельную активацию, тогда как владелец выбрал один последовательный ручной flow. Нужен единый контракт, в котором сохранение валидного полного профиля атомарно создаёт active vacancy и её Drive-папку без скрытых промежуточных пользовательских состояний.

## What Changes

- **BREAKING:** удалить из create-vacancy flow кнопку генерации, RouterAI-вызов, generated draft, preview и отдельную activation action.
- Требовать на первом шаге уникальное название с регистронезависимой нормализацией пробелов, затем открывать полный ручной editor.
- Инициализировать editor versioned non-LLM standard ABC template и не сохранять несохранённую форму как draft.
- Сделать `Сохранить вакансию` единственным commit action: серверная валидация, версия 1, automatic activation и idempotent Drive folder binding образуют один externally atomic outcome.
- Не делать vacancy доступной intake/analysis до успешного завершения всей save operation.
- Добавить recovery, audit и acceptance scenarios без фиксации модели, provider endpoint или конкретного storage/runtime stack.

## Capabilities

### New Capabilities

Нет.

### Modified Capabilities

- `vacancy-profile`: заменить LLM/draft/preview/activation flow ручным unique-name editor и atomic save+activate contract.
- `integrations-and-operations`: добавить idempotent creation и binding Drive vacancy folder как часть успешного save outcome.
- `quality-gates`: заменить generation acceptance на ручной create-vacancy, uniqueness, discard/reset, validation и Drive recovery scenarios.

## Impact

- Затрагиваются vacancy UI, server validation, profile version persistence, active vacancy registry, Drive integration и audit.
- Generation-specific requirements `VAC-030–039` и tests становятся удаляемыми; другие LLM capabilities проекта не изменяются.
- Product code не реализуется этим planning change.
