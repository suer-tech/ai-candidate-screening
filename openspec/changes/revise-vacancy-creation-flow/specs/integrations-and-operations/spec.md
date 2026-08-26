## ADDED Requirements

### Requirement: INT-041 [CONFIRMED] Кандидат стабилизируется четырьмя снимками за одну минуту
После обнаружения новой candidate folder runtime MUST выполнить четыре полных снимка примерно с интервалом 15 секунд в пределах одной минуты. Каждый снимок MUST сравнивать устойчивые File ID, количество файлов и размер каждого файла. Четыре одинаковых полных снимка MUST создавать immutable input version и automatic first run. Любое изменение либо ошибка чтения MUST сбрасывать или пропускать текущее окно без запуска обработки.

#### Scenario: Файлы не меняются одну минуту
- **WHEN** четыре последовательных снимка содержат одинаковые File ID, количество и размеры
- **THEN** кандидат переходит к обработке не позднее окончания минутного окна
- **AND** создаётся одна идемпотентная очередь задач

#### Scenario: Загрузка ещё продолжается
- **WHEN** между снимками меняется количество либо размер файла
- **THEN** стабильное окно начинается заново
- **AND** дорогие этапы обработки не запускаются на частичных данных

### Requirement: INT-042 [CONFIRMED] FFmpeg гарантирован и проверяется как executable
Docker build local/VPS MUST включать реально исполняемый FFmpeg. Build или runtime preflight MUST fail closed, если бинарник отсутствует или не запускается. Media processor health MUST выполнять безопасную executable-проверку и возвращать not-ready при `ENOENT`, permission error или non-zero version probe; непустая строка пути не является достаточной готовностью.

#### Scenario: FFmpeg отсутствует в runtime image
- **WHEN** health-check не может выполнить `ffmpeg -version`
- **THEN** media processor сообщает not-ready с безопасным кодом
- **AND** candidate transcription task не стартует как будто processor исправен

#### Scenario: Runtime image корректен
- **WHEN** контейнер запускается после build
- **THEN** FFmpeg executable доступен media processor
- **AND** health-check подтверждает успешный version probe без раскрытия локального пути

### Requirement: INT-040 [CONFIRMED] Drive-папка вакансии создаётся и связывается идемпотентно
При сохранении уникального названия create-vacancy operation MUST создать либо найти одну папку вакансии в согласованной области Google Drive и сохранить устойчивую связь её Folder ID с vacancy ID. Повтор той же operation MUST использовать существующий binding и MUST NOT создавать duplicate folders. Последующая генерация описания MUST NOT создавать дополнительные Drive folders.

#### Scenario: Vacancy сохранена впервые
- **WHEN** уникальное название проходит server validation и create operation достигает Drive provisioning
- **THEN** система создаёт одну vacancy folder и связывает её Folder ID с vacancy ID
- **AND** только после binding save может завершиться success

#### Scenario: LLM-генерация повторяется
- **WHEN** generation call для существующей vacancy повторяется либо завершается ошибкой
- **THEN** существующий folder binding сохраняется
- **AND** дополнительные vacancy folders не создаются

#### Scenario: Повтор после неизвестного результата
- **WHEN** save повторяется после timeout либо временной ошибки
- **THEN** система находит существующий binding или завершает прежнюю operation
- **AND** не создаёт вторую folder

#### Scenario: Drive недоступен
- **WHEN** обязательное folder provisioning не завершилось после разрешённых retries
- **THEN** save остаётся unsuccessful и vacancy не участвует в intake/analysis
- **AND** HR получает понятную ошибку и safe retry action
