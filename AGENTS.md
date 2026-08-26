# AGENTS.md

## Перед началом работы

Работайте из корня репозитория. Сначала прочитайте:

- [обзор документации](docs/README.md);
- [фактическую архитектуру](docs/ARCHITECTURE.md);
- [машиночитаемый индекс компонентов](docs/index.json);
- все main specs из раздела ниже;
- `proposal.md`, `design.md`, `tasks.md` и delta specs выбранного active change, если работа ведётся в его рамках.

Перед изменениями выполните `git status --short`. Рабочее дерево может содержать незавершённые изменения пользователя: не откатывайте, не перезаписывайте и не форматируйте несвязанные файлы.

## Источники истины и приоритет

1. Согласованные продуктовые требования задают только main specs в `openspec/specs/`.
2. `docs/ARCHITECTURE.md` и `docs/index.json` описывают фактическое устройство кода, но не изменяют требований.
3. Active changes в `openspec/changes/` описывают предлагаемые отклонения. Они становятся нормативными только после review и синхронизации delta specs с main specs.
4. Код, тест, README или сохранённый evidence не являются доказательством согласования требования.
5. `TBD` нельзя закрывать предположением, значением из конфигурации или поведением текущей реализации.

Известный разрыв на 2026-08-26: текущие runtime/docs/E2E harness используют Node/Nitro, PostgreSQL 16 и personal My Drive OAuth, тогда как `INT-005` и стартовые условия `TST-011` main specs всё ещё требуют корпоративный Shared Drive и service account. До явной синхронизации specs приёмка по main specs обязана показывать этот конфликт как RED/BLOCKED; запрещено молча переписывать oracle под реализацию или заявлять production readiness.

## Нормативные спецификации OpenSpec

- [Продукт и границы MVP](openspec/specs/product-scope/spec.md)
- [Сценарий обработки кандидата](openspec/specs/candidate-workflow/spec.md)
- [Оценка и доказательность](openspec/specs/assessment-and-evidence/spec.md)
- [Параметры вакансии](openspec/specs/vacancy-profile/spec.md)
- [Итоговый отчёт и уведомления](openspec/specs/reporting-and-notifications/spec.md)
- [Интеграции и эксплуатационные требования](openspec/specs/integrations-and-operations/spec.md)
- [Данные, доступ и безопасность](openspec/specs/data-and-security/spec.md)
- [Тестовая документация и контроль качества](openspec/specs/quality-gates/spec.md)

## Фактический runtime

- `web/scripts/run-runtime-process.ts` запускает процессы `web`, `worker`, `media`, `document`, `controller` и приватный `benchmark`.
- Публичные и внутренние Nitro routes находятся в `web/app/api/`.
- Durable queue, leases/fencing, checkpoints, escalation и outbox находятся в `web/server/agent-runtime/`.
- Discovery, extraction, transcription, evidence, assessment, reports и notifications находятся в `web/server/candidate-pipeline/`.
- PostgreSQL migrations и storage находятся в `web/server/storage/` и `web/drizzle-postgres/`.
- Локальный lifecycle: `deploy/local/local.ps1`; Ubuntu release: `deploy/ubuntu/install.sh`.
- Runtime secrets не лежат в env: локально используются `web/.runtime/runtime.env` и точный allowlist файлов в `web/.runtime/credentials/`. Не читайте, не печатайте и не добавляйте их в evidence.

## Рабочий процесс изменения

1. Найдите requirement ID в main specs и проверьте, нет ли в решении `TBD` или противоречия с active change.
2. Для нового или изменённого поведения сначала согласуйте OpenSpec change. Не редактируйте main specs неявно вместе с реализацией.
3. После согласования независимый субагент, не участвующий в реализации, пишет или обновляет исполняемый приёмочный тест и фиксирует ожидаемый продуктовый RED. Ошибка инфраструктуры не считается продуктовым RED.
4. Реализуйте минимальное изменение, затем выполните focused test, связанный acceptance test и релевантную регрессию.
5. После изменений кода, модели, инструкции, схемы или интеграции обязательны все четыре production-like E2E на одном immutable build/config/fixture identity.
6. Обновляйте `docs/ARCHITECTURE.md` и `docs/index.json`, если изменились границы модулей, точки запуска, хранилища или основные потоки.

## Команды проверки

Команды выполняются из `web/`:

```powershell
npm test
npm run test:postgres-integration
npm run test:vps-postgres
npm run test:e2e-harness
npm run e2e:preflight
npm run e2e:required
```

- `npm test` — основной build/unit/rendered/acceptance regression, но не замена обязательному production-like E2E.
- `test:e2e-harness` проверяет только конфигурацию и control/readiness contracts; его GREEN не подтверждает пользовательский сквозной сценарий.
- `e2e:preflight` обязан fail closed. Отсутствующая среда, identity, PostgreSQL, Drive, provider smoke, Telegram или control plane означает BLOCKED, а не PASSED.
- `e2e:required` содержит `E2E-VAC-001`, `E2E-TRN-001`, `E2E-ABC-001`, `E2E-RESULT-001`. Skipped/blocked сценарий не закрывает release gate.
- Приёмочные тесты должны наблюдать поведение через публичную/application boundary и проверять содержательные артефакты. Статический поиск строк, mock-only conformance и заранее записанный JSON не доказывают production behavior.
- JUnit, JSON, timeline, Playwright report и другие evidence-файлы генерируются прогоном. Не исправляйте их вручную ради GREEN и не коммитьте секреты, raw prompts, PII или private trace content.

## Обязательный приёмочный контур

- `E2E-VAC-001`: создание вакансии от единственного поля названия, контролируемая LLM-генерация, правки HR, сохранение первой версии и прохождение кандидата по новой вакансии.
- `E2E-TRN-001`: реальный FFmpeg + AssemblyAI, три согласованных представления стенограммы, контрольные фразы, порядок, speakers и допустимые таймкоды.
- `E2E-ABC-001`: полный ABC-PDF, доказательства и идентичность версии.
- `E2E-RESULT-001`: два согласованных versioned PDF, нормативные разделы, recommendation matrix, идемпотентная публикация и `REPORT_VERSION_CONFLICT` без перезаписи.

Полный набор запускается перед production-релизом и после изменений кода, моделей, инструкций, схем или интеграций. Функция не завершена, если связанный тест отсутствует, не независим, невоспроизводим или не входит в обязательный запуск.

## Безопасность и внешние эффекты

- Используйте только синтетические fixture/golden data. Не читайте каталог `candidate/` и реальные материалы кандидатов без явного разрешения.
- Не запускайте provider-expensive, effectful Drive/Telegram или destructive cleanup команды без явно подготовленной тестовой среды и требуемого consent-флага.
- Не передавайте секреты через CLI arguments, stdout, логи, screenshots или отчёты.
- Не применяйте destructive down migrations. Rollback сохраняет durable state и использует только forward-compatible schema.
