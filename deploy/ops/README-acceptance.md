# Независимая приёмка HH ops gate

Тесты написал независимый агент, который не менял реализацию policy, verifier, dispatcher, host script или workflow. Oracle задан пользовательским запросом перенести OCR-процесс `/fix` на сервис кандидатов с подтверждением администратора, обязательным CI и развёртыванием точного согласованного SHA. Зелёный ops gate не означает приёмку пользовательского сценария кандидата.

## Сценарии

- `policy.test.mjs`: 1–5 изменений A/M только исходного кода и тестов; допустимые типы файлов; запрет секретов, материалов кандидатов, fixtures/evidence, обхода путей, symlinks и удалений. Файловый лимит проверяется по UTF-8 bytes, включая существующий крупный runtime; изменение policy/workflow/deploy/package самим fixer запрещено. CLI запускается в настоящем временном Git repository: небольшой diff проходит, diff более 50 000 символов отклоняется.
- `verify-release.test.mjs`: только merged PR нужного репозитория и ветки `production`; proposal branch `codex/ops-ID`; полный SHA равен merge SHA и текущему production ref; успешный `validate-hh` принадлежит GitHub Actions и ровно reviewed head SHA. Отдельно отклоняются moved branch, подмена repo/PR/branch/SHA, failed/skipped/in-progress или чужой CI, удалённые и защищённые файлы. Зелёная посторонняя проверка не закрывает провал обязательного job.
- `deploy-host.test.mjs`: настоящий Bash process и настоящий Git с локальным bare remote. Dirty checkout, расходящаяся история и устаревший production SHA отклоняются до Docker; локальные HEAD и source сохраняются. Clean descendant достигает первой deployment boundary, где Docker sentinel немедленно останавливает тест. Реальный Python dispatcher принимает только `deploy` с одним полным lowercase hex SHA, отклоняет команды и shell injection, а разрешённый запрос направляет лишь в фиксированный sudo wrapper.

Host harness изменяет только расположение `/root/hr` и lock-файла в временной копии скрипта. Git работает по-настоящему; Docker и flock заменены локальными stand-ins. Производственный скрипт не получает тестовых настроек и не изменяется тестом. Тесты не читают production secrets или реальные candidate materials и не обращаются к удалённому GitHub/VPS.

## Воспроизведение

Из корня repository, при установленном Node.js, Git, Python 3 и Bash:

```sh
node --test deploy/ops/*.test.mjs
node --test --test-reporter=junit --test-reporter-destination=deploy/ops/evidence/hh-ops-gate-green.junit.xml deploy/ops/*.test.mjs
```

На Windows host harness использует Git Bash в `C:/Program Files/Git/bin/bash.exe`; на Linux — `bash` и `python3`. JUnit генерируется тестовым прогоном и не редактируется вручную.

Исходный продуктовый RED всего переноса `/fix_hh` зафиксирован отдельным OCR acceptance: Telegram application boundary отвечал «Неизвестная команда» и не вызывал fixer. Отсутствие новых policy/verifier файлов, ошибка импорта или TypeError не считались продуктовым RED этой части.

Обязательные production-like `E2E-VAC-001`, `E2E-TRN-001`, `E2E-ABC-001`, `E2E-RESULT-001` остаются отдельным контуром. Неподготовленная среда и существующий конфликт main specs с personal My Drive OAuth дают BLOCKED; эти ops-тесты не закрывают release gate и не заявляют production readiness.
