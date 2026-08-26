## 1. Независимый приёмочный baseline

- [x] 1.1 После согласования спецификации независимому субагенту заменить TST-086–TST-088 сценариями ручного запуска LLM-генерации, success на каждой допустимой попытке, terminal error после трёх повторов, запрета manual fallback, preview/подтверждения и Drive recovery.
- [x] 1.2 Запустить новые acceptance-сценарии на текущей manual non-LLM реализации и сохранить ожидаемый RED вместе с машинным результатом и evidence artifacts.

## 2. Серверный контур генерации

- [x] 2.1 Ввести idempotent generation operation с устойчивым operation ID, исходным и нормализованным названием, состоянием, номером попытки и безопасными trace metadata.
- [x] 2.2 Проверять обязательность и нормализованную уникальность названия на сервере до первого LLM call и защищать concurrent duplicate при финальном сохранении.
- [x] 2.3 Реализовать RouterAI structured-output request с версионируемыми instruction/schema, сохранением raw response на сервере и строгой проверкой обязательных блоков полного vacancy profile.
- [x] 2.4 Реализовать initial call и максимум три автоматических повтора для timeout, network error, HTTP 429/5xx и невалидного structured response с тем же operation ID и конфигурационной задержкой.
- [x] 2.5 Отделить non-retryable auth/config failures и terminal failure после трёх повторов; возвращать безопасный код, понятное сообщение, attempt count и возможность повторить generation operation позже.
- [x] 2.6 Гарантировать, что unsuccessful generation не создаёт vacancy, version, Drive folder, persistent draft или доступный ручной editor.

## 3. Пользовательский flow

- [x] 3.1 Реализовать первый экран только с названием и действием `Сформировать вакансию`; отображать progress и номер текущей автоматической попытки, блокируя duplicate submit.
- [x] 3.2 Открывать полный editor только после валидного LLM response и удалить manual non-LLM template как fallback при generation failure.
- [x] 3.3 Реализовать редактирование generated profile, заполнение полей `Требует решения HR`, discard confirmation и `Сбросить изменения` к последнему valid LLM snapshot без нового model call.
- [x] 3.4 Реализовать preview правил оценки и структуры отчёта, подтверждение точного snapshot и сброс подтверждения после любого изменения.
- [x] 3.5 Для terminal generation failure показывать понятную причину и действие `Повторить генерацию`, сохраняя title только в текущей browser session.

## 4. Финальное сохранение и Google Drive

- [x] 4.1 Реализовать идемпотентное `Сохранить и активировать`, которое повторно валидирует title/profile/confirmation и создаёт ровно одну active vacancy и immutable version 1.
- [x] 4.2 Создавать и связывать одну папку Google Shared Drive только в final-save operation; generation retries не должны обращаться к folder provisioning.
- [x] 4.3 Сделать vacancy/version/Drive binding externally atomic и восстанавливаемыми по operation ID после timeout без duplicate objects.
- [x] 4.4 Зафиксировать audit events генерации, попыток, безопасных ошибок, подтверждённого snapshot и final-save outcome без секретов и внутренних инструкций.

## 5. Проверка и release gate

- [x] 5.1 Довести независимо созданные TST-086–TST-088 и focused server/UI/integration tests до GREEN, не ослабляя oracle под текущую реализацию.
- [x] 5.2 Запустить применимые unit, typecheck, lint и build проверки.
- [ ] 5.3 Запустить `E2E-VAC-001`, затем полный набор `E2E-VAC-001`, `E2E-TRN-001`, `E2E-ABC-001`, `E2E-RESULT-001` на одной production-like сборке.
- [x] 5.4 Проверить evidence package для success на каждой попытке, terminal retry exhaustion, non-retryable error, duplicate click, отсутствия manual fallback, snapshot re-confirmation, Drive timeout/retry и отсутствия дублей.

## 6. Канонический ABC и читаемые разделы

- [x] 6.1 Независимому субагенту добавить RED acceptance для ровно пяти канонических ABC-направлений и многострочной нормализации четырёх разделов.
- [x] 6.2 Уточнить RouterAI instruction и structured-response validation: канонические пять направлений, содержательные требования Word-ТЗ и отклонение случайного ABC-набора.
- [x] 6.3 Реализовать детерминированную многострочную нормализацию массивов и объектов без потери порядка и вложенных признаков.
- [x] 6.4 Адаптировать editor четырёх разделов для читаемого многострочного отображения и переноса длинного текста.
- [ ] 6.5 Довести focused acceptance/unit/UI tests и полный обязательный regression/E2E-набор до GREEN.

## 7. Детерминированное оформление generated profile

- [x] 7.1 Независимому субагенту добавить RED acceptance на русские заголовки, пустые строки между смысловыми блоками, маркеры вложенных списков и нормализацию пробелов на фактическом RouterAI response.
- [x] 7.2 Добавить в RouterAI instruction компактный эталон semantic JSON без делегирования модели окончательного визуального оформления.
- [x] 7.3 Реализовать версионированный словарь русских подписей и серверную layout grammar для четырёх разделов.
- [x] 7.4 Проверить сохранение и редактирование форматированного текста в vacancy settings editor.
- [x] 7.5 Довести focused и применимый regression-набор до GREEN и обновить локальный контур.

## 8. Раздельное создание, минутный intake и FFmpeg runtime

- [x] 8.1 Независимому субагенту добавить RED acceptance для создания vacancy без LLM, отдельной генерации, подписи `Сохранить`, четырёх снимков за минуту и реального FFmpeg health/extraction.
- [x] 8.2 Разделить create-vacancy и generation operations: создание по названию без RouterAI, кнопка `Сгенерировать описание` внутри vacancy и сохранение generated editor отдельным действием.
- [x] 8.3 Переименовать `Сохранить новую версию` в `Сохранить` во всех блоках параметров и сохранить версионирование на сервере.
- [x] 8.4 Перевести stability window на четыре полных снимка примерно 0/15/30/45 секунд с File ID/count/size comparison, reset при изменении и idempotent automatic first run.
- [x] 8.5 Гарантировать FFmpeg executable в local/VPS Docker image; сделать build/runtime preflight и health-check с фактическим version probe.
- [x] 8.6 Довести focused acceptance, unit, Docker media integration и build до GREEN; обновить локальный runtime.
- [x] 8.7 Перезапустить незавершённого кандидата и подтвердить сквозной результат: transcript, assessment, два PDF, Drive publication и Telegram delivery.
