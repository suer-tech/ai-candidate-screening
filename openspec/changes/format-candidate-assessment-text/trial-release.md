# Reversible formatting trial — 2026-10-14

Пользователь после обсуждения различного наполнения реальных оценок попросил: «давай внесем эти правки, я проверю на новой обработке и если не понравится то откатим назад как было». Это разрешение на предложенное оформление и его обратимую пробную выкладку для проверки в работающем сервисе.

Scope: представление HR-safe текстов, сохранение переносов в проекции, presentation-only versioned instructions в существующих JSON strings, точный provenance новой версии и независимые synthetic tests. Recommendation, ABC decision policy, schema IDs, источники и история сохраняются. Старые результаты не пересчитываются и не перезаписываются.

`npm test` прошёл, отдельная приёмка format 23/23 и Chromium QA прошли. Старый candidate-review suite имеет три ошибки, совпадающие с чистым production base; lint errors также совпадают с base. Matrix-output acceptance локально требует isolated TEST_DATABASE_URL; проверка будет повторена на отдельном PostgreSQL16. Эти проверки не считаются полным production-like E2E.

Полный gate остаётся BLOCKED: нет утверждённого E2E configuration identity, отдельный OAuth callback стенда не зарегистрирован. На исходном release checkout старые main requirements/basis Shared Drive/пары PDF также не синхронизированы с ранее согласованными решениями, оставшимися в основном локальном checkout. Форматирование не устраняет эти разрывы. Пробный релиз не объявляется production readiness и не меняет gate для последующих релизов.

Rollback: перед выкладкой pin image `sha256:7cd3b3c669269e6ced9da5491da3def3805114a6137936e26ab37abdc4b1cfa9`; journal сохраняет old build ID и replica counts. Подготовлена guarded команда `rollback-assessment-formatting.py --release-sha <actual merge SHA> --consent user-requested-formatting-rollback`. Она отказывается при активной работе или изменившемся release, сохраняет DB state, останавливает discovery и возвращает предыдущий app image/source/build ID только при idle. Нет down migrations или удаления candidate data. Откат выполняется по последующему запросу пользователя, если результат оформления не устроит.

Фактические build/deployment identities и postchecks будут отдельными generated evidence; этот документ сам по себе не подтверждает deployment.
