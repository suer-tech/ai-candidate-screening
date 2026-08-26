# Google Drive OAuth: rollout и rollback

## Rollout

1. Применить PostgreSQL migrations до включения маршрутов.
2. Задать server-only OAuth client, exact callback, `production-personal` и versioned keyring.
3. Оставить `CANDIDATE_PIPELINE_ROUTING=shadow`, выполнить preflight и consent владельца.
4. Подтвердить owner, root `Найм`, чтение, тестовую публикацию, reconcile и cleanup.
5. Включить `effectful` только для immutable build с четырьмя обязательными E2E и recovery matrix.

## Rollback

1. Немедленно установить `CANDIDATE_PIPELINE_ROUTING=disabled` и запретить новые goals/Drive effects.
2. Не удалять PostgreSQL OAuth connection, encrypted refresh token, checkpoints, outbox и Drive files: они нужны для безопасного resume/reconcile.
3. Дождаться истечения lease; unknown external outcome сначала сверить по operation identity, не повторять вслепую.
4. Исправить/откатить web и worker на совместимую версию schema, затем повторить preflight.
5. Возобновлять с `shadow`; в `effectful` переходить только после повторного GREEN.

Rollback никогда не включает Shared Drive или service-account backend. Если credential скомпрометирован, выполнить Disconnect/revoke, ротировать OAuth secret/keyring по процедуре и подключить ожидаемый Google account заново.
