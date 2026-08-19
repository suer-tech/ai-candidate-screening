## 1. Независимый приёмочный baseline

- [x] 1.1 Независимому субагенту добавить исполняемые TST-089–TST-093 для archive/restore/delete, manual reprocess, stability gate, current-run status и удаления demo controls.
- [x] 1.2 Запустить новые сценарии на текущей реализации и зафиксировать ожидаемый RED.

## 2. Lifecycle commands и аудит

- [x] 2.1 Реализовать archive guard для всех processing stages и обратимое архивирование только завершённого кандидата.
- [x] 2.2 Реализовать restore в применимое последнее workflow state без автоматического запуска обработки.
- [x] 2.3 Разрешить окончательное удаление только архивированного кандидата, удалять только app data и никогда не удалять Drive artifacts.
- [x] 2.4 Записывать archive, restore и delete в существующий аудит с actor, candidate ID, timestamp и outcome.

## 3. Ручная повторная обработка

- [x] 3.1 Показывать кнопку повтора для `READY` и terminal `FAILED`, а во время processing оставлять её видимой disabled с понятным пояснением.
- [x] 3.2 Добавить confirmation о недоступности прежних результатов и обновлении данных кандидата.
- [x] 3.3 После подтверждения выполнить стандартную проверку стабильности Drive files и только при успехе создать новый versioned run; изменение файлов само по себе не запускает обработку.
- [x] 3.4 Показывать current run как основной workflow status и сохранять прежние события только как evidence/version history.

## 4. UI cleanup

- [x] 4.1 Удалить кнопку `На следующий этап`, hiring decision/pipeline state и скрыть `Аналитика` в MVP navigation.
- [x] 4.2 Удалить no-op export/filter/search controls, для которых нет canonical назначения, не вводя новые product semantics.
- [x] 4.3 Добавить archive filter, подтверждения и допустимые restore/delete actions согласно lifecycle guards.

## 5. Проверка и release gate

- [x] 5.1 Довести независимые acceptance и focused workflow/security/UI tests до GREEN, включая race и repeated-command cases.
- [ ] 5.2 Запустить применимые unit/lint проверки и полный набор `E2E-VAC-001`, `E2E-TRN-001`, `E2E-ABC-001`, `E2E-RESULT-001`.
- [x] 5.3 Проверить audit evidence и доказать, что app delete не инициирует Drive cleanup, а обработка не допускает archive или concurrent manual retry.
