## Context

См. `proposal.md` и delta `data-and-security`. Один код приложения имеет два целевых runtime-профиля: Windows local через `deploy/local` и Ubuntu VPS через systemd/nginx. Оба используют PostgreSQL и server-side Node runtime. Сейчас API доверяют синхронному `requestPrincipal`, который читает платформенный заголовок либо local E2E identity; VPS nginx защищает весь сайт Basic Auth и подставляет постоянный principal. Опубликованный Sites-сайт не является целевой средой этого change и не должен собираться или деплоиться при его применении.

## Goals / Non-Goals

**Goals:**

- Один app-owned механизм email/password и sessions для local и VPS поверх общей PostgreSQL schema.
- Fail-closed защита UI и каждого product API без доверия к клиентским identity headers.
- Безопасное операционное создание, сброс, отключение пользователей и отзыв сессий без новой прикладной роли.
- Брендированный адаптивный login UI с синтетической композицией и существующей темой.

**Non-Goals:**

- Изменения, сборка или публикация `chatgpt.site`, Sites bindings, D1 или R2.
- Публичная регистрация, несколько продуктовых ролей, SSO, social login или Google Drive OAuth как средство входа.
- Email-провайдер и self-service password recovery в MVP.

## Decisions

### 1. PostgreSQL является единственным auth store

Добавляются таблицы `auth_users`, `auth_sessions`, `auth_login_attempts` и `auth_security_events` через forward-only migration. `auth_users` хранит canonical email, display name, единственную роль, password hash envelope, состояние и флаг обязательной смены. `auth_sessions` хранит только SHA-256 hash случайного 256-bit token, user ID, CSRF proof hash, сроки и revoke metadata. Попытки и аудит имеют ограниченный retention и не содержат plaintext IP/credential data.

Альтернативы D1/Sites и отдельная локальная auth база отклонены: они создают третий runtime и расходящиеся правила. nginx htpasswd отклонён как пользовательский store, потому что не даёт приложению управляемых сессий, блокировок и жизненного цикла пользователя.

### 2. Пароли хешируются встроенным memory-hard KDF

Используется Node `crypto.scrypt` с уникальной случайной солью, явной версией и параметрами внутри hash envelope; сравнение выполняется constant-time. Параметры выбираются тестом ресурсов для local и VPS и могут повышаться с rehash-on-login. Неизвестный пользователь проходит dummy scrypt с теми же параметрами.

Это избегает нативной внешней зависимости Argon2 в двух ОС, сохраняя memory-hard защиту. Пароли никогда не передаются CLI-аргументом: bootstrap/reset читают секрет из TTY либо защищённого stdin.

### 3. Async session authentication заменяет доверенный header principal

Новая async auth boundary извлекает host-only cookie, хеширует token, читает active non-expired session и active user, затем возвращает typed principal. Все browser pages и product API используют её. Internal service endpoints сохраняют отдельные bearer/grant механизмы и не становятся пользовательскими sessions. Local E2E bypass остаётся отдельной явно проверяемой веткой только при `E2E_ENVIRONMENT=local`; production configuration отвергает её.

Внешние `oai-authenticated-*` headers в local/VPS игнорируются. nginx удаляет их до proxy. Поддержка Sites header остаётся нетронутой только вне новых local/VPS auth modes, чтобы этот change не изменял опубликованный сайт.

### 4. Непрозрачная cookie-сессия и CSRF

Cookie содержит только случайный token, имеет `HttpOnly`, `SameSite=Lax`, root path и host-only scope. `Secure` обязателен на VPS и выключается только при проверенном loopback local origin. Обычный absolute TTL — 12 часов, remember TTL — 30 дней. Token ротируется после входа и password change. Logout/revoke атомарно помечает session отозванной до удаления cookie.

Каждая browser mutation требует допустимый same-origin `Origin`/`Host` и session-bound CSRF proof из отдельного readable cookie/header pair, связанного hash с session row. API bearer/internal calls не используют browser CSRF flow и сохраняют собственную аутентификацию.

### 5. Вход, forced password change и UI gating

Публичны только login shell и минимальные auth endpoints. Root server flow определяет session до монтирования dashboard: без неё рендерит login, не загружая product snapshot. Login form использует email/password autocomplete, show-password, remember, generic error и loading state. Левая композиция — локальная синтетика и `aria-hidden`.

Временный пароль создаёт ограниченную pre-auth session с разрешением только на password change/logout. После смены сервер отзывает pre-auth и прочие сессии, создаёт новую полноценную session. «Забыли пароль?» сообщает обратиться к оператору, не раскрывая наличие email.

### 6. Rate limiting и аудит устойчивы к перезапуску

Неуспешные попытки записываются в PostgreSQL по HMAC-fingerprint canonical email и нормализованного источника. Пять попыток за 15 минут создают 15-минутную блокировку. Успешный вход очищает активный счётчик для пары, но security event сохраняется по retention policy. Ошибки наружу унифицированы, а audit payload использует только safe codes и opaque IDs.

### 7. Операторский lifecycle без второй прикладной роли

CLI-команды `auth:create-user`, `auth:reset-password`, `auth:disable-user`, `auth:enable-user` и `auth:revoke-sessions` выполняются только на host с доступом к runtime configuration. Они используют тот же domain service и transaction boundaries, что web. Первичная Алсу Салямова создаётся оператором с фактическим корпоративным email; он не фиксируется в Git/OpenSpec.

### 8. VPS migration заменяет Basic Auth только после readiness

Сначала накатывается migration и создаётся первый HR, затем preflight проверяет schema, session secret, HTTPS origin и отсутствие production bypass. После smoke login nginx перестаёт использовать `auth_basic`, удаляет identity headers и проксирует auth cookies. Rollback возвращает предыдущий release и Basic Auth только пока новая схема не использована для необратимых product изменений; auth tables могут безопасно оставаться.

## Risks / Trade-offs

- [Ошибка защиты одного API оставит обход] → Инвентаризировать все browser/product routes и добавить route-matrix acceptance, где всё закрыто по умолчанию кроме явного allowlist.
- [Scrypt параметры перегрузят малый VPS] → Зафиксировать memory/time budget интеграционным тестом и валидировать параметры startup preflight.
- [Блокировка может использоваться для denial of service по известному email] → Ключевать по сочетанию email/source, сохранять generic response и дать оператору unlock/reset.
- [Cookie похищена до отзыва] → HTTPS, HttpOnly, host-only, CSP, короткий TTL, token hashing и массовый revoke.
- [Local HTTP ослабляет cookie] → Разрешать non-Secure только для loopback origin в явном local mode; любой другой origin fail closed.
- [Одновременная миграция nginx и приложения может закрыть доступ] → Двухфазный rollout с bootstrap/readiness/smoke до отключения Basic Auth и документированным rollback.

## Migration Plan

1. Независимый субагент добавляет RED acceptance для credentials, sessions, route protection, CSRF, rate limit, operator lifecycle и login UI.
2. Добавляются migration, auth domain/repository, CLI и изолированные тесты.
3. Добавляются auth routes, async principal boundary и защита полного route matrix.
4. Реализуются login/forced-change/logout UI и темы без изменения product screens.
5. Local bootstrap создаёт тестового HR, запускает regression и обязательные E2E.
6. VPS release устанавливается с ещё включённым Basic Auth, применяется migration, создаётся первый HR и проходит HTTPS login smoke.
7. nginx переключается на app-owned sessions, production preflight и required E2E повторяются.

Откат возвращает предыдущий web/nginx release; новые auth tables не удаляются. `chatgpt.site` не публикуется ни на одном шаге.

