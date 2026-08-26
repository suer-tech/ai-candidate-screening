## ADDED Requirements

### Requirement: TST-086 [CONFIRMED] Создание и генерация вакансии принимаются как отдельные операции
Независимый acceptance test MUST создать vacancy по unique title без LLM-вызова, подтвердить version 1 и Drive binding, затем внутри vacancy нажать `Сгенерировать описание`, получить валидный RouterAI snapshot, отредактировать его и сохранить новой версией.

#### Scenario: Валидная vacancy создана
- **WHEN** HR вводит уникальное название и выбирает `Сохранить`
- **THEN** создаётся одна active vacancy версии 1 с устойчивыми vacancy ID и Drive Folder ID
- **AND** она доступна intake/analysis после reload
- **AND** RouterAI не вызывается до отдельного клика `Сгенерировать описание`

### Requirement: TST-087 [CONFIRMED] Retry и terminal error генерации не допускают ручной fallback
Независимая test matrix MUST проверить generation внутри существующей vacancy: success/retry exhaustion, invalid JSON, timeout, network, HTTP 429/5xx, auth/config error, duplicate click и manual retry. Unsuccessful generation MUST NOT удалять vacancy, менять Drive binding, перезаписывать сохранённый профиль или создавать новую version.

#### Scenario: Генерация успешна после третьего повтора
- **WHEN** первоначальная попытка и первые два автоматических повтора завершаются повторяемой ошибкой, а третий повтор возвращает валидный structured profile
- **THEN** editor открывается один раз с результатом успешной попытки
- **AND** HR не выполняет ручных действий между автоматическими повторами

#### Scenario: Все автоматические повторы исчерпаны
- **WHEN** первоначальная попытка и три автоматических повтора не возвращают валидный structured profile
- **THEN** UI сообщает, что профиль не сформирован после четырёх попыток, и показывает безопасную понятную причину
- **AND** доступно действие `Повторить генерацию`
- **AND** vacancy, Drive binding и текущая версия остаются неизменными

#### Scenario: Неповторяемая ошибка завершает operation
- **WHEN** provider возвращает ошибку авторизации или конфигурации
- **THEN** UI показывает понятную безопасную ошибку без секрета и raw response
- **AND** бессмысленные автоматические повторы не выполняются

#### Scenario: Validation, discard и reset не создают скрытые drafts
- **WHEN** test проверяет invalid mandatory field, logical conflict, discard, reload и reset generated profile
- **THEN** invalid или abandoned state не создаёт новую version
- **AND** reset восстанавливает последнюю сохранённую версию без нового model call

### Requirement: TST-088 [CONFIRMED] Drive provisioning идемпотентно и атомарно для пользователя
Acceptance MUST проверить create success, timeout-after-create, create retry и terminal Drive failure. Generation retries существующей vacancy MUST переиспользовать binding и MUST NOT создавать duplicate vacancy, version или folder.

#### Scenario: Generation retry не создаёт папку
- **WHEN** LLM generation выполняет одну или несколько автоматических повторных попыток
- **THEN** Google Drive folder provisioning повторно не вызывается
- **AND** используется binding, созданный при сохранении названия

#### Scenario: Timeout произошёл после создания folder
- **WHEN** первый final-save response потерян, а HR безопасно повторяет operation
- **THEN** система завершает binding с той же folder
- **AND** существует ровно одна vacancy, одна version 1 и одна связанная folder

### Requirement: TST-089 [CONFIRMED] Минутная стабилизация кандидата проверяется независимо
Acceptance MUST доказать четыре полных снимка в пределах одной минуты, сравнение File ID/count/size, reset при изменении и ровно один automatic first run после стабильного окна.

#### Scenario: Четыре снимка совпадают
- **WHEN** материалы неизменны на четырёх проверках примерно 0/15/30/45 секунд
- **THEN** input version и очередь создаются в пределах минуты
- **AND** повторные тики не создают дубль

### Requirement: TST-090 [CONFIRMED] Docker FFmpeg и health проверяются фактически
Acceptance MUST запустить media runtime image, выполнить health и реальное извлечение аудио из synthetic fixture. Тест MUST падать, если путь существует только строкой, бинарник отсутствует, не executable или возвращает non-zero на version probe.

#### Scenario: FFmpeg установлен
- **WHEN** media container проходит health
- **THEN** `ffmpeg -version` выполняется успешно
- **AND** synthetic video преобразуется в непустой audio artifact
