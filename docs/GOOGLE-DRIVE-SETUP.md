# Подключение Google-аккаунта и Google Drive к сервису

Эта инструкция описывает полную настройку Google Cloud OAuth и подключение личного раздела **«Мой диск»** к сервису. Service Account и Shared Drive не поддерживаются.

Для локального Docker-запуска используйте строго `http://localhost:3000`, а не `127.0.0.1`: OAuth callback должен совпадать с настройкой Google посимвольно.

## Что понадобится

Из Google Cloud нужно получить:

- `Client ID` — хранится в `web/.runtime/runtime.env`;
- `Client secret` — хранится только в отдельном credential-файле.

Также потребуется включить Google Drive API, настроить OAuth consent screen, создать Web OAuth client и выполнить подключение кнопкой в сервисе.

## 1. Создать проект Google Cloud

1. Откройте [Google Cloud Console](https://console.cloud.google.com/).
2. Войдите в Google-аккаунт, чей диск будете подключать.
3. В верхней части страницы нажмите на название текущего проекта.
4. Нажмите **New Project / Новый проект**.
5. Назовите проект, например `HH Candidate Assessment`.
6. Нажмите **Create / Создать**.
7. После создания снова откройте список проектов и выберите созданный проект.

Все дальнейшие действия выполняйте внутри этого проекта.

## 2. Включить Google Drive API

1. Откройте меню `☰`.
2. Перейдите в **APIs & Services → Library**.
3. Найдите `Google Drive API`.
4. Откройте карточку API.
5. Нажмите **Enable / Включить**.

OAuth сам по себе не включает Drive API. См. [официальную инструкцию Google Drive API](https://developers.google.com/workspace/drive/api/quickstart/nodejs).

## 3. Настроить Google Auth Platform

Откройте **Google Auth Platform → Branding**. Если платформа ещё не настроена, нажмите **Get Started / Начать**.

Заполните:

- **App name**: `HH Candidate Assessment` или другое узнаваемое название;
- **User support email**: ваш Google email;
- **Audience**: `External` для обычного Gmail; `Internal` допустим только внутри вашей Google Workspace-организации;
- в блоке **App domain** для production-развёртывания `agent.devbpm.ru` укажите:

  ```text
  Application home page: https://agent.devbpm.ru/
  Application privacy policy link: https://agent.devbpm.ru/privacy
  Application terms of service link: https://agent.devbpm.ru/terms
  ```

- в **Authorized domains** укажите только домен без протокола, пути и завершающего слеша: `devbpm.ru`;
- **Contact information**: актуальный email разработчика или владельца;
- подтвердите Google API Services User Data Policy;
- нажмите **Save / Сохранить** или **Create / Создать**.

Все три URL из блока **App domain** должны открываться по HTTPS и быть публично доступны без входа в приложение. Если обязательные поля Branding не заполнены или Google не принимает домен, кнопка **Publish app** в разделе **Audience** будет недоступна, а Google покажет сообщение о незавершённой OAuth-конфигурации.

Актуальные разделы Google Auth Platform называются `Branding`, `Audience`, `Clients` и `Data Access`. См. [описание Google Auth Platform](https://support.google.com/cloud/answer/15544987).

## 4. Добавить OAuth scopes

Откройте **Google Auth Platform → Data Access** и нажмите **Add or remove scopes / Добавить или удалить области доступа**.

Сервис запрашивает:

```text
openid
email
https://www.googleapis.com/auth/drive
```

Выберите OpenID, доступ к адресу электронной почты и полный доступ к Google Drive. Сохраните изменения.

Google OAuth формально выдаёт приложению полный Drive scope. Сам сервис дополнительно ограничивает операции папкой `Найм` и её зарегистрированными потомками. Полный Drive scope относится к ограниченным разрешениям Google; см. [классификацию Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).

## 5. Выбрать режим OAuth

### Быстрый локальный тест

Откройте **Google Auth Platform → Audience**, оставьте статус **Testing** и добавьте подключаемый Gmail в **Test users**.

В `runtime.env` используйте:

```dotenv
GOOGLE_OAUTH_DEPLOYMENT_MODE=testing
```

Авторизация с Drive scope в режиме Testing истекает через семь дней, включая refresh token. После этого потребуется повторное подключение. См. [правила Google для Testing](https://support.google.com/cloud/answer/15549945).

### Постоянная работа

Сначала завершите и сохраните раздел **Branding**, включая публичную главную страницу, политику конфиденциальности, условия использования и authorized domain, перечисленные в разделе 3 этой инструкции.

В **Google Auth Platform → Audience**:

1. Найдите **Publishing status**.
2. Нажмите **Publish app**.
3. Подтвердите публикацию.
4. Убедитесь, что статус изменился на **In production**.

В `runtime.env` используйте:

```dotenv
GOOGLE_OAUTH_DEPLOYMENT_MODE=production-personal
```

Для личного использования менее чем 100 пользователями Google допускает работу без полной OAuth-верификации, но показывает предупреждение о непроверенном приложении. Для публичного сервиса потребуется verification. См. [исключения Google для personal use](https://support.google.com/cloud/answer/13464323).

## 6. Создать локальный OAuth client

Откройте **Google Auth Platform → Clients**.

1. Нажмите **Create client**.
2. Выберите **Web application**.
3. Укажите имя `HH local`.
4. **Authorized JavaScript origins** оставьте пустым: сервис использует серверный OAuth flow.
5. В **Authorized redirect URIs** нажмите **Add URI**.
6. Добавьте ровно:

```text
http://localhost:3000/api/integrations/google-drive/oauth/callback
```

Не добавляйте завершающий `/`, пробелы, `127.0.0.1`, другой порт или `https` для локального запуска.

7. Нажмите **Create**.

Google требует точного совпадения схемы, hostname, порта и пути callback; иначе возвращается `redirect_uri_mismatch`. См. [требования Google к redirect URI](https://developers.google.com/identity/protocols/oauth2/web-server).

## 7. Скопировать Client ID и Client secret

После создания Google покажет:

- **Client ID**, например `123456789-xxxx.apps.googleusercontent.com`;
- **Client secret**, например строку, начинающуюся с `GOCSPX-`.

Не отправляйте Client secret в чат, Telegram или email и не добавляйте его в Git.

## 8. Записать Client ID в runtime.env

Откройте `web/.runtime/runtime.env` и задайте:

```dotenv
GOOGLE_OAUTH_CLIENT_ID=ВАШ_CLIENT_ID.apps.googleusercontent.com
GOOGLE_OAUTH_REDIRECT_URI=http://localhost:3000/api/integrations/google-drive/oauth/callback
GOOGLE_OAUTH_DEPLOYMENT_MODE=production-personal
```

Если Google Auth Platform оставлен в Testing, временно используйте:

```dotenv
GOOGLE_OAUTH_DEPLOYMENT_MODE=testing
```

Client secret в `runtime.env` помещать нельзя.

## 9. Записать Client secret в credential-файл

Откройте каталог:

```text
C:\Users\user2\Documents\Cursor\hh\web\.runtime\credentials
```

Откройте или создайте файл без расширения:

```text
google-oauth-client-secret
```

Вставьте в него только значение Client secret, без имени переменной, кавычек, JSON и комментариев:

```text
GOCSPX-xxxxxxxxxxxxxxxx
```

Если Google предлагает скачать JSON, возьмите из него только значение `client_secret`, а не весь документ.

## 10. Создать ключ шифрования refresh token

В PowerShell выполните:

```powershell
cd C:\Users\user2\Documents\Cursor\hh\web
npm run generate:google-oauth-keyring
```

Команда создаст `web/.runtime/credentials/google-oauth-keyring.json`. Если keyring уже существует, повторная генерация не нужна.

Не удаляйте и не пересоздавайте этот файл после подключения Google: без прежнего ключа сохранённый refresh token невозможно расшифровать.

## 11. Пересобрать и перезапустить контейнеры

Из корня проекта:

```powershell
cd C:\Users\user2\Documents\Cursor\hh

docker compose `
  -f deploy/docker/docker-compose.yml `
  -f deploy/docker/docker-compose.local.yml `
  up -d --build --force-recreate
```

Проверьте состояние:

```powershell
docker compose `
  -f deploy/docker/docker-compose.yml `
  -f deploy/docker/docker-compose.local.yml `
  ps -a
```

Ожидается: `postgres` и `web` healthy; `worker`, `media-processor` и `document-processor` — Up; `migrate` — Exited (0).

## 12. Подключить аккаунт в сервисе

1. Откройте строго [http://localhost:3000](http://localhost:3000), не `127.0.0.1`.
2. Войдите в сервис под HR-аккаунтом.
3. На дашборде найдите `Google Drive: Нет подключения`.
4. Нажмите **Подключить**.
5. Выберите Google-аккаунт, чей диск должен использовать сервис.
6. Подтвердите запрашиваемый доступ.

Если Google показывает «Приложение не проверено» и это ваш собственный Cloud project:

1. Нажмите **Advanced / Дополнительные настройки**.
2. Нажмите **Go to HH Candidate Assessment / Перейти к приложению**.
3. Подтвердите доступ.

После согласия Google вернёт браузер на callback, затем сервис перенаправит пользователя на дашборд.

## 13. Проверить подключение

На дашборде должно появиться:

```text
Google Drive: Подключён
ваш-email@gmail.com · Найм
```

Рядом появится ссылка **Открыть папку**. Сервис автоматически создаст или найдёт папку `Найм` в «Моём диске».

Рабочая структура:

```text
Найм/
└── Название вакансии/
    └── Имя кандидата/
        ├── резюме.pdf
        └── интервью.mp3
```

Результаты публикуются внутри папки кандидата в `Результаты/vNNNN/`.

Выполните техническую проверку:

```powershell
cd C:\Users\user2\Documents\Cursor\hh\web
npm run check:google-drive
```

Для просмотра последних логов:

```powershell
cd C:\Users\user2\Documents\Cursor\hh

docker compose `
  -f deploy/docker/docker-compose.yml `
  -f deploy/docker/docker-compose.local.yml `
  logs --tail 100 web worker
```

## Частые ошибки

### `redirect_uri_mismatch`

В Google Cloud и сервисе должно быть строго:

```text
http://localhost:3000/api/integrations/google-drive/oauth/callback
```

Проверьте `localhost`, порт `3000`, протокол `http`, отсутствие `/` в конце и тип клиента `Web application`.

### `Access blocked`

Если приложение в Testing, добавьте подключаемый Gmail в **Google Auth Platform → Audience → Test users**, подождите несколько минут и повторите подключение.

Для корпоративного Google Workspace администратору может потребоваться разрешить OAuth Client ID и restricted Drive scope.

### `invalid_client`

Проверьте, что Client ID и Client secret принадлежат одному OAuth-клиенту, secret-файл содержит только секрет, OAuth client не удалён, а контейнеры пересозданы после изменения конфигурации.

### `GOOGLE_OAUTH_REFRESH_TOKEN_MISSING`

1. Нажмите **Отключить** в сервисе.
2. Удалите старый доступ приложения в настройках Google-аккаунта.
3. Снова нажмите **Подключить** и полностью подтвердите consent.

Сервис запрашивает `access_type=offline` и `prompt=consent`, чтобы Google вернул refresh token.

### `GOOGLE_OAUTH_ACCOUNT_MISMATCH`

Подключён другой Google-аккаунт. Отключите Drive, выйдите из лишних Google-аккаунтов либо используйте приватное окно и подключите ожидаемого владельца.

### Через семь дней снова требуется вход

Google project остался в Testing. Переведите его в **In production**, установите `GOOGLE_OAUTH_DEPLOYMENT_MODE=production-personal`, пересоздайте контейнеры, отключите старый grant и подключите аккаунт заново.

## Настройка VPS

Для VPS создайте отдельный OAuth client `HH production` типа `Web application` с callback:

```text
https://ВАШ-ДОМЕН/api/integrations/google-drive/oauth/callback
```

В `/etc/hh-agent/runtime.env` задайте:

```dotenv
GOOGLE_OAUTH_CLIENT_ID=ВАШ_PRODUCTION_CLIENT_ID
GOOGLE_OAUTH_REDIRECT_URI=https://hire.company.ru/api/integrations/google-drive/oauth/callback
GOOGLE_OAUTH_DEPLOYMENT_MODE=production-personal
```

Client secret хранится только в:

```text
/etc/hh-agent/credentials/google-oauth-client-secret
```

На VPS обязательны реальный домен, HTTPS, действующий TLS-сертификат, Google Auth Platform в состоянии `In production` и отдельный production OAuth client.

После изменения конфигурации:

```bash
systemctl restart hh-web hh-agent-worker
```

Затем войдите в веб-интерфейс VPS и нажмите **Подключить**. Локальный refresh token на VPS переносить нельзя — OAuth consent нужно выполнить заново.
