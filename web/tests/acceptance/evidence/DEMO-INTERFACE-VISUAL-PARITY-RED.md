# Demo interface visual parity — RED evidence

Дата: 2026-08-24

Команда:

```text
cd web
node --test --test-reporter=spec tests/demo-interface-visual-parity.acceptance.test.mjs
```

Результат: `23` теста, `6` passed, `17` failed. Match percent проверяется по утверждённой формуле `A=100`, `B=70`, `C=40`, `Math.round(сумма / число валидных ABC)`. Невалидные элементы исключаются; если валидных оценок нет, число не выводится и показывается `Оценка ещё не готова`. Match percent отдельно проверяется от processing progress и extraction confidence.

Точные первые падения:

1. В Vacancies отсутствует отдельный поиск `Найти вакансию` под сохранёнными вкладками `Активные`/`Архив`.
2. В candidate ranking всё ещё присутствует кнопка `Фильтры` (после неё тест также запрещает `Экспорт`).
3. Ranking показывает `A` вместо `85%` для ABC `[A,B]`; semantic `aria-valuenow=85` также отсутствует.
4. Формула не реализует однократное целочисленное округление: `[A,B,C,C]` должно дать `63%`; смешанный `[A,X]` должен дать `100%`, игнорируя `X`.
5. Пустой/невалидный ABC не получает доступное состояние `Оценка ещё не готова`.
6. `.status-ready` использует hardcoded `#e1f8eb/#a9e4c2/#216744`, а не `--success-soft/--success-ink`.
7. READY с `etaMinutes: null` ошибочно показывает `Недостаточно данных для прогноза` вместо завершённого stage/time.
8. Processing row не показывает сохранённый `progressMilestone` (`AI-анализ · сопоставление фактов`); после этого же assertion требуются сохранённые `elapsedMinutes: 11` и `etaMinutes: 7`.
9. Processing hero показывает общий label `Анализ`, а не сохранённый current stage; после этого же assertion требуется сохранённый `progressPercent: 63` и ETA.
10. Processing timeline содержит пять общих стадий вместо шести: `Обнаружен`, `Проверка файлов`, `Транскрибация`, `AI-анализ`, `Проверка результата`, `Готово`.
11. Ready hero не показывает вычисленные по утверждённой формуле `85%`.
12. Matching aside не показывает те же вычисленные `85%`.
13. Ready hero/matching aside с невалидным ABC показывают `X`, а не `Оценка ещё не готова` без числа.
14. Отсутствует отдельный semantic region `.candidate-ke-region`; KE вложен в score card.
15. При пустом `materials` UI выдумывает `Резюме Мария Орлова.pdf`, `Интервью.mp4` и `Заметки рекрутера.docx`.
16. Boilerplate `Отчёты успешно опубликованы` и `Кандидат соответствует требованиям` выводится как candidate summary/recommendation basis.
17. Связанное с критерием доказательство неизвестного technical type получает неоднозначный заголовок `Доказательство`.

Прошедшие защитные проверки:

- Vacancy ranking сохраняет semantic section и доступные table headers.
- Ranking сохраняет входной порядок `[Первый кандидат, Второй кандидат]` и не сортирует автоматически по score/index.
- Без `progressPercent` processing hero не показывает fallback-процент.
- Ready detail сохраняет основные semantic composition classes.
- Raw schema keys и duplicate locators не выводятся.
- Demo theme tokens и scoped palette contract в остальном проходят.

JUnit: `tests/acceptance/evidence/demo-interface-visual-parity-red.junit.xml`.
