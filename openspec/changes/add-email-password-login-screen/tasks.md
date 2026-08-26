## 1. Независимая приёмка

- [x] 1.1 Передать независимому субагенту RED acceptance для password credentials, forced password change, sessions, remember TTL, logout/revoke, route protection, CSRF, rate limit, safe errors, audit и operator lifecycle.
- [x] 1.2 Добавить независимый RED UI-test для login shell, синтетической композиции, тем, keyboard flow и отсутствия product fetch до session authentication.
- [x] 1.3 Зафиксировать ожидаемый RED-результат до изменения production-кода.

## 2. PostgreSQL auth model

- [x] 2.1 Добавить schema и forward-only migration для `auth_users`, `auth_sessions`, `auth_login_attempts` и `auth_security_events` с индексами, constraints и retention-compatible timestamps.
- [x] 2.2 Реализовать canonical email, versioned scrypt hash envelope, password policy, constant-time verification и dummy verification неизвестного пользователя.
- [x] 2.3 Реализовать repository/domain transactions для create/reset/enable/disable user, forced password change и atomic session revoke.
- [x] 2.4 Добавить unit и real-PostgreSQL integration tests schema, hashing, concurrency, expiry и rollback behavior.

## 3. Sessions и защита запросов

- [x] 3.1 Реализовать случайные opaque session tokens, hash-only persistence, 12-hour/30-day TTL, rotation, logout и revoke-all.
- [x] 3.2 Реализовать local/VPS cookie policy, безопасный return path и session-bound CSRF proof с Origin/Host validation.
- [x] 3.3 Заменить local/VPS header principal на async session authentication, сохранив отдельные internal service auth boundaries.
- [x] 3.4 Проинвентаризировать все browser/product routes и добавить fail-closed protection matrix с явным минимальным public allowlist.
- [x] 3.5 Ограничить E2E identity bypass локальным E2E-режимом и добавить production preflight rejection.

## 4. Login defense и аудит

- [x] 4.1 Реализовать PostgreSQL-backed sliding-window limit: пять ошибок за 15 минут и блокировка пары email/source на 15 минут.
- [x] 4.2 Унифицировать ответы неизвестного, неверного, disabled и locked пользователя и исключить timing shortcut для неизвестного email.
- [x] 4.3 Записывать safe security events для login/logout/block/password/user/session lifecycle без credentials, tokens и plaintext source identifiers.
- [x] 4.4 Добавить cleanup ограниченных по retention attempts, expired/revoked sessions и security events.

## 5. Операторское управление

- [x] 5.1 Добавить интерактивные host-only CLI-команды create/reset/enable/disable user и revoke sessions без password в argv, stdout или source files.
- [x] 5.2 Добавить local bootstrap/check и VPS preflight для schema, session secret, HTTPS origin, first active HR и запрета test bypass.
- [x] 5.3 Обновить local/VPS runbooks для создания Алсу Салямовой с фактическим корпоративным email, восстановления доступа, unlock и emergency revoke.

## 6. Интерфейс входа

- [x] 6.1 Добавить server-gated auth shell, который без валидной session не монтирует dashboard и не запускает product API fetch.
- [x] 6.2 Реализовать форму email/password с show-password, remember, loading, generic errors, session-expired feedback и безопасным return path.
- [x] 6.3 Реализовать forced password change и выход; «Забыли пароль?» направляет к оператору без account enumeration.
- [x] 6.4 Добавить слева `aria-hidden` синтетическую композицию карточки кандидата, этапов и AI-результата без API-вызовов.
- [x] 6.5 Адаптировать login UI к светлой/тёмной теме, desktop/tablet/mobile и keyboard/focus accessibility без text glow.

## 7. Local и VPS rollout

- [ ] 7.1 Запустить local PostgreSQL integration, auth acceptance, route-matrix, UI regression и обязательный E2E-набор на созданной тестовой учётной записи.
- [x] 7.2 Обновить nginx: после auth readiness удалить Basic Auth и постоянный principal header, очищать входящие identity headers и сохранить HTTPS/proxy cookie semantics.
- [ ] 7.3 Выполнить двухфазный VPS smoke: migration/bootstrap/login под временным Basic Auth, затем app-auth-only login/logout/API denial и повторный production preflight.
- [ ] 7.4 Проверить rollback предыдущего release без destructive down migration и задокументировать evidence.
- [x] 7.5 Подтвердить, что `.openai/hosting.json`, Sites bindings, `chatgpt.site` source branch и опубликованная версия не изменялись и не деплоились.
