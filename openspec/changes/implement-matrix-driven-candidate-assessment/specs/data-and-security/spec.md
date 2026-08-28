## ADDED Requirements

### Requirement: SEC-020 Неизменяемость и область matrix artifacts
Matrix artifact MUST принадлежать точной `profileVersion`, иметь canonical checksum и быть неизменяемым после публикации. Candidate assessment rows и claims MUST быть ограничены candidate/run/input version и MUST NOT использоваться другим кандидатом; переиспользоваться между кандидатами MAY только vacancy matrix.

#### Scenario: Другой кандидат использует ту же вакансию
- **WHEN** начинается анализ по той же `profileVersion`
- **THEN** система переиспользует только vacancy matrix
- **AND** не передаёт claims, evidence или working memory первого кандидата

### Requirement: SEC-021 Минимизация чувствительных данных в LLM-контексте
До decision-driving LLM stages система MUST удалять или маскировать запрещённые чувствительные признаки, когда это возможно без разрушения доказательного локатора. Защищённая трасса MUST сохранять достаточную provenance для аудита и MUST NOT раскрывать эти признаки в пользовательском reasoning.

#### Scenario: Документ содержит фотографию и дату рождения
- **WHEN** формируется оценочный контекст
- **THEN** изображение и дата рождения не передаются как основание оценки

### Requirement: SEC-022 Контролируемое удаление candidate-scoped matrix history
Claims, evidence conflicts и matrix rows MUST оставаться защищёнными от обычных `UPDATE` и `DELETE`. При подтверждённом удалении архивного кандидата repository MUST установить transaction-local cleanup scope, содержащий точные run IDs кандидата; только в этом scope каскадное удаление candidate-scoped matrix history MUST быть разрешено. Удаление без cleanup scope либо с чужим run ID MUST завершаться отказом и не менять данные.

#### Scenario: HR удаляет архивного кандидата
- **WHEN** lifecycle repository зафиксировал tombstone и установил cleanup scope для всех run IDs этого кандидата
- **THEN** удаление карточки каскадно удаляет его claims, conflicts и matrix rows
- **AND** транзакция завершается успешно

#### Scenario: Matrix history удаляется напрямую
- **WHEN** запрос `DELETE` или `UPDATE` выполняется вне точного cleanup scope
- **THEN** immutable trigger отклоняет операцию
- **AND** строка остаётся неизменной

#### Scenario: Cleanup scope относится к другому запуску
- **WHEN** scope не содержит `run_id` удаляемой matrix-строки
- **THEN** immutable trigger отклоняет удаление
