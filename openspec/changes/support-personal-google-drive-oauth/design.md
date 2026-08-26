## Context

См. `proposal.md` — Why. Пользователь имеет личный Gmail, поэтому Google Workspace Shared Drive и service account исключены. Existing app authentication остаётся отдельной границей: Google OAuth подключает файловое хранилище, а не заменяет вход HR. Durable runtime, D1, Drive File/Folder identity, outbox/reconcile и `WAITING_FOR_HUMAN` должны быть переиспользованы.

Google web-server OAuth позволяет получить offline refresh token. Consent screen в статусе Testing делает authorization/refresh grant недействительным через семь дней; для постоянного VPS нужен `In production`. Полный `drive` scope нужен для автоматического обнаружения файлов, которые HR кладёт в Drive вне app picker. Если правила Google потребуют verification/security assessment для фактического deployment, production rollout блокируется до выполнения этих требований.

## Goals / Non-Goals

**Goals:**

- один активный OAuth connection личного Gmail на окружение;
- Google Drive API как единственный файловый backend системы;
- durable token refresh и controlled reauthorization после `invalid_grant`;
- application-level confinement корнем `Найм` даже при широком Google scope;
- local Windows и Ubuntu VPS configuration/runbooks без передачи tokens через CLI или чат;
- fail-closed production readiness и полная ATDD/E2E доказательность.

**Non-Goals:**

- Google OAuth как аутентификация HR;
- Shared Drive, service account или локальное файловое хранилище;
- публичное multi-tenant подключение произвольного количества аккаунтов;
- Google Picker и `drive.file` intake, требующий ручного выбора каждого файла;
- обход OAuth verification/security-assessment требований;
- хранение Google password, browser cookies или вручную скопированного token.

## Decisions

### 1. My Drive OAuth — единственный Drive backend

Production wiring всегда использует `GoogleMyDriveAdapter`; выбор storage mode отсутствует. Общий внутренний Drive port покрывает list children, metadata/version, download, ensure folder, publish, reconcile и cleanup, но service-account adapter не участвует в запуске. My Drive adapter использует root Folder ID без Shared Drive-specific `driveId/corpora=drive`, сохраняя idempotency через `appProperties.operationIdentity` и checksum.

### 2. Google connection — singleton durable record с зашифрованным refresh token

D1 хранит одну active connection на environment: OAuth subject, безопасно отображаемый email, granted scopes, root Folder ID/name, deployment mode, status, timestamps, encryption key version и AES-256-GCM envelope refresh token. Ciphertext, nonce и authentication tag хранятся вместе; AAD связывает connection ID, account subject, scopes и key version. Ключевой материал приходит из versioned server secret keyring и никогда не записывается в D1.

Access token живёт только в memory cache до `expires_at - skew`. Single-flight refresh не допускает параллельный token storm. Refresh token обновляется атомарно, если Google возвращает новый. Для rotation новый active key применяется к новым writes; controlled rewrap обновляет старые rows.

### 3. OAuth operation хранится серверно и является одноразовой

Начальный authenticated route создаёт D1 operation с 256-bit state hash, PKCE verifier envelope, initiating user ID, exact redirect URI, fixed same-origin return path и expiry около 10 минут. Browser получает только redirect. Callback атомарно consumes operation до сохранения connection; code exchange выполняется server-side с configured client secret. Повторный callback ничего не меняет.

Локальный redirect фиксируется как `http://localhost:3000/api/integrations/google-drive/oauth/callback`; VPS использует точный HTTPS origin из environment. Redirect строится из allowlisted config, а не из `Host` или client parameter.

### 4. Scope `drive` компенсируется root grants и ancestry proof

`drive.file` не покрывает автоматически файлы, вручную загруженные HR в наблюдаемую папку. Поэтому connection запрашивает `https://www.googleapis.com/auth/drive`. Root bootstrap создаёт папку с operation identity либо принимает явно введённый Folder ID и проверяет metadata/owner.

