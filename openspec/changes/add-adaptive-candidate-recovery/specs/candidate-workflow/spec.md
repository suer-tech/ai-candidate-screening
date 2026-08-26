## ADDED Requirements

### Requirement: WF-041 [CONFIRMED] Неоднозначные обязательные материалы не выбираются молча
Если stable input version содержит несколько файлов, каждый из которых правдоподобно соответствует роли обязательного резюме либо интервью, система SHALL применить versioned deterministic classification policy и сохранить признаки выбора. Автоматический выбор разрешён только когда ровно один файл доказуемо удовлетворяет policy как primary. При сохраняющейся неоднозначности run MUST перейти в `WAITING_FOR_HUMAN` с предложением выбрать конкретный primary file; случайный порядок, имя файла само по себе или первый элемент списка MUST NOT определять выбор.

#### Scenario: Одно из двух резюме однозначно primary
- **WHEN** один файл является поддерживаемым резюме, а второй доказуемо относится к дополнительному документу
- **THEN** material manifest фиксирует primary resume и признаки классификации
- **AND** оба файла остаются частью immutable input version

#### Scenario: Два резюме одинаково правдоподобны
- **WHEN** classification policy не может доказуемо выбрать один primary resume
- **THEN** processing не начинает document assessment по случайному файлу
- **AND** HR получает escalation выбора с двумя устойчивыми File IDs и безопасными metadata

#### Scenario: Два интервью одинаково правдоподобны
- **WHEN** stable input version содержит две поддерживаемые записи без доказуемого primary
- **THEN** STT job не создаётся до решения HR
- **AND** escalation предлагает выбрать конкретную recording

### Requirement: WF-042 [CONFIRMED] Human material selection версионируется и возобновляет run
Выбор HR SHALL создавать immutable material-selection artifact, связанный с input version, actor, escalation version и выбранными File IDs. Если файлы и profile version не изменились, selection MUST возобновлять тот же run и сохранять budgets/checkpoints. Изменение набора файлов MUST создавать новую input version по WF-014; stale selection MUST быть отклонён.

#### Scenario: HR выбирает интервью без изменения папки
- **WHEN** актуальная escalation разрешена выбором одного из существующих File IDs
- **THEN** тот же run продолжает media pipeline с выбранным file
- **AND** classification и выбор остаются в audit/evidence

#### Scenario: Пока HR выбирал, файл заменили
- **WHEN** action относится к прежней input version
- **THEN** система отклоняет stale selection
- **AND** строит manifest новой stable input version до дальнейшей обработки
