# Подключение личного Google Drive

Сервис работает только с личным **«Моим диском»** через OAuth от имени владельца Gmail. Общий диск и сервисный аккаунт не поддерживаются. Client ID и callback находятся в `web/.runtime/runtime.env`, а секреты — только в `web/.runtime/credentials/`. Не присылайте значения в чат и не коммитьте `.runtime`.

## 1. Включить API

1. Откройте [Google Cloud Console](https://console.cloud.google.com/) и создайте либо выберите проект.
2. Перейдите в **APIs & Services → Library**.
3. Найдите **Google Drive API**, откройте карточку и нажмите **Enable**. После этого возвращаться в Library не требуется.

## 2. Настроить OAuth consent screen

1. Откройте **Google Auth Platform → Branding** и заполните название приложения, support email и developer email. Для production-домена также укажите `Application home page: https://agent.devbpm.ru/`, `Application privacy policy link: https://agent.devbpm.ru/privacy`, `Application terms of service link: https://agent.devbpm.ru/terms`, а в **Authorized domains** — `devbpm.ru` без `https://` и пути. Все три страницы должны публично открываться по HTTPS без авторизации.
2. В **Audience** выберите **External**.
3. Для первого локального запуска оставьте статус **Testing** и добавьте свой личный Gmail в **Test users**.
4. В **Data Access** добавьте scopes `openid`, `email` и `https://www.googleapis.com/auth/drive`.

В режиме Testing refresh token приложения с внешним типом пользователей обычно живёт не больше 7 дней. Для постоянной работы VPS нужно перевести consent screen в **In production**.

### Как перевести приложение из Testing в In production

В актуальном интерфейсе Google Cloud:

1. В верхней панели проверьте, что выбран тот же Cloud project, где создан OAuth client.
2. Откройте меню **☰ → Google Auth Platform → Audience**.
3. Убедитесь, что **User type / Тип пользователя** установлен в **External**.
4. Найдите блок **Publishing status / Статус публикации**. Сейчас в нём указано **Testing**.
5. Нажмите **Publish app / Опубликовать приложение**.
6. В окне подтверждения нажмите **Confirm / Подтвердить** или **Push to production** — название зависит от языка интерфейса.
7. Вернитесь в **Audience** и убедитесь, что статус изменился на **In production** или **Published**.

В старом интерфейсе тот же переключатель находится в **APIs & Services → OAuth consent screen → Publishing status → Publish app**.

Если кнопки **Publish app** нет:

- завершите и сохраните обязательные поля в **Google Auth Platform → Branding**;
- укажите support email и developer contact email;
- сохраните scopes в **Data Access**;
- проверьте, что Audience именно **External**, а не незавершённая конфигурация.

Для личного использования одним владельцем Gmail приложение может остаться **Unverified**: при подключении Google покажет предупреждение, которое владелец может явно пройти. Публичное приложение для посторонних пользователей с чувствительными или ограниченными scopes потребует OAuth verification; Google может запросить домен, публичную главную страницу, privacy policy, обоснование scopes и демонстрационное видео.

После переключения в production ранее выданный testing grant лучше не переиспользовать: в приложении нажмите **Отключить**, затем **Подключить** и снова подтвердите consent. Новый refresh token будет выдан уже при production publishing status. После этого установите `GOOGLE_OAUTH_DEPLOYMENT_MODE=production-personal` в окружении, где используется опубликованный client.

## 3. Создать локальный OAuth client

1. Откройте **Google Auth Platform → Clients → Create client**.
2. Тип приложения: **Web application**.
3. Имя: `HH local`.
4. В **Authorized redirect URIs** добавьте ровно:

   `http://localhost:3000/api/integrations/google-drive/oauth/callback`

5. Скопируйте Client ID в `web/.runtime/runtime.env`:

   `GOOGLE_OAUTH_CLIENT_ID=...apps.googleusercontent.com`

6. Запишите только значение Client secret в `web/.runtime/credentials/google-oauth-client-secret`, без кавычек и имени переменной.

## 4. Создать ключ шифрования токена

В PowerShell из корня проекта выполните:

```powershell
cd web
npm run generate:google-oauth-keyring
```

Команда создаёт `web/.runtime/credentials/google-oauth-keyring.json`, не печатает ключ и не перезаписывает существующий файл. Ошибка `GOOGLE_OAUTH_KEYRING_ALREADY_EXISTS` означает, что ключ уже создан; повторная генерация не нужна. Для осознанной ротации существует отдельная команда `npm run rotate:google-oauth-keyring`.

Проверьте эти несекретные строки в `web/.runtime/runtime.env`:

```dotenv
GOOGLE_OAUTH_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_OAUTH_REDIRECT_URI=http://localhost:3000/api/integrations/google-drive/oauth/callback
GOOGLE_OAUTH_DEPLOYMENT_MODE=production-personal
```

Пути к secret-файлам не настраиваются: runtime принимает только фиксированные имена из allowlist. Старые `*_PATH`, `GOOGLE_SERVICE_ACCOUNT_*`, `GOOGLE_SHARED_DRIVE_*` и Cloudflare settings намеренно отклоняются.

## 5. Запустить и подключить

```powershell
cd web
npm run local:check
npm run local:stop
npm run local:start
```

Откройте [локальное приложение](http://localhost:3000), на дашборде нажмите **Подключить** и подтвердите доступ в Google. Приложение само создаст либо найдёт папку `Найм` в «Моём диске». Client secret, authorization code, access token и refresh token в браузер не возвращаются. Полная инструкция со всеми шагами и диагностикой находится в [docs/GOOGLE-DRIVE-SETUP.md](../../docs/GOOGLE-DRIVE-SETUP.md).

После consent повторите `npm run check:google-drive`: он проверит server config и безопасную status projection локального приложения без вывода credentials.

## VPS

Создайте отдельный OAuth Web client, например `HH production`, с точным HTTPS callback:

`https://ВАШ-ДОМЕН/api/integrations/google-drive/oauth/callback`

В `/etc/hh-agent/runtime.env` задайте HTTPS callback и `GOOGLE_OAUTH_DEPLOYMENT_MODE=production-personal`; client secret сохраните в `/etc/hh-agent/credentials/google-oauth-client-secret`. Нельзя использовать localhost client, HTTP callback или режим Testing. Refresh token создаётся штатным OAuth flow и хранится зашифрованным в PostgreSQL; worker получает его только через server-side scoped adapter.

## Официальная документация

- [OAuth 2.0 for Web Server Applications](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Настройка OAuth consent screen](https://support.google.com/cloud/answer/13464323)
- [Google Drive API scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
