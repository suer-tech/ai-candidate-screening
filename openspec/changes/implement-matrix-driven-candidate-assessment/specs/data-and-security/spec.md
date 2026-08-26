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

