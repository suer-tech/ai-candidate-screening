# Запуск локально и на Ubuntu VPS

## Единая конфигурация

Секреты не отправляются в чат и не записываются в `runtime.env`. В env находятся только несекретные настройки; значения credentials лежат по одному в отдельных файлах.

Точный allowlist:

```text
assemblyai-api-key
database-url
google-oauth-client-secret
google-oauth-keyring.json
internal-service-tokens.json
routerai-api-key
telegram-bot-token
telegram-recipients.json
```

Локальный корень — `web/.runtime/`, VPS-корень — `/etc/hh-agent/`. Любой лишний файл, symlink, inline secret, duplicate/unknown env key или небезопасные права блокируют preflight.

Release gates выполняются перед выкладкой одной неизменяемой сборки и конфигурации; их evidence хранится отдельно от runtime credentials и не используется как ручной переключатель уже развёрнутого сервиса.

Обработка кандидата имеет единственный production workflow `matrix-v3`. Отдельных legacy/shadow веток и переключателя версии матрицы нет. `CANDIDATE_PIPELINE_ROUTING=effectful` включает обработку; `disabled` останавливает создание новых запусков. Старые записи и PDF остаются доступны только для чтения.

`matrix-v3` структурирует заполненные параметры вакансии без добавления новых требований, последовательно проверяет каждый критерий по материалам кандидата и формирует один компактный `candidate-report`.

## Windows

Из `web/`:

```powershell
npm run local:bootstrap
npm run local:check
npm run local:start
npm run local:status
```

`bootstrap` мигрирует старую локальную раскладку, запускает PostgreSQL 16 в Docker, применяет migrations и выполняет preflight. `start` собирает и запускает Node web, worker, media и document processors скрытыми процессами. Состояние и логи находятся в ignored `web/.runtime/`.

Перед финальным локальным release-прогоном выполните `npm run build:pin-local`: команда сама вычислит fingerprint delivery-файлов и атомарно запишет только `CANDIDATE_PIPELINE_BUILD_ID` в ignored `runtime.env`; ключи она не читает и не печатает.

Проверка и остановка:

```powershell
npm run security:sentinel
npm run local:stop
```

Полная пошаговая настройка Google personal OAuth и Drive описана в [GOOGLE-DRIVE-SETUP.md](../docs/GOOGLE-DRIVE-SETUP.md); краткий локальный runbook — в [GOOGLE-ACCESS.md](local/GOOGLE-ACCESS.md). Telegram recipients описаны в [TELEGRAM-ACCESS.md](local/TELEGRAM-ACCESS.md). Shared Drive и service account не поддерживаются.

## Ubuntu VPS

Перед запуском нужен checkout проекта на VPS и уникальный immutable build id. От root:

```bash
cd /absolute/path/to/hh/web && npm run build:id
./deploy/ubuntu/install.sh /absolute/path/to/hh local-20260820-0123456789abcdef hire.example.org
```

Команда `build:id` вычисляет идентификатор из фактических delivery-файлов приложения и deployment scripts, не читая ignored credentials или каталог кандидата. Installer сам записывает полученное значение в `CANDIDATE_PIPELINE_BUILD_ID`/release version и подставляет переданный домен в origin, Google redirect URI и nginx.

Installer устанавливает Node 22, PostgreSQL 16, nginx, Certbot, UFW и age; создаёт release в `/opt/hh-agent/releases/<build-id>` без `.runtime`, `candidate`, env/secrets и generated outputs, loopback-only database, systemd units и пустые provider credential files. Затем:

1. Заполните пять provider-файлов в `/etc/hh-agent/credentials/`: Google client secret, RouterAI, AssemblyAI, Telegram token и recipients JSON.
2. Отредактируйте `/etc/hh-agent/runtime.env`: публичный HTTPS origin, Google client id/redirect URI, OAuth deployment mode, build id и model routing.
3. После migrations создайте Алсу Саля­мову как первого HR-пользователя. Подставьте её фактический корпоративный email; временный пароль вводится интерактивно и не попадает в argv или stdout:

```bash
sudo -u hh-agent bash -lc 'cd /opt/hh-agent/current/web && HH_RUNTIME_CONFIG_ROOT=/etc/hh-agent npm run db:migrate'
sudo -u hh-agent bash -lc 'cd /opt/hh-agent/current/web && HH_RUNTIME_CONFIG_ROOT=/etc/hh-agent npm run auth:create -- alsu@company.example "Алсу Салямова"'
```

4. Выпустите TLS-сертификат после того, как DNS-имя уже указывает на VPS, например `certbot certonly --standalone -d hire.example.com`, и замените hostname в nginx-конфигурации. Подключите Google на VPS через штатный OAuth connect flow; локальный refresh token вручную не копируйте.
5. Выполните migrations и проверки:

```bash
sudo /usr/local/sbin/hh-production-preflight
```

6. Укажите реальный hostname и TLS certificate paths в `/etc/nginx/sites-available/hh-web`, включите только web site и запустите службы:

```bash
ln -sfn /etc/nginx/sites-available/hh-web /etc/nginx/sites-enabled/hh-web
nginx -t && systemctl enable --now nginx
systemctl enable --now hh-media-processor hh-document-processor hh-web hh-agent-worker
```

Публичны только SSH и nginx HTTPS. Веб-контур закрыт серверными email/password sessions приложения; nginx очищает входящие identity headers. PostgreSQL, media/document processors и internal runtime routes остаются loopback/server-token only. Для восстановления используйте `auth:reset`, для экстренного закрытия доступа — `auth:disable` и `auth:revoke`; `auth:enable` возвращает доступ.

## Backup и rollback

`hh-postgres-backup.timer` ежедневно создаёт checksum и age-encrypted `pg_dump`; `hh-postgres-restore-test.timer` проверяет восстановление в изолированной временной БД. Ключ восстановления храните отдельно от VPS.

Rollback выполняется по [ROLLBACK.md](ROLLBACK.md): остановить новые triggers/claims/effects, вернуть предыдущий совместимый immutable build и проверить текущую PostgreSQL schema. Destructive down migrations запрещены.

## Release gates

Effectful routing нельзя включать до GREEN на одном immutable build:

- runtime preflight, migrations clean/upgrade, unit/integration/security suites;
- `E2E-VAC-001`, `E2E-TRN-001`, `E2E-ABC-001`, `E2E-RESULT-001`;
- Google reconnect/revoke/account mismatch, worker restart/fencing/outbox reconcile;
- RouterAI, AssemblyAI EU, personal My Drive, Telegram smokes;
- backup/restore и automatic cleanup.

До этих проверок оставляйте routing в состоянии `disabled`.

Для matrix production дополнительно обязательны GREEN matrix acceptance и весь набор required E2E. Не редактируйте опубликованную матрицу: исправление требований выполняется новой версией профиля вакансии.
