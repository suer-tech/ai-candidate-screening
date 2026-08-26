## Purpose

Определяет единственный поддерживаемый Google Drive backend: безопасное долговременное подключение личного `Моего диска` через server-side OAuth 2.0, привязку корня `Найм` и восстановление автономной обработки после отзыва grant.

## ADDED Requirements

### Requirement: GDO-001 [CONFIRMED] Единственный Google Drive backend
Система MUST работать с Google Drive только через `Мой диск` активного личного Gmail-аккаунта и server-side OAuth connection. Production runtime MUST NOT требовать или принимать Shared Drive ID, service-account JSON либо локальный файловый backend.

#### Scenario: Сервис запускается без Workspace
- **WHEN** настроены OAuth client, token-encryption key и active personal connection
- **THEN** Drive readiness проходит без Shared Drive и service account

#### Scenario: Переданы service-account credentials
- **WHEN** оператор пытается использовать service-account JSON вместо OAuth connection
- **THEN** production-конфигурация отклоняется как неподдерживаемая

### Requirement: GDO-002 [CONFIRMED] Server-side OAuth flow
Подключение MUST начинаться только авторизованным HR через web-server OAuth flow с offline access, одноразовым cryptographic `state`, PKCE S256, server-stored initiator и точным allowlisted redirect URI. Callback MUST атомарно consume operation до code exchange и MUST NOT принимать redirect либо owner identity от клиента как доверенные данные.

#### Scenario: HR подключает личный Gmail
- **WHEN** авторизованный HR завершает consent действительным state и PKCE
- **THEN** server получает refresh grant, проверяет Google identity и создаёт active connection

#### Scenario: Callback повторён
- **WHEN** использованный либо просроченный state поступает повторно
- **THEN** callback отклоняется без изменения connection и без раскрытия credentials

#### Scenario: Неавторизованный пользователь начинает подключение
- **WHEN** запрос без действующей HR-сессии обращается к connect route
- **THEN** OAuth operation не создаётся

### Requirement: GDO-003 [CONFIRMED] Корень `Найм` и ограничение операций
Connection MUST запросить scope `https://www.googleapis.com/auth/drive`, создать либо связать принадлежащую ожидаемому account папку `Найм` и ограничить все прикладные Drive grants её зарегистрированными потомками. Произвольный File/Folder ID клиента MUST NOT давать доступ вне связанного root.

#### Scenario: HR вручную добавляет файл
- **WHEN** HR помещает поддерживаемый файл в зарегистрированную структуру под `Найм`
- **THEN** discovery обнаруживает его через Drive API без ручного Picker

#### Scenario: Запрошен несвязанный файл
- **WHEN** tool получает Google File ID, не зарегистрированный как потомок root
- **THEN** grant отклоняется до чтения или изменения файла

### Requirement: GDO-004 [CONFIRMED] Долговременный refresh и защищённое хранение
OAuth client secret MUST поступать только из server secret. Refresh token MUST шифроваться AES-256-GCM отдельным версионируемым ключом до durable storage и расшифровываться только token provider. Access token MAY находиться только в ограниченном memory cache. Client secret, authorization code и tokens MUST NOT попадать в браузер, plaintext D1, task payload, timeline, evidence, метрики или логи.

#### Scenario: Worker перезапускается
- **WHEN** access token утрачен после рестарта, а refresh grant действителен
- **THEN** worker получает новый access token без действия HR
- **AND** продолжает checkpointed Drive task без дубликата side effect

#### Scenario: Ключ шифрования ротируется
- **WHEN** оператор вводит новую active key version
- **THEN** новые записи используют её, а старые контролируемо rewrap без выдачи plaintext клиенту

#### Scenario: Формируется диагностика
- **WHEN** система пишет ошибку, trace или evidence
- **THEN** OAuth credentials отсутствуют либо необратимо очищены

### Requirement: GDO-005 [CONFIRMED] Testing и постоянный VPS grant
Connection MUST хранить операторский deployment mode `testing` или `production-personal`. Это значение MUST использоваться только как fail-closed operational declaration и MUST NOT считаться проверкой фактического Publishing status Google либо основанием для вычисления срока действия grant. `testing` MAY использоваться локально и MUST NOT удовлетворять production readiness. Ubuntu VPS MAY считаться готовым только с `production-personal`, точным HTTPS redirect URI и отдельным подтверждением оператора, что consent screen переведён в `In production`.

#### Scenario: Локальная конфигурация помечена testing
- **WHEN** connection содержит deployment mode `testing`
- **THEN** UI не утверждает фактический статус Google consent screen и не вычисляет дату прекращения grant
- **AND** реальный отзыв определяется только ответом token endpoint

#### Scenario: Testing grant указан для VPS
- **WHEN** production preflight получает deployment mode `testing`
- **THEN** readiness падает с `GOOGLE_OAUTH_TESTING_GRANT_NOT_DURABLE`

### Requirement: GDO-006 [CONFIRMED] Отзыв grant и содержательная эскалация
При `invalid_grant`, отзыве доступа, account mismatch или permanent OAuth configuration error система MUST прекратить новые Drive side effects, сохранить безопасный код и перевести задачи в `WAITING_FOR_HUMAN` с действием `Переподключить Google Drive`. После reconnect ожидаемого account runtime MUST продолжить с durable checkpoint и reconcile внешние операции до повтора.

#### Scenario: Пользователь отозвал доступ
- **WHEN** refresh возвращает `invalid_grant`
- **THEN** задача не получает простой `FAILED`
- **AND** HR видит причину, этап и действие повторного подключения без секретов

#### Scenario: Drive переподключён
- **WHEN** HR завершает новый consent ожидаемым account
- **THEN** ожидающие задачи становятся доступны для resume, а папки и PDF не дублируются

#### Scenario: Подключён другой аккаунт
- **WHEN** callback подтверждает Google identity, отличную от owner active connection
- **THEN** автоматический resume блокируется до отдельной явной миграции

### Requirement: GDO-007 [CONFIRMED] Наблюдаемый статус без credentials
Интерфейс интеграций MUST показывать owner email, имя и ссылку на root `Найм`, state `CONNECTED`, `REAUTH_REQUIRED`, `DISCONNECTED` или `MISCONFIGURED`, last successful refresh и следующее действие. Операторский deployment mode MAY присутствовать в закрытой readiness projection, но UI MUST NOT представлять его как проверенный статус Google. Интерфейс MUST NOT показывать OAuth response либо credentials.

#### Scenario: HR открывает интеграции
- **WHEN** существует действующий connection
- **THEN** HR видит account, root и readiness без секретных полей

#### Scenario: Connection отсутствует
- **WHEN** active connection не создан
- **THEN** UI показывает `Google Drive не подключён` и действие подключения

### Requirement: GDO-008 [CONFIRMED] Явное отключение
Отключение MUST требовать авторизованного подтверждения, попытаться отозвать grant у Google, удалить durable refresh token и заблокировать новые Drive-задачи. Product records, tombstones и опубликованные файлы MUST NOT удаляться автоматически.

#### Scenario: HR отключает Drive
- **WHEN** подтверждённая операция завершается
- **THEN** refresh token больше недоступен runtime
- **AND** существующие продуктовые данные и Drive files остаются неизменными
