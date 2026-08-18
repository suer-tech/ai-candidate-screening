# Модуль транскрибации интервью

Согласованный контракт будущей системы описан требованиями `INT-009`–`INT-019` и `OPS-006` в [main OpenSpec specification](../../../openspec/specs/integrations-and-operations/spec.md).

Модуль предназначен для фонового Node-процесса и не импортируется в Cloudflare Worker. Он:

1. извлекает первую аудиодорожку из видео через локальный FFmpeg;
2. по возможности копирует AAC без перекодирования;
3. отправляет M4A в AssemblyAI через EU endpoint;
4. запрашивает русскую транскрибацию с разделением говорящих;
5. сохраняет исходный ответ, стабильный JSON для следующих моделей и читаемый TXT;
6. по умолчанию удаляет удалённую копию транскрипции после успешного локального сохранения.

## Локальный запуск

Ключ передаётся только через переменную окружения и не должен храниться в проекте:

```powershell
$env:ASSEMBLYAI_API_KEY = Read-Host "AssemblyAI API key" -MaskInput
npm run transcribe:candidate -- --input "../candidate/Запись встречи 14.08" --output "../candidate/transcription" --keep-audio
```

Если число говорящих достоверно известно, можно добавить `--speakers 2`. Без параметра сервис определяет число автоматически.

Проверка извлечения аудио без сетевого вызова:

```powershell
npm run transcribe:candidate -- --input "../candidate/Запись встречи 14.08" --output "../candidate/transcription" --extract-only
```

Файлы результата:

- `*.audio.m4a` — извлечённая дорожка, только с `--keep-audio` или `--extract-only`;
- `*.assemblyai.json` — полный ответ провайдера;
- `*.transcript.json` — стабильная схема для последующих AI-моделей;
- `*.transcript.txt` — стенограмма с говорящими и таймкодами.

По умолчанию используется `https://api.eu.assemblyai.com`. Другой endpoint можно явно передать через `--base-url`.
