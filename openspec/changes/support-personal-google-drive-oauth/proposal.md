## Why

Владелец и будущие операторы системы используют личные Gmail-аккаунты без Google Workspace. Поэтому Shared Drive и сервисный аккаунт не являются допустимой частью продукта. Системе нужен единственный поддерживаемый способ работы с файлами: Google Drive API от явно подключённого личного аккаунта через безопасный server-side OAuth 2.0 с автономным обновлением доступа.

## What Changes

- **BREAKING:** удалить обязательность и runtime-поддержку корпоративного Shared Drive и service-account credentials; единственным Google Drive backend становится личный `Мой диск` через OAuth.
- Добавить авторизованный web-server OAuth flow: начало подключения, Google callback, одноразовые `state` и PKCE, offline consent, выбор/создание корня `Найм`, статус, отключение и повторное подключение.
- Хранить OAuth client secret только в server secret, а refresh token — только в зашифрованном durable server-side хранилище; не передавать credentials браузеру, worker payload, журналам или OpenSpec.
- Автоматически обновлять access token после рестартов web/worker и переводить Drive-задачи в содержательное `WAITING_FOR_HUMAN` при `invalid_grant`, отзыве доступа или необходимости повторного согласия.
- Использовать scope `https://www.googleapis.com/auth/drive`, потому что система должна автоматически видеть файлы, которые HR самостоятельно помещает в отслеживаемую структуру. Ограничить все прикладные операции связанным корнем `Найм` через server-side grants и проверку ancestry.
- Разделить OAuth consent состояния `Testing` и `In production`: семидневный testing grant разрешён для разработки, но не удовлетворяет готовности постоянного Ubuntu VPS.
- Сохранить структуру `Найм/<Вакансия>/<Кандидат>/`, устойчивые Google File/Folder ID, publication/reconcile/cleanup и существующие product invariants.
- Обновить preflight и обязательный E2E: реальное подключение личного Gmail, чтение входов, публикация PDF, cleanup, restart token refresh, отзыв grant и восстановление после повторной авторизации без дубликатов.

## Capabilities

### New Capabilities

- `google-drive-oauth`: полный lifecycle server-side OAuth, root-folder binding, token refresh/revocation recovery и Google Drive API adapter для личного `Моего диска`.

### Modified Capabilities

- `data-and-security`: заменить production service-account boundary на защищённый OAuth личного Gmail, определить хранение токенов, область доступа, аудит и отзыв.
- `integrations-and-operations`: сделать My Drive OAuth единственной Google Drive интеграцией, определить readiness, refresh/reconnect и worker behavior.
- `quality-gates`: принимать систему реальными OAuth E2E-сценариями и запрещать production claim при семидневном testing grant либо непроверенном recovery.

## Impact

- Web/API: закрытые маршруты Google OAuth и экран состояния интеграции.
- Durable data: D1 connection/root binding и зашифрованный refresh token.
- Runtime: OAuth access-token provider, My Drive discovery/publication/cleanup и agent escalation; существующий Shared Drive adapter выводится из production wiring.
- Secrets: OAuth client ID/client secret, отдельный 256-bit token-encryption key и точные redirect URI для localhost и VPS.
- Google Cloud: External OAuth audience, Drive API, restricted Drive scope, отдельные localhost и production web clients; для ограниченного личного использования возможно предупреждение Google о непроверенном приложении.
- Tests/operations: independent ATDD RED, focused OAuth/security tests, полный обязательный E2E и runbook/check scripts для локального Windows и Ubuntu VPS.
