## 1. Независимый ATDD-контур

- [x] 1.1 Передать согласованные requirements независимому субагенту, не участвующему в implementation, для исполняемой приёмки TST-120.
- [x] 1.2 Добавить synthetic OAuth/Drive fixtures для callback, restart refresh, root confinement, revoke/reconnect и resume без дубликатов.
- [x] 1.3 Запустить приёмку до production-кода, получить ожидаемый RED и сохранить JUnit/JSON evidence без credentials.
- [x] 1.4 Обновить тестовую документацию с local, controlled и provisioned E2E-командами.

## 2. Конфигурация и durable schema

- [x] 2.1 Удалить из production readiness обязательность Shared Drive ID и service-account JSON; отклонять их как Drive backend.
- [x] 2.2 Добавить типизированную конфигурацию OAuth client ID, server-only client secret, deployment mode, точного callback URI и versioned encryption keyring.
- [x] 2.3 Добавить D1 migration для singleton Google connection, owner identity, scopes, root binding, state, timestamps, token envelope и optimistic version.
- [x] 2.4 Добавить D1 migration для one-time OAuth operation: state hash, encrypted PKCE verifier, initiator, redirect URI, expiry и consumed timestamp.
- [x] 2.5 Реализовать repository с atomic consume state, единственным active connection, optimistic fencing и запретом plaintext token columns.
- [x] 2.6 Добавить schema/repository tests на unique constraints, replay, expiry, concurrency и сохранение product data при disconnect.

## 3. Шифрование и token provider

- [x] 3.1 Реализовать AES-256-GCM envelope refresh token с AAD из connection ID, Google subject, scopes и key version.
- [x] 3.2 Реализовать versioned keyring, запись active key и controlled rewrap старых token envelopes.
- [x] 3.3 Реализовать redaction OAuth code, client secret и tokens во всех errors, logs, metrics, task payload и evidence.
- [x] 3.4 Реализовать in-memory access-token cache со skew и single-flight refresh для web/worker конкуренции.
- [x] 3.5 Атомарно сохранять новый refresh token от Google, не теряя прежний при неуспешной операции.
- [x] 3.6 Классифицировать transient 429/5xx для bounded retry и `invalid_grant`/configuration/account errors для escalation.
- [x] 3.7 Добавить crypto/token tests на tamper, AAD, rotation, restart, concurrent refresh и sanitization.

## 4. Безопасный OAuth web flow

- [x] 4.1 Добавить закрытый HR route начала подключения с 256-bit state, PKCE S256, offline access, consent и allowlisted return path.
- [x] 4.2 Формировать redirect только из server config: localhost для локального контура и точный HTTPS URI VPS.
- [x] 4.3 Добавить callback с проверкой operation/principal, TTL, state, PKCE и atomic one-time consume до code exchange.
- [x] 4.4 Обменивать authorization code server-side, требовать refresh token и получать проверенную Google identity owner.
- [x] 4.5 Сделать callback idempotent: browser retry не меняет connection и не раскрывает exchange result.
- [x] 4.6 Заблокировать автоматическую замену owner при callback другого Google subject.
- [x] 4.7 Добавить authenticated disconnect: revoke attempt, guaranteed local token deletion и сохранение Drive/product data.
- [x] 4.8 Добавить route tests на anonymous denial, CSRF/replay/expiry, redirect poisoning, missing refresh token и account mismatch.

## 5. Root binding и My Drive API adapter

- [x] 5.1 Выделить внутренний Drive port для list, metadata/version, download, ensure-folder, publish, reconcile и cleanup.
- [x] 5.2 Реализовать `GoogleMyDriveAdapter` без Shared Drive-specific `driveId/corpora=drive` и сделать его единственным production adapter.
- [x] 5.3 Удалить service-account adapter из startup, workers, preflight и effectful tool registry без удаления пользовательских данных.
- [x] 5.4 Создавать root `Найм` идемпотентно либо связывать Folder ID после server-side metadata/owner проверки.
- [x] 5.5 Реализовать discovery только сверху вниз от root с durable registration parent/file ancestry.
- [x] 5.6 Запретить operations для произвольного client File ID без root ancestry и соответствующего tool grant.
- [x] 5.7 Сохранить `Найм/<Вакансия>/<Кандидат>/`, operation identity, checksum и timeout-after-create reconcile.
- [x] 5.8 Добавить adapter tests на вручную добавленный HR file, повторную publication, version conflict, cleanup и выход за root.

## 6. Runtime, escalation и UI

- [x] 6.1 Подключить OAuth token provider и My Drive adapter к Drive tool executors, checkpoints, budgets и outbox.
- [x] 6.2 При `invalid_grant`/revocation ставить `REAUTH_REQUIRED`, блокировать Drive effects и создавать `WAITING_FOR_HUMAN`.
- [x] 6.3 После reconnect ожидаемого account публиковать resume event и reconcile unknown external outcome до повтора.
- [x] 6.4 Сохранить idempotency candidate, folders, versions и PDF при restart, reconnect и redelivery.
- [x] 6.5 Добавить allowlist status projection: owner email, root link, deployment mode, state, last refresh и action.
- [x] 6.6 Добавить HR UI Connect/Reconnect/Disconnect и выбора/создания root без credentials.
- [x] 6.7 Не выводить непроверенный Google Publishing status или вычисленную дату grant; сохранить production block для операторского `testing` и понятное действие без connection.
- [x] 6.8 Добавить runtime/UI tests на escalation, reconnect/resume, safe projection и отсутствие token в browser state.

## 7. Локальная и VPS-эксплуатация

- [x] 7.1 Создать ignored secret-file templates без значений и preflight leak checks; реальные credentials не принимать через чат.
- [x] 7.2 Добавить Windows checker для Drive API, OAuth client, callback, encryption key и D1 connection.
- [x] 7.3 Документировать Google Cloud project, External consent screen, test user, OAuth web client и localhost callback.
- [x] 7.4 Документировать consent screen `In production`, отдельный VPS web client и точный HTTPS callback domain.
- [x] 7.5 Добавить Ubuntu VPS secret/config template, systemd/runtime wiring и restart-safe connection check без secret output.
- [x] 7.6 Обновить readiness: OAuth config, decrypt probe, active owner, root read/write и запрет `testing` для production.
- [x] 7.7 Добавить rollout/rollback runbook; rollback выключает Drive effects и не возвращает service-account backend.

## 8. Проверка и доказательства

- [x] 8.1 Получить GREEN focused schema, crypto, OAuth routes, adapter, runtime, security и UI tests.
- [x] 8.2 Получить GREEN независимой приёмки TST-120 и подтвердить отсутствие secrets в evidence.
- [x] 8.3 Выполнить typecheck, lint, change tests, полный regression и strict OpenSpec validation.
- [x] 8.4 Пройти local real-OAuth smoke на synthetic root `Найм`: consent, restart refresh, read, publish, reconcile и cleanup.
- [ ] 8.5 На immutable VPS build пройти production-personal preflight и `E2E-VAC-001`, `E2E-TRN-001`, `E2E-ABC-001`, `E2E-RESULT-001`.
- [ ] 8.6 На том же build пройти revoke/reconnect/account-mismatch matrix и доказать resume без дубликатов.
- [ ] 8.7 Сохранить build/config/fixture fingerprints и security review без credentials; не заявлять production readiness при skipped/controlled evidence.
- [ ] 8.8 После полного GREEN синхронизировать delta specs с main specs и архивировать отдельным явным действием.