Discovery идёт только сверху вниз от root и регистрирует parent/file identities. Tool grants содержат connection ID, root ID, candidate/input version и разрешённую operation. Download/publication/cleanup не принимают произвольный client File ID: repository подтверждает сохранённую ancestry/ownership связь.

### 5. Testing и production-personal являются операторскими readiness declarations

Конфигурация содержит `GOOGLE_OAUTH_DEPLOYMENT_MODE=testing|production-personal`, но Google API не подтверждает через этот flow фактический Publishing status consent screen. Поэтому UI не выводит вычисленную дату истечения и не называет connection тестовым только на основании локального флага. Для `testing` production preflight падает. Для `production-personal` оператор отдельно подтверждает, что OAuth consent screen опубликован `In production`. Runtime в любом режиме fail-closed реагирует на фактический `invalid_grant`.

### 6. OAuth failure становится typed escalation, а не terminal FAILED

Transient token endpoint 429/5xx использует bounded retry/backoff. `invalid_grant`, revoked consent, account mismatch и permanent configuration errors помечают connection `REAUTH_REQUIRED` или `MISCONFIGURED`, запрещают новые Drive effects и создают `WAITING_FOR_HUMAN` с safe reason/action. После reconnect expected account runtime получает resume event, восстанавливается с checkpoint и сначала выполняет reconcile unknown external outcome.

Отключение пытается вызвать Google revoke endpoint, затем независимо удаляет local encrypted token и переводит connection в `DISCONNECTED`. Drive files/product records не удаляются.

### 7. UI показывает connection facts, но не credentials

Экран интеграций показывает owner email только авторизованному HR, root folder link, connection state, last successful refresh и действия Connect/Reconnect/Disconnect. Deployment mode остаётся серверным readiness-фактом и не выдаётся за проверенный Google status. API projection формируется allowlist полей. Все OAuth routes используют existing app request principal и закрыты для anonymous requests.

## Risks / Trade-offs

- [Личный аккаунт — единая точка отказа] → явный owner/status, reauth escalation и документированная передача владения через отдельную migration operation.
- [Testing token может иметь ограниченный срок] → блокирующий production preflight и реакция на фактический `invalid_grant`; UI не выдумывает дату без подтверждения Google.
- [Restricted `drive` scope может потребовать verification/security assessment] → rollout блокируется до отдельного compliance подтверждения, если Google его потребует.
- [Широкий token технически видит весь My Drive] → server-only token, encrypted storage, root grants, no arbitrary IDs и security tests.
- [Refresh token часто возвращается только при первом consent] → offline access + `prompt=consent`, ошибка `GOOGLE_OAUTH_REFRESH_TOKEN_MISSING` без частичного connection.
- [Смена аккаунта разрывает Folder IDs] → account subject pinning и отдельная migration operation вместо автоматического resume.
- [Worker и web одновременно обновляют token] → D1 lease/single-flight fencing и атомарная запись token envelope.
- [Удаление ключа делает token невосстановимым] → versioned keyring, decrypt probe, staged rewrap и сохранение предыдущего ключа до завершения rotation.

## Migration Plan

1. Добавить schema/migration connection и OAuth operation tables, bindings и disabled-by-default rollout flag.
2. Независимому субагенту создать acceptance RED для OAuth lifecycle/security/recovery до production-кода.
3. Реализовать crypto/token repository, OAuth routes и safe integration projection.
4. Реализовать My Drive adapter и заменить service-account wiring во всех discovery/publication/cleanup paths.
5. Подключить root-scoped grants, readiness, escalation/resume и local/VPS runbooks/checkers.
6. Локально создать External Testing client, пройти consent, привязать синтетический `Найм` и выполнить focused tests.
7. Для VPS создать отдельный OAuth client с точным HTTPS callback, перевести consent screen в `In production`, установить secrets и выполнить четыре обязательных E2E плюс OAuth recovery matrix.
8. Включить Drive effects только после immutable build/config evidence. Rollback выключает новые goals и сохраняет encrypted token до явного disconnect; возврата к Shared Drive backend нет.
