## ADDED Requirements

### Requirement: TST-086 [CONFIRMED] Manual create-vacancy flow принимается сквозным сценарием
Независимый acceptance test MUST пройти от `Новая вакансия` через unique title и manual editor до одной active vacancy версии 1 с Drive binding, без LLM call, generated draft, preview или activation action.

#### Scenario: Валидная vacancy создана
- **WHEN** HR заполняет все mandatory profile fields и нажимает `Сохранить вакансию`
- **THEN** создаётся одна active vacancy версии 1 с устойчивым ID и Drive Folder ID
- **AND** она доступна intake/analysis после reload

### Requirement: TST-087 [CONFIRMED] Validation, discard и reset не создают скрытые drafts
Test matrix MUST проверить empty/duplicate title, каждое mandatory field, normalized ABC duplicates, logical conflict, discard confirmation, reload и reset. Ни один invalid или abandoned case MUST NOT создавать vacancy, version либо persisted draft.

#### Scenario: Unsaved form покинута
- **WHEN** test подтверждает discard изменённой формы
- **THEN** повторное открытие начинает новый initial flow
- **AND** прежние unsaved values отсутствуют в persistence

### Requirement: TST-088 [CONFIRMED] Drive provisioning идемпотентно и атомарно для пользователя
Acceptance MUST проверить success, timeout-after-create, retry и terminal Drive failure. Active vacancy MUST появляться только с одним valid folder binding; повтор MUST NOT создавать duplicate vacancy или folder.

#### Scenario: Timeout произошёл после создания folder
- **WHEN** первый response потерян, а HR безопасно повторяет save
- **THEN** система завершает binding с той же folder
- **AND** существует ровно одна vacancy и одна связанная folder
